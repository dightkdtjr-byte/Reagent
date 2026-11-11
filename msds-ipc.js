'use strict';
const path = require('path');
const {fileURLToPath, pathToFileURL} = require('url');
const {validateDocument} = require('./msds-store');
const GHSExtract = require('./ghs-extract');
// Only the trusted main inventory window can select/open/export local PDF objects.
function registerMSDSHandlers({ipcMain, dialog, shell, BrowserWindow, store, documentPath}) {
  let dialogBusy = false;
  const isTrusted = event => {
    try {
      const frame = event.senderFrame;
      const url = frame?.url || event.sender?.getURL?.();
      if (!url || !url.startsWith('file:')) return false;
      if (frame && event.sender?.mainFrame && frame !== event.sender.mainFrame) return false;
      return path.resolve(fileURLToPath(url)) === path.resolve(documentPath);
    } catch { return false; }
  };
  function handle(name, fn) {
    ipcMain.handle('inventory-msds:' + name, async (event, ...args) => {
      if (!isTrusted(event)) return {ok: false, error: '허용되지 않은 MSDS 요청입니다.'};
      try { return await fn(event, ...args); }
      catch (e) { return {ok: false, error: String(e?.message || e)}; }
    });
  }
  async function withDialog(fn) {
    if (dialogBusy) return {ok: false, error: '열려 있는 파일 선택 창을 먼저 닫아주세요.'};
    dialogBusy = true;
    try { return await fn(); } finally { dialogBusy = false; }
  }
  handle('choose', event => withDialog(async () => {
    const opts = {title: 'MSDS / SDS PDF 첨부', properties: ['openFile', 'multiSelections'], filters: [{name: 'MSDS / SDS PDF', extensions: ['pdf']}]};
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (result.canceled) return {ok: true, canceled: true, documents: []};
    return store.importFiles(result.filePaths || []);
  }));
  handle('list', (_event, docs) => store.list(docs));
  // 저장 파일명을 품목코드_물질명_CAS.pdf로 맞춘다 (렌더러가 저장 직전에 호출).
  handle('relabel', (_event, doc, meta) => store.relabel(doc, meta && typeof meta === 'object' ? {itemId: String(meta.itemId || '').slice(0, 12), name: String(meta.name || '').slice(0, 60), casNo: String(meta.casNo || '').slice(0, 20)} : {}));
  handle('delete', (_event, doc) => store.deleteFile(doc));
  handle('open', async (_event, doc) => {
    validateDocument(doc);
    const file = store.openPath(doc);
    const error = await shell.openPath(file);
    return error ? {ok: false, error} : {ok: true};
  });
  handle('export', (event, doc) => withDialog(async () => {
    validateDocument(doc);
    store.openPath(doc);
    const opts = {title: 'MSDS PDF 다른 이름으로 저장', defaultPath: doc.fileName, filters: [{name: 'PDF 문서', extensions: ['pdf']}], properties: ['showOverwriteConfirmation']};
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (result.canceled || !result.filePath) return {ok: true, canceled: true};
    return store.exportFile(doc, result.filePath);
  }));
  // 앱 안에서 PDF를 연다. Chromium 내장 PDF 뷰어를 사용하므로 별도 프로그램이 없어도 된다.
  const previews = new Map();
  handle('preview', async (event, doc) => {
    validateDocument(doc);
    const file = store.openPath(doc);
    const existing = previews.get(doc.id);
    if (existing && !existing.isDestroyed()) { existing.focus(); return {ok: true, reused: true}; }
    const parent = BrowserWindow.fromWebContents(event.sender);
    const win = new BrowserWindow({
      width: 1000, height: 820, minWidth: 480, minHeight: 360, autoHideMenuBar: true, title: doc.fileName,
      parent: parent && !parent.isDestroyed() ? parent : undefined,
      webPreferences: {sandbox: true, contextIsolation: true, nodeIntegration: false, plugins: true, webSecurity: true}
    });
    previews.set(doc.id, win);
    win.on('closed', () => { if (previews.get(doc.id) === win) previews.delete(doc.id); });
    win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
    win.webContents.on('will-navigate', e => e.preventDefault());
    win.setMenuBarVisibility(false);
    await win.loadURL(pathToFileURL(file).href);
    win.setTitle(doc.fileName);
    return {ok: true};
  });
  // 렌더러가 만든 인쇄용 보고서(화학물질 목록 등)를 별도 창에 띄운다. 창 안의 '인쇄' 버튼이 시스템 인쇄창을 연다.
  let reportWin = null;
  handle('report', async (event, payload) => {
    const html = String(payload?.html || '');
    const title = String(payload?.title || '보고서').slice(0, 80);
    if (!html || html.length > 4 * 1024 * 1024) throw new Error('보고서 내용이 비어 있거나 너무 큽니다.');
    if (reportWin && !reportWin.isDestroyed()) { try { reportWin.close(); } catch {} }
    const parent = BrowserWindow.fromWebContents(event.sender);
    reportWin = new BrowserWindow({
      width: 1100, height: 860, minWidth: 600, minHeight: 400, autoHideMenuBar: true, title,
      parent: parent && !parent.isDestroyed() ? parent : undefined,
      webPreferences: {sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true}
    });
    reportWin.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
    reportWin.webContents.on('will-navigate', e => e.preventDefault());
    reportWin.setMenuBarVisibility(false);
    await reportWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    reportWin.setTitle(title);
    return {ok: true};
  });
  // 첨부된 MSDS에서 GHS 항목을 읽는다. 결과는 렌더러에서 사용자가 확인한 뒤 저장한다.
  handle('extract', async (_event, doc) => {
    validateDocument(doc);
    const {text, pages} = await store.textOf(doc);
    const result = GHSExtract.extract(text);
    return {...result, pages, fileName: doc.fileName, documentId: doc.id};
  });
  handle('folder', async () => {
    const dir = store.directory(), error = await shell.openPath(dir);
    return error ? {ok: false, error} : {ok: true, path: dir};
  });
}
module.exports = {registerMSDSHandlers};
