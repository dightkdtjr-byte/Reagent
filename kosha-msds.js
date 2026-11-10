'use strict';
// 안전보건공단(KOSHA) 화학물질정보에서 물질 MSDS를 검색해 PDF로 저장한다.
// 고정 호스트(msds.kosha.or.kr)만 사용하며, 렌더러는 검색어와 물질 ID만 보낸다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const HOST = 'msds.kosha.or.kr';
const SEARCH_URL = 'https://msds.kosha.or.kr/MSDSInfo/kcic/msdssearchMsds.do?searchKeyword=';
const DETAIL_URL = 'https://msds.kosha.or.kr/MSDSInfo/kcic/msdsdetail.do';
const HIDE_CSS = '#Header,#Footer,#LeftMenuArea,.ViewBtnArea,.ViewBtn,.skip,.skipNav,.GnbAreaWrap,.TopMenuArea,.SubsInfoArea,.SubImg01,.main-bottom-mydatasafe,.megDivInfo,.BtnMore,.FootTxt,.FootLogo{display:none!important}'
  + '#Container,#Contents,.ListBoard,.tableListWrap{width:auto!important;max-width:none!important;margin:0!important;padding:0 8px!important;float:none!important}'
  + '.ListConts{display:block!important}.ListTit{page-break-after:avoid}table{page-break-inside:auto}tr{page-break-inside:avoid}body{background:#fff!important}';
const CAS_RE = /^\d{2,7}-\d{2}-\d$/;
// KOSHA 사이트의 그림문자 이미지 파일명은 국제 GHS 번호와 다르다 (2026-11 확인):
// KOSHA GHS03.gif = 고압가스(국제 GHS04), KOSHA GHS04.gif = 산화성(국제 GHS03). 나머지는 같다.
const KOSHA_PICTOGRAM = {GHS01: 'GHS01', GHS02: 'GHS02', GHS03: 'GHS04', GHS04: 'GHS03', GHS05: 'GHS05', GHS06: 'GHS06', GHS07: 'GHS07', GHS08: 'GHS08', GHS09: 'GHS09'};
const toStandard = codes => [...new Set((codes || []).map(c => KOSHA_PICTOGRAM[String(c).toUpperCase()] || String(c).toUpperCase()))].sort();
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

// 검색 결과 표에서 물질 ID·물질명·CAS·개정일을 뽑는다.
function parseList(html) {
  const rows = [];
  for (const tr of String(html || '').split(/<tr\b/i).slice(1)) {
    const row = tr.split(/<\/tr>/i)[0];
    const id = row.match(/getDetail\('msds','(\d+)'\);"\s*>\s*([^<]*?)\s*<\/a>/);
    if (!id) continue;
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => clean(m[1].replace(/<[^>]+>/g, ' ')));
    const casNo = cells.find(c => CAS_RE.test(c)) || '';
    const revisedAt = (row.match(/\d{4}-\d{2}-\d{2}/) || [''])[0];
    const pictograms = toStandard([...row.matchAll(/ghs\/(GHS0[1-9])\.gif/gi)].map(m => m[1]));
    const signal = (row.match(/layerPopup\('[^']*','(위험|경고)'/) || [])[1] || '';
    const entry = {chemId: id[1], name: clean(id[2]), casNo, revisedAt, pictograms, signalWord: signal === '위험' ? 'Danger' : signal === '경고' ? 'Warning' : ''};
    if (!rows.some(r => r.chemId === entry.chemId)) rows.push(entry);
  }
  return rows;
}
function createKoshaClient({net, BrowserWindow, msds, extract, logger = console}) {
  const getNet = () => (typeof net === 'function' ? net() : net);
  async function fetchText(url, timeoutMs = 20000) {
    const n = getNet();
    if (!n || typeof n.fetch !== 'function') throw new Error('앱의 네트워크 모듈을 사용할 수 없습니다.');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      // 공단 서버가 가끔 502/504를 돌려준다. 5xx는 2초 뒤 한 번 더 시도한다.
      const opts = {credentials: 'omit', signal: ctrl.signal, headers: {'Accept': 'text/html'}};
      let res = await n.fetch(url, opts);
      if (res.status >= 500) { await new Promise(r => setTimeout(r, 2000)); res = await n.fetch(url, opts); }
      if (!res.ok) throw new Error(`MSDS 서버 응답 ${res.status} (KOSHA). 잠시 후 다시 시도해주세요.`);
      return await res.text();
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('MSDS 서버(KOSHA) 응답이 늦어 검색을 중단했습니다.');
      throw e;
    } finally { clearTimeout(timer); }
  }
  async function search(query) {
    const q = clean(query).slice(0, 100);
    if (!q) throw new Error('검색할 CAS 번호 또는 물질명이 없습니다.');
    if (/[<>"\x00-\x1f]/.test(q)) throw new Error('검색어에 사용할 수 없는 문자가 있습니다.');
    const html = await fetchText(SEARCH_URL + encodeURIComponent(q));
    const rows = parseList(html);
    const exact = CAS_RE.test(q) ? rows.filter(r => r.casNo === q) : [];
    return {ok: true, query: q, rows: exact.length ? exact : rows, exactCas: exact.length > 0, total: rows.length};
  }
  function timeout(ms, message) { return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)); }
  // 상세 페이지를 숨김 창에 띄워 16개 절을 모두 펼친 뒤 A4 PDF로 저장하고, 본문 텍스트에서 GHS 항목을 읽는다.
  async function receive(chemId, meta = {}) {
    if (!/^\d{1,12}$/.test(String(chemId || ''))) throw new Error('KOSHA 물질 ID가 올바르지 않습니다.');
    const win = new BrowserWindow({show: false, width: 960, height: 1400, webPreferences: {sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true, images: true, webSecurity: true, backgroundThrottling: false}});
    try {
      win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
      win.webContents.on('will-navigate', (e, url) => { try { if (new URL(url).hostname !== HOST) e.preventDefault(); } catch { e.preventDefault(); } });
      win.webContents.session; // 기본 세션 사용 (쿠키는 저장되지 않는 요청 범위에서만 사용)
      const body = 'viewType=msds&listType=all&chem_id=' + encodeURIComponent(String(chemId)) + '&msds_reg_id=&ncis_chem_id=';
      await Promise.race([
        win.loadURL(DETAIL_URL, {postData: [{type: 'rawData', bytes: Buffer.from(body)}], extraHeaders: 'Content-Type: application/x-www-form-urlencoded\n'}),
        timeout(45000, 'KOSHA 상세 페이지를 여는 데 시간이 너무 오래 걸립니다.')
      ]);
      const info = await Promise.race([
        win.webContents.executeJavaScript(`(() => {
          document.querySelectorAll('.ListConts').forEach(e => e.classList.remove('DispNone'));
          const t1 = document.getElementById('Title1'), t2 = document.getElementById('Title2');
          const name = (document.querySelector('#Contents1 table td, #Contents1 .ListConts td') || {}).innerText || '';
          const codes = [...new Set([...document.querySelectorAll('#Contents2 img')].map(i => (String(i.getAttribute('src') || '').match(/(GHS0[1-9])\.gif/i) || [])[1]).filter(Boolean).map(c => c.toUpperCase()))];
          const signal = ((document.getElementById('Contents2') || {}).innerText || '').match(/신호어\s*[:：]?\s*(위험|경고)/);
          return {ok: !!(t1 && t2), title: document.title, text: document.body.innerText, firstCell: name.slice(0, 200), pictograms: codes, signalWord: signal ? (signal[1] === '위험' ? 'Danger' : 'Warning') : ''};
        })()`, true),
        timeout(15000, 'KOSHA 페이지 내용을 읽지 못했습니다.')
      ]);
      if (!info || !info.ok) throw new Error('KOSHA MSDS 본문(1절·2절)을 찾지 못했습니다. 사이트 구조가 바뀌었을 수 있습니다.');
      await win.webContents.insertCSS(HIDE_CSS);
      await new Promise(r => setTimeout(r, 250));
      const pdf = await Promise.race([
        win.webContents.printToPDF({printBackground: true, pageSize: 'A4', margins: {marginType: 'default'}, preferCSSPageSize: false}),
        timeout(60000, 'PDF 변환이 끝나지 않았습니다.')
      ]);
      if (!Buffer.isBuffer(pdf) || pdf.length < 1000 || !/^%PDF-/.test(pdf.subarray(0, 5).toString('ascii'))) throw new Error('PDF 변환 결과가 올바르지 않습니다.');
      const temp = path.join(msds.directory(), 'kosha-' + crypto.randomBytes(5).toString('hex') + '.pdf');
      let imported;
      try { fs.writeFileSync(temp, pdf, {flag: 'wx', mode: 0o600}); imported = msds.importFiles([temp]); }
      finally { try { fs.unlinkSync(temp); } catch {} }
      if (!imported || !imported.documents || !imported.documents.length) throw new Error((imported && imported.errors && imported.errors[0] && imported.errors[0].error) || 'MSDS PDF 저장 실패');
      const safeName = clean(meta.name || 'MSDS').replace(/[\\/\x00-\x1f<>:"|?*]/g, '_').slice(0, 60) || 'MSDS';
      const cas = CAS_RE.test(clean(meta.casNo)) ? clean(meta.casNo) : '';
      const stamp = new Date().toISOString().slice(0, 10);
      const document = {...imported.documents[0], fileName: `KOSHA_MSDS_${safeName}${cas ? '_' + cas : ''}_${stamp}.pdf`, sourceURL: DETAIL_URL, sourcePublisher: '안전보건공단(KOSHA) 화학물질정보', koshaChemId: String(chemId), koshaRevisedAt: clean(meta.revisedAt || '')};
      const ghs = typeof extract === 'function' ? extract(info.text) : null;
      // 2절의 그림문자 이미지가 가장 정확하다. 글자로 못 읽은 경우를 이미지로 보완한다.
      if (ghs && Array.isArray(info.pictograms) && info.pictograms.length) {
        ghs.pictograms = toStandard(info.pictograms); ghs.pictogramSource = 'explicit'; ghs.found = true;
        // 요약 문구도 이미지 기준으로 고쳐 쓴다 (추출 단계에서 만든 'H코드 기준' 표시를 지움).
        if (typeof ghs.summary === 'string') ghs.summary = ghs.summary.replace(/그림문자 [^·]*?(?= · |$)/, '그림문자 ' + ghs.pictograms.join('·') + ' (원문 그림 기준)');
      }
      if (ghs && !ghs.signalWord && info.signalWord) ghs.signalWord = info.signalWord;
      return {ok: true, document, extract: ghs, title: info.title, pages: null};
    } finally {
      try { if (!win.isDestroyed()) win.destroy(); } catch (e) { logger.error('kosha window close failed', e); }
    }
  }
  return {search, receive, parseList};
}
module.exports = {createKoshaClient, parseList, toStandard, KOSHA_PICTOGRAM, HOST};
