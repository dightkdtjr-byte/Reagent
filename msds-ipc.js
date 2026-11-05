'use strict';
const path = require('path');
const {fileURLToPath} = require('url');
const {validateDocument} = require('./msds-store');
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
  handle('folder', async () => {
    const dir = store.directory(), error = await shell.openPath(dir);
    return error ? {ok: false, error} : {ok: true, path: dir};
  });
}
module.exports = {registerMSDSHandlers};
