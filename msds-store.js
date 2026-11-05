'use strict';
// Local, immutable PDF objects. Inventory JSON contains metadata only, never absolute paths.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_DOCUMENTS = 20;
const HASH_RE = /^[a-f0-9]{64}$/;
const OBJECT_RE = /^[a-f0-9]{64}\.pdf$/;
const errText = e => String(e && e.message || e);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function validateDocument(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !HASH_RE.test(doc.sha256 || '') || doc.id !== doc.sha256)
    throw new Error('MSDS 문서 식별정보가 올바르지 않습니다.');
  if (typeof doc.fileName !== 'string' || !doc.fileName || doc.fileName.length > 200 ||
      /[\\/\x00-\x1f<>:"|?*]/.test(doc.fileName) || !/\.pdf$/i.test(doc.fileName))
    throw new Error('MSDS 파일명이 올바르지 않습니다.');
  if (!Number.isSafeInteger(doc.size) || doc.size < 8 || doc.size > MAX_BYTES)
    throw new Error('MSDS PDF는 파일당 25 MB까지 첨부할 수 있습니다.');
  if (typeof doc.addedAt !== 'string' || doc.addedAt.length > 40 || !Number.isFinite(Date.parse(doc.addedAt)))
    throw new Error('MSDS 첨부 날짜가 올바르지 않습니다.');
  return doc;
}
function validateDocuments(docs) {
  if (docs === undefined) return [];
  if (!Array.isArray(docs) || docs.length > MAX_DOCUMENTS) throw new Error('MSDS는 품목당 20개까지 첨부할 수 있습니다.');
  const ids = new Set();
  for (const d of docs) {
    validateDocument(d);
    if (ids.has(d.id)) throw new Error('동일한 MSDS 문서가 중복 연결되어 있습니다.');
    ids.add(d.id);
  }
  return docs;
}
function references(inventory) {
  const all = new Map();
  for (const item of inventory.reagents || []) {
    for (const doc of validateDocuments(item.msdsDocuments)) {
      const old = all.get(doc.sha256);
      if (old && old.size !== doc.size) throw new Error('동일 MSDS 문서의 크기정보가 다릅니다.');
      all.set(doc.sha256, doc);
    }
  }
  return [...all.values()];
}
function ensureDirectory(dir) {
  fs.mkdirSync(dir, {recursive: true});
  const st = fs.lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('MSDS 저장 폴더가 일반 폴더가 아닙니다.');
  return dir;
}
function pdfBytes(file) {
  const st = fs.lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink()) throw new Error('일반 PDF 파일만 첨부할 수 있습니다.');
  if (st.size < 8 || st.size > MAX_BYTES) throw new Error('PDF는 파일당 25 MB까지 첨부할 수 있습니다.');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_BYTES || stat.size !== st.size) throw new Error('읽는 중 파일이 변경되었습니다.');
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const n = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!n) throw new Error('PDF 파일을 끝까지 읽지 못했습니다.');
      offset += n;
    }
    if (!/^%PDF-\d\.\d/.test(bytes.subarray(0, 8).toString('ascii'))) throw new Error('PDF 파일 형식이 아닙니다.');
    return bytes;
  } finally { fs.closeSync(fd); }
}
function atomicBytes(target, bytes) {
  ensureDirectory(path.dirname(target));
  const temp = target + '.tmp-' + crypto.randomBytes(8).toString('hex');
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(temp, target);
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(temp); } catch {}
  }
}
function checkedFile(base, doc) {
  validateDocument(doc);
  const dirStat = fs.lstatSync(base);
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) throw new Error('MSDS 폴더를 확인할 수 없습니다.');
  const file = path.join(base, doc.sha256 + '.pdf');
  const bytes = pdfBytes(file);
  if (bytes.length !== doc.size || hash(bytes) !== doc.sha256) throw new Error('MSDS 파일의 크기 또는 SHA-256이 일치하지 않습니다.');
  return {file, bytes};
}
function createMSDSStore(getDataDir, options = {}) {
  const clock = options.clock || (() => new Date());
  const directory = () => ensureDirectory(path.join(getDataDir(), 'msds'));
  const backupDirectory = () => ensureDirectory(path.join(getDataDir(), 'backups', 'msds'));
  function importFiles(files) {
    if (!Array.isArray(files) || files.length > MAX_DOCUMENTS) throw new Error('한 번에 PDF 20개까지 선택해주세요.');
    const documents = [], errors = [], seen = new Set();
    for (const file of files) {
      try {
        if (typeof file !== 'string' || path.extname(file).toLowerCase() !== '.pdf') throw new Error('PDF 파일만 첨부할 수 있습니다.');
        const bytes = pdfBytes(file), digest = hash(bytes);
        if (seen.has(digest)) continue;
        let stem = path.basename(file).replace(/[\\/\x00-\x1f<>:"|?*]/g, '_').replace(/\.pdf$/i, '');
        const doc = {id: digest, sha256: digest, fileName: stem.slice(0, 196) + '.pdf', size: bytes.length, addedAt: clock().toISOString()};
        validateDocument(doc);
        let valid = false;
        try { checkedFile(directory(), doc); valid = true; } catch {}
        if (!valid) atomicBytes(path.join(directory(), digest + '.pdf'), bytes);
        checkedFile(directory(), doc);
        seen.add(digest); documents.push(doc);
      } catch (e) { errors.push({fileName: path.basename(String(file || '')), error: errText(e), code: e.code || null}); }
    }
    return {ok: true, documents, errors};
  }
  function list(docs) {
    const files = validateDocuments(docs).map(doc => {
      try { checkedFile(directory(), doc); return {...doc, available: true}; }
      catch (e) { return {...doc, available: false, error: '파일 없음 또는 손상: ' + errText(e)}; }
    });
    return {ok: true, files, directory: directory(), maxBytes: MAX_BYTES, maxDocuments: MAX_DOCUMENTS};
  }
  const openPath = doc => checkedFile(directory(), doc).file;
  function exportFile(doc, target) {
    if (typeof target !== 'string' || path.extname(target).toLowerCase() !== '.pdf') throw new Error('저장 파일 확장자는 PDF로 지정해주세요.');
    const {bytes, file} = checkedFile(directory(), doc);
    if (path.resolve(target) === path.resolve(file)) return {ok: true, path: file};
    // The target is obtained only from the native save dialog.
    atomicBytes(target, bytes);
    return {ok: true, path: target};
  }
  function ensureBackup(inventory) {
    const docs = references(inventory);
    if (!docs.length) return {documents: 0};
    const dest = backupDirectory();
    for (const doc of docs) {
      try { checkedFile(dest, doc); continue; } catch {}
      try {
        const {bytes} = checkedFile(directory(), doc);
        atomicBytes(path.join(dest, doc.sha256 + '.pdf'), bytes);
        checkedFile(dest, doc);
      } catch (e) { throw new Error(`MSDS 백업 실패 (${doc.fileName}): ${errText(e)}`); }
    }
    return {documents: docs.length};
  }
  function inspectBackup(inventory, base) {
    const docs = references(inventory);
    for (const doc of docs) {
      try { checkedFile(base || backupDirectory(), doc); }
      catch (e) { throw new Error(`MSDS 백업 파일 없음 또는 손상 (${doc.fileName}): ${errText(e)}`); }
    }
    return {documents: docs.length};
  }
  function restoreFiles(inventory, externalDirectory) {
    const docs = references(inventory), candidates = [directory(), backupDirectory()];
    if (externalDirectory) candidates.push(externalDirectory);
    // Check ALL sources before copying; never replace inventory with broken references.
    const pending = [];
    for (const doc of docs) {
      let source = null;
      for (const base of candidates) { try { source = checkedFile(base, doc).file; break; } catch {} }
      if (!source) throw new Error(`MSDS 파일을 찾을 수 없거나 손상되었습니다 (${doc.fileName}). 백업 JSON과 같은 위치의 msds 폴더를 함께 가져와주세요.`);
      pending.push({doc, source});
    }
    for (const {doc, source} of pending) {
      const target = path.join(directory(), doc.sha256 + '.pdf');
      if (path.resolve(source) !== path.resolve(target)) {
        const {bytes} = checkedFile(path.dirname(source), doc);
        atomicBytes(target, bytes);
      }
    }
    return {documents: docs.length};
  }
  function pruneBackupFiles(snapshotFiles) {
    const keep = new Set();
    try {
      for (const file of snapshotFiles) {
        const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!obj || !Array.isArray(obj.reagents)) throw new Error('백업 구조 확인 불가');
        for (const doc of references(obj)) keep.add(doc.sha256 + '.pdf');
      }
    } catch (e) { return {warning: '읽을 수 없는 백업이 있어 MSDS 사본 정리를 건너뛰었습니다.'}; }
    const base = path.join(getDataDir(), 'backups', 'msds');
    if (!fs.existsSync(base)) return {warning: ''};
    ensureDirectory(base);
    let failed = 0;
    for (const name of fs.readdirSync(base)) {
      if (!OBJECT_RE.test(name) || keep.has(name)) continue;
      try {
        const file = path.join(base, name), st = fs.lstatSync(file);
        if (st.isFile() && !st.isSymbolicLink()) fs.unlinkSync(file);
      } catch { failed++; }
    }
    return {warning: failed ? `사용되지 않는 MSDS 백업 사본 ${failed}개를 정리하지 못했습니다.` : ''};
  }
  // PDF 본문 텍스트. 앞쪽 페이지(2절)와 마지막 페이지(개정 이력)만 읽는다. 스캔본은 빈 문자열에 가깝다.
  async function textOf(doc, {maxPages = 6, timeoutMs = 25000} = {}) {
    const {bytes} = checkedFile(directory(), doc);
    const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
    const fonts = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep;
    const work = (async () => {
      const pdf = await pdfjs.getDocument({data: new Uint8Array(bytes), disableWorker: true, isEvalSupported: false, verbosity: 0, standardFontDataUrl: fonts}).promise;
      try {
        const pages = []; for (let i = 1; i <= Math.min(pdf.numPages, maxPages); i++) pages.push(i);
        if (pdf.numPages > maxPages) { for (const i of [pdf.numPages - 1, pdf.numPages]) if (i > maxPages) pages.push(i); }
        let out = '';
        for (const i of pages) {
          const page = await pdf.getPage(i), tc = await page.getTextContent();
          let line = '', lastY = null;
          for (const it of tc.items) {
            if (lastY !== null && Math.abs(it.transform[5] - lastY) > 2) { out += line + '\n'; line = ''; }
            line += it.str + (it.hasEOL ? '\n' : ' '); lastY = it.transform[5];
          }
          out += line + '\n';
        }
        return {text: out, pages: pdf.numPages};
      } finally { try { await pdf.destroy(); } catch {} }
    })();
    let timer;
    const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('PDF 읽기 시간이 초과되었습니다.')), timeoutMs); });
    try { return await Promise.race([work, limit]); } finally { clearTimeout(timer); }
  }
  return {directory, backupDirectory, importFiles, list, openPath, exportFile, ensureBackup, inspectBackup, restoreFiles, pruneBackupFiles, textOf};
}
module.exports = {createMSDSStore, validateDocument, validateDocuments, references, MAX_BYTES, MAX_DOCUMENTS};
