'use strict';
// Windows 실행기(GitHub Actions)에서 전 화면 점검: 모든 탭·창을 열고, KOSHA MSDS 받기 → 미리보기 → GHS 다시 읽기 →
// 백업 → 묶음 저장·복원 → MSDS 삭제까지 실제로 해 본다. 결과(report.json, 화면, PDF)는 아티팩트로 올린다.
// 사용: node scripts/win-smoke.js <electron 실행파일> <앱 폴더> <출력 폴더>
const {_electron: electron} = require('playwright');
const fs = require('fs'), path = require('path');
(async () => {
  const [exe, appDir, outDir] = process.argv.slice(2);
  const out = path.resolve(outDir, 'pdf'); fs.mkdirSync(out, {recursive: true});
  const home = path.resolve(outDir, 'home'); fs.rmSync(home, {recursive: true, force: true});
  const ud = path.join(home, 'AppData', 'Roaming', 'reagent-inventory', 'data'); fs.mkdirSync(path.join(ud, 'msds'), {recursive: true});
  const now = new Date().toISOString(), b = (q, exp, lot) => [{batchId: 'B001', receivedDate: '2026-10-02', expiryDate: exp || '', lotNo: lot || '', initialQty: q, stock: q, createdAt: now}];
  const items = [
    {id: 'RG0001', name: '황산', casNo: '7664-93-9', unit: '병', category: 'reagent', stock: 2, minStock: 1, createdAt: now, updatedAt: now, batches: b(2, '2027-03-31')},
    {id: 'RG0002', name: '아세톤', nameEn: 'Acetone', casNo: '67-64-1', unit: '병', category: 'reagent', stock: 0, minStock: 1, createdAt: now, updatedAt: now, batches: b(0, '2026-11-20')},
    {id: 'ST0001', name: 'ICP 표준용액', casNo: '', unit: '병', category: 'standard', concentration: '1000 mg/L', stock: 1, minStock: 1, createdAt: now, updatedAt: now, batches: b(1, '2027-01-15', 'LOT-A1')}
  ];
  fs.writeFileSync(path.join(ud, 'inventory.json'), JSON.stringify({schemaVersion: 3, nextId: 3, nextIdStd: 2, reagents: items, logs: [], settings: {autoFetchMsds: false}}));
  const bundlePath = path.join(home, 'bundle.zip');
  // LOCAL_TEST: Linux에서 미리 돌려볼 때 (XDG_CONFIG_HOME로 같은 위치를 쓰게 하고, 샌드박스 프록시 인증서를 무시)
  const extra = process.env.LOCAL_TEST ? ['--no-sandbox', '--ignore-certificate-errors'] : [];
  const app = await electron.launch({executablePath: exe, args: [appDir, ...extra], env: {...process.env, APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'), XDG_CONFIG_HOME: path.join(home, 'AppData', 'Roaming'), USERPROFILE: home, HOME: home}});
  await app.evaluate(({dialog}, p) => { dialog.showSaveDialog = async () => ({canceled: false, filePath: p}); dialog.showOpenDialog = async () => ({canceled: false, filePaths: [p]}); dialog.showMessageBox = async () => ({response: 0}); }, bundlePath);
  const win = await app.firstWindow();
  const errors = [], steps = [];
  win.on('pageerror', e => errors.push('pageerror: ' + e.message));
  win.on('console', m => { if (m.type() === 'error' && !/camera|getUserMedia|NotFound|NotAllowed|Permission|Requested device|Could not start video/i.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); });
  win.on('dialog', d => d.accept());
  await win.setViewportSize({width: 1440, height: 900}); await win.waitForTimeout(2000);
  await win.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
  const userData = await app.evaluate(({app}) => app.getPath('userData'));
  const dataDir = path.join(userData, 'data');
  const shot = n => win.screenshot({path: path.join(out, n + '.png')}).catch(() => {});
  const step = async (name, fn) => { const t = Date.now(); try { const r = await fn(); steps.push({name, ok: true, ms: Date.now() - t, note: r === undefined ? '' : String(r).slice(0, 200)}); } catch (e) { steps.push({name, ok: false, ms: Date.now() - t, error: String(e.message || e).split('\n')[0].slice(0, 200)}); } await win.waitForTimeout(300); };
  const click = sel => win.evaluate(s => { const e = document.querySelector(s); if (!e) throw new Error('missing ' + s); e.click(); }, sel);
  const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

  await step('홈 화면', async () => { await shot('01_home'); return await win.evaluate(() => document.querySelector('.work-version')?.textContent); });
  await step('홈 스캔 입력', async () => { await win.fill('#home-scan-input', 'RG0001'); await click('#home-scan-submit'); await win.waitForTimeout(600); await win.keyboard.press('Escape'); });
  await step('스캔 탭 + QR 라이브러리', async () => { await click('#side-scan-btn'); await win.waitForTimeout(3500); const t = await win.evaluate(() => typeof Html5Qrcode); expect(t === 'function', 'QR 라이브러리 없음: ' + t); return t; });
  await step('수동 코드 입력', async () => { await win.fill('#manual-code', 'RG0001'); await click('#manual-code-submit'); await win.waitForTimeout(600); await win.keyboard.press('Escape'); });
  await step('시약 재고현황', async () => { await click('#side-reagent-btn'); await win.waitForTimeout(500); await shot('02_dashboard'); });
  await step('검색·필터·정렬', async () => { await win.fill('#search-input', '황'); await win.fill('#search-input', ''); const sel = win.locator('#ghs-filter'); for (const v of await sel.locator('option').evaluateAll(o => o.map(x => x.value))) await sel.selectOption(v); await sel.selectOption('all'); for (const v of ['name', 'expiry', 'stock', 'received', 'id']) await win.locator('#sort-select').selectOption(v); });
  await step('상세 열기', async () => { await win.locator('tr[data-id="RG0001"] td.id-cell').click(); await win.waitForTimeout(800); await shot('03_detail'); });
  await step('KOSHA MSDS 받기', async () => {
    await win.locator('#ghs-panel button', {hasText: 'MSDS 받기'}).click();
    await win.waitForFunction(() => /저장했습니다|첨부 완료|실패/.test(document.querySelector('#ghs-kosha-status')?.textContent || ''), null, {timeout: 240000}); await win.waitForTimeout(1500);
    const s = await win.locator('#ghs-kosha-status').innerText(); expect(!/실패/.test(s), s);
    const inv = JSON.parse(fs.readFileSync(path.join(dataDir, 'inventory.json'), 'utf8')); const d = inv.reagents[0].msdsDocuments || [];
    expect(d.length === 1 && d[0].koshaFormat === 2, '문서 상태 이상 ' + JSON.stringify(d.map(x => [x.file, x.koshaFormat])));
    expect(inv.reagents[0].ghs && inv.reagents[0].ghs.pictograms.length, 'GHS 비어 있음');
    const f = path.join(dataDir, 'msds', d[0].file); expect(fs.existsSync(f), '원본 파일 없음 ' + f); fs.copyFileSync(f, path.join(out, d[0].file));
    await shot('04_after_kosha'); return d[0].file + ' / ' + inv.reagents[0].ghs.pictograms.join(',');
  });
  await step('다시 받기(교체)', async () => {
    await win.locator('#ghs-panel button', {hasText: 'MSDS 받기'}).click();
    await win.waitForFunction(() => /바꿨습니다|실패/.test(document.querySelector('#ghs-kosha-status')?.textContent || ''), null, {timeout: 240000}); await win.waitForTimeout(1500);
    const inv = JSON.parse(fs.readFileSync(path.join(dataDir, 'inventory.json'), 'utf8')); const d = inv.reagents[0].msdsDocuments || [];
    const files = fs.readdirSync(path.join(dataDir, 'msds'));
    expect(d.length === 1, '문서가 ' + d.length + '개'); expect(files.length === 1 && files[0] === d[0].file, '파일 ' + JSON.stringify(files));
    // 분류가 이미 있는 품목은 읽어온 값을 확인 화면으로 보여준다. 기존 분류를 유지하고 닫는다.
    const review = await win.locator('#ghs-panel button', {hasText: '취소'}).count(); if (review) await win.locator('#ghs-panel button', {hasText: '취소'}).first().click();
    return files.join(',') + (review ? ' (확인 화면 표시됨)' : '');
  });
  await step('GHS 접기·펼치기', async () => { await win.locator('#ghs-panel .ghs-fold>summary').click(); await win.waitForTimeout(200); await win.locator('#ghs-panel .ghs-fold>summary').click(); });
  await step('GHS 편집 열기·취소', async () => { await win.locator('#ghs-panel button', {hasText: '편집'}).click(); await win.locator('#ghs-panel .ghs-more>summary').click(); await shot('05_edit'); await win.locator('#ghs-panel button', {hasText: '취소'}).first().click(); });
  await step('GHS 다시 읽기', async () => { await win.locator('#ghs-panel button', {hasText: '다시 읽기'}).click(); await win.waitForTimeout(4000); const t = await win.locator('#ghs-panel').innerText(); const c = win.locator('#ghs-panel button', {hasText: '취소'}); if (await c.count()) await c.first().click(); return t.replace(/\s+/g, ' ').slice(0, 120); });
  await step('PDF 미리보기 창', async () => {
    const [pv] = await Promise.all([app.waitForEvent('window', {timeout: 20000}), win.locator('#msds-panel button', {hasText: '미리보기'}).first().click()]);
    await pv.waitForTimeout(1500); const u = pv.url(); await pv.close(); expect(/\.pdf$/i.test(u), u); return u.split('/').pop();
  });
  await step('입고회차 QR', async () => { const btn = win.locator('#detail-modal-box .batch-qr-btn').first(); if (await btn.count()) { await btn.click(); await win.waitForTimeout(500); await win.keyboard.press('Escape'); } });
  await step('상세 저장·닫기', async () => { await click('#detail-save-btn'); await win.waitForTimeout(600); await win.keyboard.press('Escape'); });
  await step('등록 + CAS 물질명', async () => {
    await win.locator('nav.tabs button[data-tab="register"]').click(); await win.fill('#f-cas', '7697-37-2'); await win.locator('#f-spec').click();
    await win.waitForFunction(() => { const t = document.getElementById('f-cas-note')?.textContent || ''; return t && !/찾는 중/.test(t); }, null, {timeout: 60000});
    const name = await win.inputValue('#f-name'); await click('#reg-submit-btn'); await win.waitForTimeout(1000); await shot('06_register'); return name;
  });
  await step('라벨 미리보기', async () => { const btn = win.locator('#new-label-print'); if (await btn.isVisible()) { await btn.click(); await win.waitForTimeout(600); await shot('07_label'); await click('#label-preview-cancel'); } });
  await step('표준물질', async () => { await click('#side-standard-btn'); await win.waitForTimeout(400); await win.locator('tr[data-id="ST0001"] td.id-cell').click(); await win.waitForTimeout(600); await win.keyboard.press('Escape'); });
  await step('MSDS 관리', async () => { await click('#side-msds-btn'); await win.waitForTimeout(1000); await shot('08_msds'); const s = win.locator('#msds-manager-panel input[type=search]'); await s.fill('황'); await s.fill(''); });
  await step('화학물질 목록 인쇄 창', async () => {
    const [rw] = await Promise.all([app.waitForEvent('window', {timeout: 20000}), win.locator('#msds-manager-panel button', {hasText: '목록 인쇄'}).click()]);
    await rw.waitForTimeout(1200); const n = await rw.evaluate(() => document.querySelectorAll('tbody tr').length); await rw.screenshot({path: path.join(out, '09_report.png')}).catch(() => {}); await rw.close(); expect(n >= 3, '행 ' + n); return n + '행';
  });
  await step('서식', async () => { await click('#side-forms-btn'); await win.waitForTimeout(600); for (const btn of await win.locator('#form-template-selector button[data-template]').all()) await btn.click(); });
  await step('설정', async () => { await click('#side-settings-btn'); await win.waitForTimeout(1200); await shot('10_settings'); });
  await step('지금 백업', async () => {
    await click('#settings-backup-now'); await win.waitForTimeout(2000);
    const bdir = path.join(dataDir, 'backups'); const list = fs.readdirSync(bdir); const m = fs.existsSync(path.join(bdir, 'msds')) ? fs.readdirSync(path.join(bdir, 'msds')) : [];
    expect(list.some(f => f.startsWith('manual_')), '수동 백업 없음'); expect(m.length >= 1, 'MSDS 사본 없음'); return list.length + '개 / PDF 사본 ' + m.join(',');
  });
  await step('묶음 저장(zip)', async () => { await click('#settings-export-bundle'); await win.waitForTimeout(3000); expect(fs.existsSync(bundlePath), 'zip 없음'); return fs.statSync(bundlePath).size + ' bytes'; });
  await step('묶음에서 복원', async () => {
    for (const f of fs.readdirSync(path.join(dataDir, 'msds'))) fs.unlinkSync(path.join(dataDir, 'msds', f));
    fs.rmSync(path.join(dataDir, 'backups', 'msds'), {recursive: true, force: true});
    await click('#settings-restore-backup'); await win.waitForTimeout(4000);
    const files = fs.readdirSync(path.join(dataDir, 'msds')); expect(files.length >= 1, 'PDF 복원 안 됨');
    const left = fs.readdirSync(path.join(dataDir, 'backups')).filter(n => n.startsWith('import-')); expect(!left.length, '임시 폴더 남음'); return files.join(',');
  });
  await step('MSDS 삭제', async () => {
    await click('#side-msds-btn'); await win.waitForTimeout(800);
    await win.locator('#msds-mgr-table tr').filter({hasText: 'RG0001 · 황산'}).locator('.msds-mgr-doc button', {hasText: '삭제'}).first().click(); await win.waitForTimeout(1500);
    const inv = JSON.parse(fs.readFileSync(path.join(dataDir, 'inventory.json'), 'utf8')); expect(!(inv.reagents[0].msdsDocuments || []).length, '문서 남음');
    expect(!fs.readdirSync(path.join(dataDir, 'msds')).length, '파일 남음');
  });
  await step('통합 검색', async () => { await win.keyboard.press('Control+K'); await win.fill('#quick-search-input', '황산'); await win.waitForTimeout(300); await win.keyboard.press('Escape'); });
  await step('다크 모드', async () => { await click('#side-settings-btn'); await win.locator('#settings-theme').selectOption('dark'); await click('#side-reagent-btn'); await win.waitForTimeout(400); await shot('11_dark'); await click('#side-settings-btn'); await win.locator('#settings-theme').selectOption('system'); });

  const report = {userData, version: await win.evaluate(() => document.querySelector('.work-version')?.textContent), steps, errors};
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  for (const s of steps) console.log((s.ok ? 'OK  ' : 'FAIL') + ' ' + s.name + ' (' + s.ms + 'ms) ' + (s.ok ? s.note : s.error));
  console.log('errors', JSON.stringify(errors));
  await app.close();
  if (steps.some(s => !s.ok) || errors.length) process.exit(1);
})().catch(e => { console.error(String(e)); process.exit(1); });
