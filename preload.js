const { contextBridge, ipcRenderer } = require('electron');
const QRCodeEncoder = require('./vendor/QRCode');

function qrMatrix(text){
  const qr = new QRCodeEncoder(-1, 0); // M error correction
  qr.addData(String(text || ''));
  qr.make();
  const n = qr.getModuleCount();
  const modules = new Array(n);
  for(let r=0;r<n;r++){
    modules[r] = new Array(n);
    for(let c=0;c<n;c++) modules[r][c] = !!qr.isDark(r,c);
  }
  return modules;
}

contextBridge.exposeInMainWorld('inventoryStore', {
  load: () => ipcRenderer.invoke('inventory:load'),
  save: (data) => ipcRenderer.invoke('inventory:save', data),
  resetAll: (cleanData) => ipcRenderer.invoke('inventory:reset-all', cleanData),
  path: () => ipcRenderer.invoke('inventory:path'),
  openFolder: () => ipcRenderer.invoke('inventory:open-folder'),
  selectBackup: () => ipcRenderer.invoke('inventory:select-backup'),
  backupNow: (data) => ipcRenderer.invoke('inventory:backup-now', data),
  exportBundle: (data) => ipcRenderer.invoke('inventory:export-bundle', data),
  backupStatus: () => ipcRenderer.invoke('inventory:backup-status'),
  listBackups: () => ipcRenderer.invoke('inventory:backup-list'),
  inspectBackup: (name) => ipcRenderer.invoke('inventory:inspect-backup', name),
  openBackupFolder: () => ipcRenderer.invoke('inventory:open-backup-folder'),
  restoreBackup: (candidate, current, sourceToken) => ipcRenderer.invoke('inventory:restore', candidate, current, sourceToken),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  focusWindow: () => ipcRenderer.invoke('window:focus-input'),
  hardFocusInput: (elementId) => ipcRenderer.invoke('window:hard-focus-input', elementId),
  listPrinters: () => ipcRenderer.invoke('printer:list'),
  printHtml: (payload) => ipcRenderer.invoke('printer:print-html', payload),
  uninstall: () => ipcRenderer.invoke('inventory:uninstall')
});

contextBridge.exposeInMainWorld('nativeQR', {
  matrix: (text) => qrMatrix(text)
});

// PDF paths are resolved only in the main process; no arbitrary path is accepted.
contextBridge.exposeInMainWorld('inventoryMSDS', {
  choose: () => ipcRenderer.invoke('inventory-msds:choose'),
  list: (documents) => ipcRenderer.invoke('inventory-msds:list', documents),
  open: (document) => ipcRenderer.invoke('inventory-msds:open', document),
  export: (document) => ipcRenderer.invoke('inventory-msds:export', document),
  preview: (document) => ipcRenderer.invoke('inventory-msds:preview', document),
  extract: (document) => ipcRenderer.invoke('inventory-msds:extract', document),
  folder: () => ipcRenderer.invoke('inventory-msds:folder'),
  report: (payload) => ipcRenderer.invoke('inventory-msds:report', payload),
  relabel: (document, meta) => ipcRenderer.invoke('inventory-msds:relabel', document, meta),
  delete: (document, opts) => ipcRenderer.invoke('inventory-msds:delete', document, opts)
});

// Curated source IDs only. No arbitrary URL or path accepted from renderer.
contextBridge.exposeInMainWorld('inventorySafety', {
 catalog:()=>ipcRenderer.invoke('inventory-safety:catalog'),
 history:()=>ipcRenderer.invoke('inventory-safety:history'),
 copy:(text)=>ipcRenderer.invoke('inventory-safety:copy',text),
 receive:(id)=>ipcRenderer.invoke('inventory-safety:receive',id),
 icons:(codes)=>ipcRenderer.invoke('inventory-safety:icons',codes),
 source:(id)=>ipcRenderer.invoke('inventory-safety:source',id),
 lookup:(kind,query)=>ipcRenderer.invoke('inventory-safety:lookup',kind,query),
 koshaSearch:(query)=>ipcRenderer.invoke('inventory-safety:kosha-search',query),
 koshaReceive:(chemId,meta)=>ipcRenderer.invoke('inventory-safety:kosha-receive',chemId,meta)
});
