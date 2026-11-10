const { app, BrowserWindow, ipcMain, shell, dialog, net, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');

function dataDir(){
  const dir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dir, { recursive:true });
  return dir;
}
function dbFile(){ return path.join(dataDir(), 'inventory.json'); }
const {createBackupStore, atomicWriteJson: writeJson, validateInventory} = require('./backup-store');
const {createMSDSStore} = require('./msds-store');
const msds = createMSDSStore(dataDir);
require('./msds-ipc').registerMSDSHandlers({ipcMain, dialog, shell, BrowserWindow, store: msds, documentPath: path.join(__dirname, 'reagent-inventory.html')});
const safetyStore = require('./safety-store').createSafetyStore({dataDir,msds,catalog:require('./safety-catalog.json'),fetchBytes:require('./safety-network').createDownloader(()=>net)});
const kosha = require('./kosha-msds').createKoshaClient({net:()=>net, BrowserWindow, msds, extract:require('./ghs-extract').extract});
require('./safety-ipc').registerSafetyHandlers({ipcMain,shell,clipboard,store:safetyStore,documentPath:path.join(__dirname,'reagent-inventory.html'),kosha});
const backups = createBackupStore(dataDir, {msdsStore: msds});
const backupSourceTokens = new Map();
const {writeZip, readZip} = require('./zip-bundle');
// zip 묶음에서 꺼낸 임시 폴더는 복원이 끝나면 지운다.
function dropSourceToken(token){
  const src = backupSourceTokens.get(token); backupSourceTokens.delete(token);
  if (src && src.temp) { try { fs.rmSync(src.temp, {recursive:true, force:true}); } catch {} }
}
function sourceDirectory(token){ const src = typeof token === 'string' ? backupSourceTokens.get(token) : undefined; return src ? src.msds : undefined; }
function backupDir(){ return backups.dir(); }
function backupMetaFile(){ return path.join(dataDir(), 'backup-status.json'); }
function safeReadJson(p){ try { if(!fs.existsSync(p)) return null; return JSON.parse(fs.readFileSync(p,'utf8')); } catch(e){ console.error('read db failed',e); return null; } }
function atomicWriteJson(p, obj){ return writeJson(p, obj, true); }
ipcMain.handle('inventory:load', async ()=> safeReadJson(dbFile()));
ipcMain.handle('inventory:save', async (_evt, obj)=> {
  try {
    validateInventory(obj);
    atomicWriteJson(dbFile(), obj);
  } catch(e) {
    console.error('inventory save failed', e);
    const code = e && e.code ? ' ['+e.code+']' : '';
    return {ok:false, error:String(e && e.message || e)+code, path:dbFile()};
  }
  return {ok:true, backup:backups.automatic(obj)};
});
ipcMain.handle('inventory:backup-status', async ()=> backups.status());
ipcMain.handle('inventory:backup-list', async ()=> backups.list(safeReadJson(dbFile())));
ipcMain.handle('inventory:inspect-backup', async (_evt, name)=> backups.inspect(name));
ipcMain.handle('inventory:open-backup-folder', async ()=> {
  try { const p=backupDir(); const error=await shell.openPath(p); return error?{ok:false,error}:{ok:true,path:p}; }
  catch(e) { return {ok:false,error:String(e&&e.message||e)}; }
});
ipcMain.handle('inventory:backup-now', async (_evt, obj)=> backups.snapshot(obj));
// 재고 JSON과 첨부 MSDS PDF를 zip 한 파일로 내보낸다. 다른 PC로 옮기거나 보관할 때 쓴다.
ipcMain.handle('inventory:export-bundle', async (evt, obj)=> {
  try{
    validateInventory(obj);
    const stamp = new Date().toISOString().slice(0,19).replace(/[-:]/g,'').replace('T','_');
    const win = BrowserWindow.fromWebContents(evt.sender);
    const result = await dialog.showSaveDialog(win, {title:'백업 묶음 저장 (재고 + MSDS PDF)', defaultPath: path.join(app.getPath('documents'), `시약재고_백업_${stamp}.zip`), filters:[{name:'zip 묶음', extensions:['zip']}]});
    if (result.canceled || !result.filePath) return {ok:true, canceled:true};
    const target = /\.zip$/i.test(result.filePath) ? result.filePath : result.filePath + '.zip';
    const entries = [{name:'inventory.json', data: Buffer.from(JSON.stringify(obj, null, 2), 'utf8')}];
    const missing = [];
    const seen = new Set();
    for (const item of obj.reagents || []) for (const doc of item.msdsDocuments || []) {
      if (seen.has(doc.sha256)) continue; seen.add(doc.sha256);
      try { const {file, bytes} = msds.openPathWithBytes(doc); entries.push({name:'msds/' + path.basename(file), data: bytes}); }
      catch { missing.push(doc.fileName); }
    }
    const r = writeZip(target, entries);
    return {ok:true, canceled:false, path:target, documents: seen.size - missing.length, missing, bytes: r.bytes};
  }catch(e){ console.error('export bundle failed', e); return {ok:false, error:String(e && e.message || e)}; }
});
ipcMain.handle('inventory:restore', async (_evt, candidate, current, sourceToken)=> {
  try {
    validateInventory(candidate); validateInventory(current);
    // Preserve the user's current screen, printer and backup settings when restoring inventory.
    const restored={...candidate, settings:current.settings||{}};
    const externalDirectory = sourceDirectory(sourceToken);
    // Immutable copies may be restored, but the inventory stays untouched on ANY missing PDF.
    const restoredMSDS = msds.restoreFiles(restored, externalDirectory);
    const safety=backups.snapshot(current, 'before_restore', current);
    if(!safety.ok) return {ok:false,error:'복원 전 안전 사본을 저장하지 못해 복원을 중단했습니다. '+safety.error};
    atomicWriteJson(dbFile(),restored);
    if (sourceToken) dropSourceToken(sourceToken);
    const backup=backups.automatic(restored);
    return {ok:true, backup, safetyPath:safety.path, warning:safety.warning||'', msds:restoredMSDS, data:restored};
  } catch(e) { return {ok:false,error:String(e&&e.message||e)}; }
});
ipcMain.handle('inventory:reset-all', async (_evt, cleanDb)=> {
  try{
    if(safetyStore.busy()) return {ok:false,error:'MSDS 자료 다운로드를 마친 뒤 초기화해주세요.'};
    safetyStore.clear();
    for (const t of [...backupSourceTokens.keys()]) dropSourceToken(t);
    fs.rmSync(msds.directory(), {recursive:true,force:true});
    const dir=dataDir();
    // 현재 DB, 이전본, 임시파일 삭제
    [dbFile(), dbFile()+'.prev', dbFile()+'.tmp', backupMetaFile()].forEach(p=>{ try{ if(fs.existsSync(p)) fs.unlinkSync(p); }catch{} });
    // 과거 자동 백업도 모두 삭제
    const bdir=path.join(dir,'backups');
    try{ if(fs.existsSync(bdir)) fs.rmSync(bdir,{recursive:true,force:true}); }catch{}
    fs.mkdirSync(bdir,{recursive:true});
    // 설정은 유지한 빈 DB를 백업 생성 없이 저장
    const safeClean=(cleanDb && typeof cleanDb==='object') ? cleanDb : {schemaVersion:3,nextId:1,nextIdStd:1,reagents:[],logs:[]};
    writeJson(dbFile(), safeClean);
    backups.clearMemoryStatus();
    return {ok:true};
  }catch(e){
    console.error('reset all failed',e);
    return {ok:false,error:String(e && e.message || e)};
  }
});
ipcMain.handle('inventory:path', async ()=> dbFile());
ipcMain.handle('inventory:open-folder', async ()=> { const p=dataDir(); await shell.openPath(p); return p; });
ipcMain.handle('inventory:select-backup', async ()=> {
  const result = await dialog.showOpenDialog({
    title: '백업 불러오기',
    defaultPath: backupDir(),
    properties: ['openFile'],
    filters: [
      { name: '재고관리 백업 (JSON · zip 묶음)', extensions: ['json','zip'] },
      { name: '모든 파일', extensions: ['*'] }
    ]
  });
  if(result.canceled || !result.filePaths || !result.filePaths[0]) return {ok:false, canceled:true};
  const selectedPath = result.filePaths[0];
  try{
    const token = require('crypto').randomBytes(24).toString('hex');
    if (backupSourceTokens.size >= 10) dropSourceToken(backupSourceTokens.keys().next().value);
    let text, source;
    if (path.extname(selectedPath).toLowerCase() === '.zip') {
      // zip 묶음: inventory.json과 msds/*.pdf를 임시 폴더에 꺼내 일반 복원과 같은 경로로 처리한다.
      const entries = readZip(selectedPath);
      const json = entries.find(e => /(^|\/)inventory[^/]*\.json$/i.test(e.name)) || entries.find(e => /\.json$/i.test(e.name));
      if (!json) throw new Error('zip 안에 재고 백업 JSON이 없습니다.');
      text = json.data.toString('utf8');
      const temp = path.join(backupDir(), 'import-' + token.slice(0, 12));
      const msdsDir = path.join(temp, 'msds'); fs.mkdirSync(msdsDir, {recursive:true});
      for (const e of entries) {
        const m = e.name.match(/(?:^|\/)msds\/([^/]+\.pdf)$/i); if (!m) continue;
        fs.writeFileSync(path.join(msdsDir, m[1]), e.data, {flag:'wx'});
      }
      source = {msds: msdsDir, temp};
    } else {
      text = fs.readFileSync(selectedPath, 'utf8');
      source = {msds: path.join(path.dirname(selectedPath), 'msds')};
    }
    backupSourceTokens.set(token, source);
    return {ok:true, canceled:false, path:selectedPath, text, sourceToken:token};
  }catch(e){
    console.error('backup select/read failed', e);
    return {ok:false, canceled:false, error:String(e && e.message || e)};
  }
});

ipcMain.handle('window:maximize', async (evt)=> {
  const win = BrowserWindow.fromWebContents(evt.sender);
  if(!win || win.isDestroyed()) return {ok:false};
  try{
    if(!win.isMaximized()) win.maximize();
    win.show();
    win.focus();
    win.webContents.focus();
    return {ok:true};
  }catch(e){
    console.error('window maximize failed', e);
    return {ok:false, error:String(e && e.message || e)};
  }
});



ipcMain.handle('window:focus-input', async (evt)=> {
  const win = BrowserWindow.fromWebContents(evt.sender);
  if(!win || win.isDestroyed()) return {ok:false};
  try{
    if(win.isMinimized()) win.restore();
    if(!win.isVisible()) win.show();
    win.focus();
    win.webContents.focus();
    return {ok:true};
  }catch(e){
    console.error('window input focus failed',e);
    return {ok:false,error:String(e&&e.message||e)};
  }
});


// 카메라 스캔 결과창을 닫은 뒤 Windows 포커스가 영상 캡처 계층에 남는 경우가 있다.
// 사용자가 Alt+Tab으로 창을 나갔다 돌아왔을 때 복구되는 동작을 앱 내부에서 그대로 재현한다.
ipcMain.handle('window:hard-focus-input', async (evt, requestedId)=> {
  const win = BrowserWindow.fromWebContents(evt.sender);
  if(!win || win.isDestroyed()) return {ok:false};
  const allowed = new Set(['home-scan-input','manual-code']);
  const elementId = allowed.has(String(requestedId||'')) ? String(requestedId) : 'manual-code';
  const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));
  try{
    if(win.isMinimized()) win.restore();
    if(!win.isVisible()) win.show();

    // 이미 active 상태라고 Chromium이 착각하는 경우 target.focus()만으로는 캐럿이 살아나지 않는다.
    // 한 번 실제 창 focus를 끊었다가 되찾아 renderer의 window focus 이벤트까지 다시 발생시킨다.
    try{ win.blur(); }catch{}
    await wait(28);
    if(win.isDestroyed()) return {ok:false};
    try{ win.show(); }catch{}
    try{ win.moveTop(); }catch{}
    try{ win.focus(); }catch{}
    try{ win.webContents.focus(); }catch{}
    await wait(34);

    if(win.isDestroyed() || win.webContents.isDestroyed()) return {ok:false};
    const js = `(()=>{
      const el=document.getElementById(${JSON.stringify(elementId)});
      if(!el || el.disabled || el.readOnly || el.offsetParent===null) return false;
      try{el.blur();}catch{}
      try{document.body&&document.body.focus&&document.body.focus();}catch{}
      try{el.focus({preventScroll:true});}catch(e){try{el.focus();}catch{}}
      try{const n=String(el.value||'').length;el.setSelectionRange(n,n);}catch{}
      return document.activeElement===el;
    })()`;
    const focused = await win.webContents.executeJavaScript(js, true).catch(()=>false);
    return {ok:true,focused:!!focused};
  }catch(e){
    console.error('window hard input focus failed',e);
    return {ok:false,error:String(e&&e.message||e)};
  }
});

// 연결된 Windows 프린터 목록. 설정 화면의 프린터 선택에 사용합니다.
ipcMain.handle('printer:list', async (evt)=> {
  const win=BrowserWindow.fromWebContents(evt.sender);
  if(!win || win.isDestroyed()) return {ok:false,printers:[]};
  try{
    const printers=await win.webContents.getPrintersAsync();
    return {ok:true,printers:(printers||[]).map(p=>({name:p.name,displayName:p.displayName||p.name,isDefault:!!p.isDefault,status:p.status||0}))};
  }catch(e){
    console.error('printer list failed',e);
    return {ok:false,printers:[],error:String(e&&e.message||e)};
  }
});

// 설정에서 프린터를 지정한 경우 62×29mm 라벨을 해당 프린터로 직접 전송합니다.
ipcMain.handle('printer:print-html', async (_evt, payload)=> {
  const html=String(payload&&payload.html||'');
  const deviceName=String(payload&&payload.deviceName||'').trim();
  if(!html || !deviceName) return {ok:false,error:'printer or html missing'};
  let printWin=null;
  try{
    printWin=new BrowserWindow({show:false,width:800,height:420,autoHideMenuBar:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
    await printWin.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));
    try{await printWin.webContents.executeJavaScript('document.fonts&&document.fonts.ready?document.fonts.ready.then(()=>true):true');}catch{}
    await new Promise(r=>setTimeout(r,120));
    const pageWidthMm=Math.max(15,Math.min(200,Number(payload&&payload.pageWidthMm)||62));
    const pageHeightMm=Math.max(15,Math.min(200,Number(payload&&payload.pageHeightMm)||29));
    const result=await new Promise(resolve=>{
      printWin.webContents.print({
        silent:true,
        printBackground:true,
        deviceName,
        margins:{marginType:'none'},
        pageSize:{width:Math.round(pageWidthMm*1000),height:Math.round(pageHeightMm*1000)},
        landscape:false
      },(success,failureReason)=>resolve({ok:!!success,error:failureReason||''}));
    });
    return result;
  }catch(e){
    console.error('native label print failed',e);
    return {ok:false,error:String(e&&e.message||e)};
  }finally{
    if(printWin && !printWin.isDestroyed()) setTimeout(()=>{try{printWin.destroy();}catch{}},50);
  }
});

ipcMain.handle('inventory:uninstall', async ()=> {
  const candidates=[path.join(path.dirname(process.execPath),'Uninstall.exe'), path.join(process.resourcesPath,'..','Uninstall.exe')];
  const p=candidates.find(x=>fs.existsSync(x));
  if(!p) return {ok:false};
  const result=await shell.openPath(p);
  if(result) return {ok:false,error:result};
  return {ok:true};
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 920,
    minHeight: 680,
    icon: path.join(__dirname, 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });
  // Windows에서 인쇄/확인/저장 대화상자 사용 후 키보드 포커스가 빠지는 현상 방지
  const refocusRenderer = () => {
    setTimeout(() => {
      if(!win.isDestroyed()){
        try{ win.focus(); }catch{}
        try{ win.webContents.focus(); }catch{}
      }
    }, 40);
  };
  win.on('focus', refocusRenderer);
  win.on('restore', refocusRenderer);
  win.webContents.on('did-finish-load', () => {
    try{ if(!win.isMaximized()) win.maximize(); }catch{}
    refocusRenderer();
  });
  // 처음부터 넓게 사용하도록 최대화 상태로 시작
  try{ win.maximize(); }catch{}
  win.loadFile('reagent-inventory.html');

  // Excel 내보내기 완료 후 저장된 파일이 있는 폴더를 자동으로 연다.
  win.webContents.session.on('will-download', (_event, item) => {
    const filename = String(item.getFilename() || '');
    if(!filename.toLowerCase().endsWith('.xlsx')) return;
    item.once('done', (_evt, state) => {
      if(state !== 'completed') return;
      const savedPath = item.getSavePath();
      if(!savedPath) return;
      setTimeout(() => {
        try{ shell.showItemInFolder(savedPath); }catch(e){
          try{ shell.openPath(path.dirname(savedPath)); }catch{}
        }
      }, 180);
    });
  });
}

// 한 번에 하나의 프로그램 창만 허용한다.
// 이미 실행 중인 상태에서 다시 실행하면 새 창을 만들지 않고 기존 창을 앞으로 가져온다.
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if(!win || win.isDestroyed()) return;
    try{ if(win.isMinimized()) win.restore(); }catch{}
    try{ if(!win.isVisible()) win.show(); }catch{}
    try{ if(!win.isMaximized()) win.maximize(); }catch{}
    try{ win.focus(); }catch{}
    try{ win.webContents.focus(); }catch{}
  });

  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
