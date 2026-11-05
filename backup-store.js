'use strict';
// Native backup storage. No network access; all paths remain under the existing data directory.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {validateDocuments} = require('./msds-store');
const RETENTIONS = new Set([7, 30, 60, 90]);
const SNAPSHOT_RE = /^(?:inventory_\d{4}-\d{2}-\d{2}|(?:manual|before_restore)_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:_\d{3})?(?:_\d+)?)\.json$/;
const LATEST = 'inventory_latest.json';
const isManagedName = n => n === LATEST || SNAPSHOT_RE.test(n);
const errorText = e => String(e && e.message || e);

function validateInventory(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || !Array.isArray(obj.reagents))
    throw new Error('재고관리 백업 형식이 아닙니다.');
  if (obj.logs !== undefined && !Array.isArray(obj.logs)) throw new Error('입출고 이력 형식이 올바르지 않습니다.');
  if (obj.settings !== undefined && (!obj.settings || typeof obj.settings !== 'object' || Array.isArray(obj.settings)))
    throw new Error('설정 형식이 올바르지 않습니다.');
  if (Number(obj.schemaVersion) > 3) throw new Error('현재 버전에서 지원하지 않는 백업 형식입니다.');
  const ids = new Set();
  for (const r of obj.reagents) {
    if (!r || typeof r !== 'object' || Array.isArray(r) || typeof r.id !== 'string' || !r.id.trim() || typeof r.name !== 'string')
      throw new Error('시약/표준물질의 ID 또는 이름이 올바르지 않습니다.');
    const id = r.id.trim().toUpperCase();
    if (ids.has(id)) throw new Error('동일한 ID가 중복되어 있습니다: ' + r.id);
    ids.add(id);
    validateDocuments(r.msdsDocuments);
    if (r.batches !== undefined && (!Array.isArray(r.batches) || r.batches.some(b => !b || typeof b !== 'object' || Array.isArray(b))))
      throw new Error('입고회차 데이터 형식이 올바르지 않습니다: ' + r.id);
  }
  const standard = obj.reagents.filter(r => (r.category || 'reagent') === 'standard').length;
  return {reagents: obj.reagents.length - standard, standards: standard, logs: (obj.logs || []).length};
}

function atomicWriteJson(target, obj, keepPrevious = false) {
  const text = JSON.stringify(obj, null, 2);
  if (typeof text !== 'string') throw new Error('저장할 데이터가 없습니다.');
  fs.mkdirSync(path.dirname(target), {recursive: true});
  const suffix = '.tmp-' + process.pid + '-' + crypto.randomBytes(6).toString('hex');
  const tmp = target + suffix, previousTmp = target + '.prev' + suffix;
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx');
    fs.writeFileSync(fd, text, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    if (keepPrevious && fs.existsSync(target)) {
      fs.copyFileSync(target, previousTmp);
      fs.renameSync(previousTmp, target + '.prev');
    }
    // Never unlink the valid original before replacement succeeds.
    fs.renameSync(tmp, target);
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    for (const p of [tmp, previousTmp]) { try { fs.unlinkSync(p); } catch {} }
  }
}

function createBackupStore(getDataDir, options = {}) {
  const clock = options.clock || (() => new Date());
  let volatileError = null;
  const dir = () => { const p = path.join(getDataDir(), 'backups'); fs.mkdirSync(p, {recursive: true}); return p; };
  const metaFile = () => path.join(getDataDir(), 'backup-status.json');
  const readMeta = () => { try { return JSON.parse(fs.readFileSync(metaFile(), 'utf8')); } catch { return {}; } };
  const retentionOf = obj => RETENTIONS.has(Number(obj?.settings?.backupRetention)) ? Number(obj.settings.backupRetention) : 30;
  const stamp = d => {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
  };
  const timestamp = d => {
    const p = n => String(n).padStart(2, '0');
    return `${stamp(d)}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}_${String(d.getMilliseconds()).padStart(3, '0')}`;
  };
  function entries() {
    const base = dir();
    return fs.readdirSync(base).filter(isManagedName).map(name => {
      const p = path.join(base, name);
      const st = fs.lstatSync(p);
      if (!st.isFile() || st.isSymbolicLink()) return null;
      return {name, path: p, size: st.size, modifiedAt: st.mtime.toISOString(), mtime: st.mtimeMs,
        type: name === LATEST ? 'latest' : name.startsWith('manual_') ? 'manual' : name.startsWith('before_restore_') ? 'before_restore' : 'daily',
        counted: name !== LATEST};
    }).filter(Boolean).sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name));
  }
  function prune(obj, protectedPath) {
    const retention = retentionOf(obj);
    const snapshots = entries().filter(x => x.counted).sort((a, b) => {
      if (a.path === protectedPath) return -1;
      if (b.path === protectedPath) return 1;
      return b.mtime - a.mtime || b.name.localeCompare(a.name);
    });
    const failed = [];
    for (const item of snapshots.slice(retention)) {
      try { fs.unlinkSync(item.path); } catch (e) { failed.push(item.name + ': ' + errorText(e)); }
    }
    let warning = failed.length ? `백업은 저장됐지만 ${failed.length}개 파일을 정리하지 못했습니다. ${failed.join(' / ')}` : '';
    if (options.msdsStore) {
      try { const r = options.msdsStore.pruneBackupFiles(entries().map(f => f.path)); if (r.warning) warning += (warning ? ' / ' : '') + r.warning; }
      catch (e) { warning += (warning ? ' / ' : '') + 'MSDS 백업 사본 정리 실패: ' + errorText(e); }
    }
    return {retention, warning};
  }
  function recordFailure(e) {
    volatileError = {at: clock().toISOString(), message: errorText(e)};
    try { atomicWriteJson(metaFile(), {...readMeta(), lastError: volatileError}); } catch {}
    return {ok: false, skipped: false, error: volatileError.message};
  }
  function success(type, target, now, warning) {
    const meta = {lastBackupAt: now.toISOString(), type, path: target, lastError: null, cleanupWarning: warning || ''};
    atomicWriteJson(metaFile(), meta);
    volatileError = null;
    return {ok: true, skipped: false, at: meta.lastBackupAt, type, path: target, warning: warning || ''};
  }
  function uniquePath(prefix, now) {
    const base = dir(), stem = prefix + '_' + timestamp(now);
    let target = path.join(base, stem + '.json'), i = 0;
    while (fs.existsSync(target)) target = path.join(base, stem + '_' + (++i) + '.json');
    return target;
  }
  function automatic(obj) {
    try {
      validateInventory(obj);
      if (obj.settings?.autoBackup === false) {
        const cleanup = prune(obj);
        const meta = readMeta();
        if ((meta.cleanupWarning || '') !== cleanup.warning) atomicWriteJson(metaFile(), {...meta, cleanupWarning: cleanup.warning});
        return {ok: true, skipped: true, warning: cleanup.warning};
      }
      if (options.msdsStore) options.msdsStore.ensureBackup(obj);
      const now = clock(), base = dir();
      const daily = path.join(base, `inventory_${stamp(now)}.json`);
      if (!fs.existsSync(daily)) atomicWriteJson(daily, obj);
      const target = path.join(base, LATEST);
      atomicWriteJson(target, obj);
      const cleanup = prune(obj, !readMeta().lastBackupAt ? daily : undefined);
      return success('auto', target, now, cleanup.warning);
    } catch (e) { return recordFailure(e); }
  }
  function snapshot(obj, type = 'manual', retentionSettings) {
    try {
      validateInventory(obj);
      if (!['manual', 'before_restore'].includes(type)) throw new Error('지원하지 않는 백업 종류입니다.');
      if (options.msdsStore) options.msdsStore.ensureBackup(obj);
      const now = clock(), target = uniquePath(type, now);
      atomicWriteJson(target, obj);
      const cleanup = prune(retentionSettings || obj, target);
      return success(type, target, now, cleanup.warning);
    } catch (e) { return recordFailure(e); }
  }
  function inspect(name) {
    try {
      if (typeof name !== 'string' || name !== path.basename(name) || !isManagedName(name)) throw new Error('선택할 수 없는 백업 파일입니다.');
      const p = path.join(dir(), name), st = fs.lstatSync(p);
      if (st.isSymbolicLink() || !st.isFile()) throw new Error('일반 백업 파일만 검사할 수 있습니다.');
      const text = fs.readFileSync(p, 'utf8'), obj = JSON.parse(text), counts = validateInventory(obj);
      const msds = options.msdsStore ? options.msdsStore.inspectBackup(obj) : {documents: 0};
      return {ok: true, name, size: st.size, modifiedAt: st.mtime.toISOString(), counts, msds,
        sha256: crypto.createHash('sha256').update(text).digest('hex')};
    } catch (e) { return {ok: false, name: String(name || ''), error: errorText(e)}; }
  }
  function list(obj) {
    try {
      const files = entries();
      return {ok: true, directory: dir(), files, retention: retentionOf(obj), snapshotCount: files.filter(x => x.counted).length,
        latestExists: files.some(x => x.type === 'latest'), totalBytes: files.reduce((n, f) => n + f.size, 0)};
    } catch (e) { return {ok: false, error: errorText(e)}; }
  }
  function status() {
    try {
      const meta = readMeta(), files = entries();
      const lastError = volatileError || meta.lastError || null;
      let item = files.find(x => x.path === meta.path);
      if (!item || (files[0] && files[0].mtime > item.mtime + 1000)) item = files[0];
      if (!item) return {ok: true, exists: false, lastError, cleanupWarning: meta.cleanupWarning || '', directory: dir()};
      const checked = inspect(item.name);
      return {ok: true, exists: true, valid: checked.ok, validationError: checked.error || '',
        lastBackupAt: item.path === meta.path && meta.lastBackupAt ? meta.lastBackupAt : item.modifiedAt,
        type: item.path === meta.path && meta.type ? meta.type : item.type, path: item.path,
        lastError, cleanupWarning: meta.cleanupWarning || '', directory: dir()};
    } catch (e) { return {ok: false, exists: false, error: errorText(e)}; }
  }
  function clearMemoryStatus() { volatileError = null; }
  return {dir, automatic, snapshot, prune, list, status, inspect, clearMemoryStatus};
}
module.exports = {createBackupStore, atomicWriteJson, validateInventory, isManagedName};
