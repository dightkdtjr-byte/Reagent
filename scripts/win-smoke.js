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
  // 저장 창 대신: zip은 bundlePath로, 엑셀·텍스트는 제안된 (한글) 파일명 그대로 home 폴더에 저장한다. 폴더 열기는 기록만 한다.
  await app.evaluate(({dialog, shell}, {p, dir, sep}) => {
    globalThis.__shown = [];
    dialog.showSaveDialog = async (w, o) => { const opts = o || w || {}; const base = String(opts.defaultPath || '').split(/[\\/]/).pop(); return {canceled: false, filePath: (!base || /\.zip$/i.test(base)) ? p : dir + sep + base}; };
    dialog.showOpenDialog = async () => ({canceled: false, filePaths: [p]}); dialog.showMessageBox = async () => ({response: 0});
    shell.showItemInFolder = f => { globalThis.__shown.push(f); };
  }, {p: bundlePath, dir: home, sep: path.sep});
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
  const today = (() => { const d = new Date(), p2 = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); })();
  const waitFile = async (name) => { const f = path.join(home, name); for (let i = 0; i < 60; i++) { if (fs.existsSync(f) && fs.statSync(f).size > 0) { await win.waitForTimeout(300); return f; } await win.waitForTimeout(250); } throw new Error('저장되지 않음: ' + name + ' / 폴더: ' + fs.readdirSync(home).join(', ')); };
  // 저장된 엑셀을 앱의 엑셀 읽기 기능으로 다시 열어 시트 이름과 행 수를 확인한다.
  const sheetsOf = file => win.evaluate(async b64 => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(u.buffer); return wb.worksheets.map(w => w.name + ':' + w.rows.size).join(', '); }, fs.readFileSync(file).toString('base64'));
  await step('대장 엑셀 저장 (한글 파일명)', async () => {
    await click('#side-reagent-btn'); await win.waitForTimeout(400); await click('#excel-export-btn');
    const f = await waitFile('시약대장_' + today + '.xlsx'); const s = await sheetsOf(f);
    expect(/재고현황:\d+/.test(s) && /입고회차별 재고/.test(s) && /입출고이력/.test(s) && /GHS·MSDS현황/.test(s), '시트 구성이 다름: ' + s);
    const shown = await app.evaluate(() => globalThis.__shown.length); expect(shown >= 1, '저장 후 폴더 열기가 호출되지 않음');
    return fs.statSync(f).size + ' bytes · ' + s;
  });
  await step('GHS·MSDS 현황 엑셀 저장', async () => { await click('#side-settings-btn'); await win.waitForTimeout(500); await click('#settings-ghs-export'); const f = await waitFile('GHS_MSDS현황_' + today + '.xlsx'); return await sheetsOf(f); });
  await step('일괄등록 양식 저장', async () => { await click('#side-reagent-btn'); await win.waitForTimeout(400); await click('#bulk-template-btn'); const f = await waitFile('시약_일괄등록양식.xlsx'); const s = await sheetsOf(f); expect(/시약목록/.test(s) && /작성예시/.test(s), '양식 시트가 다름: ' + s); return s; });
  await step('엑셀 일괄등록 (확인 → 등록 → 되돌리기)', async () => {
    // 양식을 앱의 엑셀 기능으로 채워 저장한 뒤 올린다.
    const b64 = await win.evaluate(async src => {
      const bin = atob(src), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const wb = new ExcelJS.Workbook(); await wb.xlsx.load(u.buffer); const ws = wb.worksheets[0];
      ws.getRow(3).values = ['점검용 톨루엔', 'Toluene', '1L', '병', 3, 1, new Date(2026, 10, 1), new Date(2028, 4, 31), '대정화금', '108-88-3', '', '', '인화성 시약장'];
      ws.getRow(4).values = ['점검용 오류행', '', '1L', '병', '많이', '', '', '2026-13-45', '', '', '', '', ''];
      const out = new Uint8Array(await wb.xlsx.writeBuffer()); let s = ''; for (let i = 0; i < out.length; i++) s += String.fromCharCode(out[i]); return btoa(s);
    }, fs.readFileSync(path.join(home, '시약_일괄등록양식.xlsx')).toString('base64'));
    const file = path.join(home, process.env.LOCAL_TEST ? 'bulk_import.xlsx' : '일괄등록_점검.xlsx'); fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    const before = JSON.parse(fs.readFileSync(path.join(dataDir, 'inventory.json'), 'utf8')).reagents.length;
    await win.setInputFiles('#bulk-import-file', file);
    await win.waitForSelector('#bulk-plan-apply', {timeout: 15000}); await shot('07b_bulk_plan');
    const chips = await win.locator('#scan-modal-box .bulk-summary').innerText();
    await click('#bulk-plan-apply'); await win.waitForSelector('#bulk-result-undo', {timeout: 15000}); await shot('07c_bulk_result');
    const mid = JSON.parse(fs.readFileSync(path.join(dataDir, 'inventory.json'), 'utf8')).reagents.length; expect(mid === before + 1, '등록 건수가 다름: ' + before + ' → ' + mid);
    await click('#bulk-result-undo'); await win.waitForTimeout(1200);
    const after = JSON.parse(fs.readFileSync(path.join(dataDir, 'inventory.json'), 'utf8')).reagents.length; expect(after === before, '되돌리기 후 건수가 다름: ' + after);
    return chips.replace(/\s+/g, ' ');
  });
  await step('상세: 유효기간 수정 반영', async () => {
    await win.locator('tr[data-id="RG0001"] td.id-cell').click(); await win.waitForTimeout(600);
    await win.fill('#d-expiry', '2029-12-31'); await click('#detail-save-btn'); await win.waitForTimeout(900);
    const r = JSON.parse(fs.readFileSync(path.join(dataDir, 'inventory.json'), 'utf8')).reagents.find(x => x.id === 'RG0001');
    expect(r.batches[0].expiryDate === '2029-12-31' && r.expiryDate === '2029-12-31', '유효기간이 반영되지 않음: ' + r.expiryDate + ' / ' + r.batches[0].expiryDate);
    await win.keyboard.press('Escape'); await win.waitForTimeout(300); return r.expiryDate;
  });
  await step('스캔 창: 수량 입력 후 Enter로 출고', async () => {
    await click('#home-btn'); await win.waitForTimeout(400); await win.fill('#home-scan-input', 'RG0001'); await win.locator('#home-scan-input').press('Enter'); await win.waitForSelector('#scan-qty', {timeout: 8000});
    const focused = await win.evaluate(() => document.activeElement && document.activeElement.id); expect(focused === 'scan-qty', '수량 칸에 포커스가 없음: ' + focused);
    await win.keyboard.press('Enter'); await win.waitForSelector('#scan-confirm-apply', {timeout: 8000}); await shot('07d_scan_confirm'); await win.keyboard.press('Enter'); await win.waitForTimeout(1000);
    const r = JSON.parse(fs.readFileSync(path.join(dataDir, 'inventory.json'), 'utf8')).reagents.find(x => x.id === 'RG0001'); expect(Number(r.stock) === 1, '출고 후 재고가 1이 아님: ' + r.stock);
    await click('#side-reagent-btn'); return '재고 2 → ' + r.stock;
  });
  await step('확인 창 한국어 버튼', async () => {
    await app.evaluate(({dialog}) => { globalThis.__boxes = []; dialog.showMessageBoxSync = (w, o) => { globalThis.__boxes.push(o || w); return 0; }; });
    const r = await win.evaluate(() => window.nativeDialog.confirm('점검용 확인 창'));
    const box = await app.evaluate(() => globalThis.__boxes[0]);
    expect(r === true && box && box.buttons[0] === '확인' && box.buttons[1] === '취소', '확인 창 버튼이 다름: ' + JSON.stringify(box && box.buttons) + ' / ' + r);
    return box.buttons.join('/');
  });
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
