'use strict';
// Windows 실행기(GitHub Actions)에서 KOSHA MSDS 받기를 실제로 돌려 PDF를 만든다. 결과 PDF는 아티팩트로 올린다.
// 사용: node scripts/win-msds-test.js <electron 실행파일> <앱 폴더> <CAS> <물질명> <출력 폴더>
const {_electron: electron} = require('playwright');
const fs = require('fs'), path = require('path');
(async () => {
  const [exe, appDir, cas, name, outDir] = process.argv.slice(2);
  const home = path.resolve(outDir, 'home'); fs.rmSync(home, {recursive: true, force: true});
  const ud = path.join(home, 'AppData', 'Roaming', 'reagent-inventory', 'data'); fs.mkdirSync(path.join(ud, 'msds'), {recursive: true});
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(ud, 'inventory.json'), JSON.stringify({schemaVersion: 3, nextId: 2, nextIdStd: 1, reagents: [{id: 'RG0001', name, casNo: cas, unit: '병', category: 'reagent', stock: 1, minStock: 0, createdAt: now, updatedAt: now, batches: [{batchId: 'B001', receivedDate: '2026-10-02', expiryDate: '', lotNo: '', initialQty: 1, stock: 1, createdAt: now}]}], logs: [], settings: {autoFetchMsds: false}}));
  const app = await electron.launch({executablePath: exe, args: [appDir], env: {...process.env, APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'), USERPROFILE: home, HOME: home}});
  const win = await app.firstWindow(); const errors = []; win.on('pageerror', e => errors.push(e.message));
  await win.waitForTimeout(2000);
  const userData = await app.evaluate(({app}) => app.getPath('userData'));
  console.log('userData', userData);
  await win.evaluate(() => document.getElementById('side-reagent-btn').click()); await win.waitForTimeout(500);
  await win.locator('tr[data-id="RG0001"] td.id-cell').click(); await win.waitForTimeout(800);
  await win.locator('#ghs-panel button', {hasText: 'MSDS 받기'}).click();
  await win.waitForFunction(() => /저장했습니다|첨부 완료|실패|찾지 못했습니다/.test(document.querySelector('#ghs-kosha-status')?.textContent || ''), null, {timeout: 240000});
  await win.waitForTimeout(1000);
  console.log('status', (await win.locator('#ghs-kosha-status').innerText().catch(() => '')).slice(0, 200));
  const msdsDir = path.join(userData, 'data', 'msds');
  const files = fs.existsSync(msdsDir) ? fs.readdirSync(msdsDir).filter(f => f.endsWith('.pdf')) : [];
  console.log('files', files);
  fs.mkdirSync(path.resolve(outDir, 'pdf'), {recursive: true});
  for (const f of files) fs.copyFileSync(path.join(msdsDir, f), path.resolve(outDir, 'pdf', f));
  console.log('errors', JSON.stringify(errors));
  await app.close();
  if (!files.length) process.exit(1);
})().catch(e => { console.error(String(e)); process.exit(1); });
