'use strict';
// Windows에서 KOSHA 페이지를 우리 서식으로 바꾼 뒤 여러 방식으로 PDF를 만들어 비교한다 (서식 잘림 원인 조사용).
// 사용: node scripts/win-pdf-probe.js <electron 실행파일> <앱 폴더> <출력 폴더>
const {_electron: electron} = require('playwright');
const fs = require('fs'), path = require('path');
(async () => {
  const [exe, appDir, outDir] = process.argv.slice(2);
  fs.mkdirSync(path.resolve(outDir, 'pdf'), {recursive: true});
  const out = path.resolve(outDir, 'pdf');
  const app = await electron.launch({executablePath: exe, args: [appDir, ...(process.env.PROBE_IGNORE_CERT ? ['--ignore-certificate-errors'] : [])]});
  await app.firstWindow(); await new Promise(r => setTimeout(r, 1500));
  const Kmod = require(path.join(path.resolve(appDir), 'kosha-msds.js'));
  const result = await app.evaluate(async ({BrowserWindow}, {appDir, out, K}) => {
    const log = [], files = {};
    const win = new BrowserWindow({show: false, width: 960, height: 1400, webPreferences: {sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true, images: true, webSecurity: true, backgroundThrottling: false}});
    const body = 'viewType=msds&listType=all&chem_id=001049&msds_reg_id=&ncis_chem_id=';
    await win.loadURL(K.DETAIL_URL, {postData: [{type: 'rawData', bytes: Buffer.from(body)}], extraHeaders: 'Content-Type: application/x-www-form-urlencoded\n'});
    await win.webContents.executeJavaScript("document.querySelectorAll('.ListConts').forEach(e => e.classList.remove('DispNone')); true", true);
    const rebuilt = await win.webContents.executeJavaScript(K.BUILD_DOC, true);
    await win.webContents.insertCSS(K.CLEAN_CSS);
    await new Promise(r => setTimeout(r, 500));
    const info = await win.webContents.executeJavaScript(`(() => {
      const cs = e => { const s = getComputedStyle(e); return {margin: s.margin, padding: s.padding, position: s.position, top: s.top, transform: s.transform, zoom: s.zoom, height: s.height, overflow: s.overflow}; };
      return {rebuilt: ${rebuilt}, innerW: innerWidth, innerH: innerHeight, dpr: devicePixelRatio, scrollY, scrollH: document.documentElement.scrollHeight, bodyH: document.body.scrollHeight,
        html: cs(document.documentElement), body: cs(document.body), htmlAttrs: document.documentElement.outerHTML.slice(0, 300), bodyAttrs: document.body.outerHTML.slice(0, 200),
        styles: document.querySelectorAll('style,link[rel=stylesheet]').length, firstRect: JSON.stringify(document.querySelector('.kdoc')?.getBoundingClientRect())};
    })()`, true);
    log.push(info);
    const [w, h] = win.getSize(); const [cw, ch] = win.getContentSize(); log.push({winSize: [w, h], contentSize: [cw, ch]});
    try { const img = await win.webContents.capturePage(); files['shot.png'] = img.toPNG().toString('base64'); } catch (e) { log.push({shot: String(e)}); }
    const variants = {
      A_default: {printBackground: true, pageSize: 'A4', margins: {marginType: 'default'}, preferCSSPageSize: false},
      B_none: {printBackground: true, pageSize: 'A4', margins: {marginType: 'none'}, preferCSSPageSize: false},
      C_custom: {printBackground: true, pageSize: 'A4', margins: {marginType: 'custom', top: 0.4, bottom: 0.4, left: 0.4, right: 0.4}, preferCSSPageSize: false},
      D_nosize: {printBackground: true, margins: {marginType: 'default'}},
      E_letterish: {printBackground: true, pageSize: {width: 210000, height: 297000}, margins: {marginType: 'default'}}
    };
    for (const [name, opts] of Object.entries(variants)) {
      try { const pdf = await win.webContents.printToPDF(opts); files[name + '.pdf'] = pdf.toString('base64'); log.push({[name]: pdf.length}); }
      catch (e) { log.push({[name]: 'ERR ' + String(e)}); }
    }
    // F: 새 창에 data: URL로 다시 그린 문서를 띄워 출력 (사이트 문맥 없이)
    try {
      const html = await win.webContents.executeJavaScript('document.documentElement.outerHTML', true);
      const full = html.replace('<head>', '<head><style>' + K.CLEAN_CSS + '</style>');
      const w2 = new BrowserWindow({show: false, width: 960, height: 1400, webPreferences: {sandbox: true, contextIsolation: true, nodeIntegration: false}});
      await w2.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(full));
      await new Promise(r => setTimeout(r, 800));
      const pdf = await w2.webContents.printToPDF({printBackground: true, pageSize: 'A4', margins: {marginType: 'default'}, preferCSSPageSize: false});
      files['F_datawin.pdf'] = pdf.toString('base64'); log.push({F_datawin: pdf.length});
      // G: 같은 새 창, 크기 800x600
      w2.setSize(800, 600); await new Promise(r => setTimeout(r, 300));
      const pdf2 = await w2.webContents.printToPDF({printBackground: true, pageSize: 'A4', margins: {marginType: 'default'}, preferCSSPageSize: false});
      files['G_datawin_small.pdf'] = pdf2.toString('base64'); log.push({G: pdf2.length});
      w2.destroy();
    } catch (e) { log.push({F: 'ERR ' + String(e)}); }
    win.destroy();
    return {log, files};
  }, {appDir: path.resolve(appDir), out, K: {BUILD_DOC: Kmod.BUILD_DOC, CLEAN_CSS: Kmod.CLEAN_CSS, DETAIL_URL: Kmod.DETAIL_URL}});
  for (const [name, b64] of Object.entries(result.files)) fs.writeFileSync(path.join(out, name), Buffer.from(b64, 'base64'));
  fs.writeFileSync(path.join(out, 'probe.json'), JSON.stringify(result.log, null, 1));
  console.log(JSON.stringify(result.log, null, 1));
  await app.close();
})().catch(e => { console.error(String(e)); process.exit(1); });
