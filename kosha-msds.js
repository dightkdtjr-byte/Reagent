'use strict';
// 안전보건공단(KOSHA) 화학물질정보에서 물질 MSDS를 검색해 PDF로 저장한다.
// 고정 호스트(msds.kosha.or.kr)만 사용하며, 렌더러는 검색어와 물질 ID만 보낸다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const HOST = 'msds.kosha.or.kr';
const SEARCH_URL = 'https://msds.kosha.or.kr/MSDSInfo/kcic/msdssearchMsds.do?searchKeyword=';
const DETAIL_URL = 'https://msds.kosha.or.kr/MSDSInfo/kcic/msdsdetail.do';
// 받은 페이지를 우리 서식으로 다시 그린다. 사이트의 메뉴·배경선·버튼을 걷어내고 16개 절만 A4 문서로 만든다.
const CLEAN_CSS = `
  @page{size:A4;margin:10mm 10mm 11mm}
  html,body{margin:0;padding:0;background:#fff!important;color:#111}
  body{font:10px/1.42 "Malgun Gothic","맑은 고딕",NanumGothic,"Apple SD Gothic Neo",sans-serif}
  .kdoc{padding:5mm 0 2mm}
  .kdoc header{border-bottom:2px solid #1b5e9e;padding:0 0 6px;margin:0 0 8px}
  .kdoc .ksrc{font-size:9.5px;color:#555;margin-bottom:3px}
  .kdoc h1{font-size:17px;margin:0 0 4px;color:#0f3b6e}
  .kdoc .kids{font-size:10px;color:#333}.kdoc .kids span{display:inline-block;margin-right:12px}.kdoc .kids b{color:#1b5e9e;margin-right:3px}
  .kdoc .kstamp{font-size:9.5px;color:#666;margin-top:3px}
  .kdoc section{margin:0 0 4px;page-break-inside:auto}
  .kdoc h2{font-size:11.5px;margin:8px 0 3px;padding:3px 7px;background:#eef3fa;border-left:3px solid #1b5e9e;color:#0f3b6e;page-break-after:avoid;break-after:avoid}
  .kdoc ul,.kdoc dl{margin:0;padding:0;list-style:none}
  .kdoc .List01>li{font-weight:700;margin:4px 0 1px 2px}
  /* 항목명/내용은 표로 바꿔 놓는다 (grid·float는 쪽 나눔에서 내용이 밀리거나 사라졌음). */
  .kdoc .List02,.kdoc .List03,.kdoc .List04{font-weight:400;margin:1px 0 2px 10px}
  .kdoc table.kdl{border-collapse:collapse;width:100%;margin:0;font-size:10px}
  .kdoc table.kdl th,.kdoc table.kdl td{border:0;padding:1px 6px 1px 0;text-align:left;vertical-align:top;background:none;font-weight:400;white-space:normal}
  .kdoc table.kdl th{width:7.5em;font-weight:700;color:#1b5e9e;white-space:nowrap}
  .kdoc table.kdl td table.kdl{margin:0}
  .kdoc table.kdl tr{page-break-inside:avoid;break-inside:avoid}
  .kdoc .kh{font-weight:700;break-after:avoid;page-break-after:avoid}
  .kdoc .List01>li{break-inside:auto}
  .kdoc img[src*="/ghs/"]{width:44px;height:44px;margin:2px 6px 1px 0;vertical-align:middle}
  .kdoc table{border-collapse:collapse;width:100%;margin:3px 0 4px;font-size:10px}
  .kdoc th,.kdoc td{border:1px solid #b9c3d0;padding:2px 6px;text-align:left;vertical-align:top}
  .kdoc th{background:#f3f6fa;font-weight:700;white-space:nowrap}
  .kdoc tr{page-break-inside:avoid}
  .kdoc .ViewBtnArea,.kdoc .ViewBtn,.kdoc script,.kdoc iframe{display:none!important}
  .kdoc footer{margin-top:10px;padding-top:4px;border-top:1px solid #ccc;font-size:9px;color:#666}
`;
// 페이지 안에서 실행: 절 제목과 내용을 모아 새 본문을 만든다.
const BUILD_DOC = `(() => {
  const esc = s => String(s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const name = (document.querySelector('h3.BodyTit01') || {}).textContent || document.title;
  const ids = []; const dts = document.querySelectorAll('.SubsInfo dt');
  dts.forEach(dt => { const dd = dt.nextElementSibling; const k = dt.textContent.replace(/[:\s]+$/, '').trim(), v = dd ? dd.textContent.replace(/\u00a0/g, ' ').trim() : ''; if (k && v) ids.push('<span><b>' + esc(k) + '</b>' + esc(v) + '</span>'); });
  const sections = [];
  document.querySelectorAll('.ListContsStart h3.ListTit').forEach(h => {
    const body = h.nextElementSibling; if (!body || !body.classList.contains('ListConts')) return;
    body.querySelectorAll('.ViewBtnArea, script').forEach(e => e.remove());
    body.querySelectorAll('a').forEach(a => { const t = document.createTextNode(a.textContent); a.replaceWith(t); });
    // 항목 제목(가./나.)을 블록으로 감싸 다음 쪽으로 홀로 밀리지 않게 한다.
    // dl(dt/dd) → 표. dt는 항목명 칸, 이어지는 dd는 같은 항목의 내용 줄. dt 없이 시작하는 dd는 두 칸을 합친다.
    const toTable = dl => {
      const t = document.createElement('table'); t.className = 'kdl'; const tb = document.createElement('tbody'); t.appendChild(tb);
      let pending = null;
      for (const ch of [...dl.children]) {
        if (ch.tagName === 'DT') { pending = ch; continue; }
        if (ch.tagName !== 'DD') continue;
        if (!ch.textContent.trim() && !ch.querySelector('img,table,dl')) { continue; }
        const tr = document.createElement('tr');
        if (pending) { const th = document.createElement('th'); th.textContent = pending.textContent.trim(); tr.appendChild(th); const td = document.createElement('td'); while (ch.firstChild) td.appendChild(ch.firstChild); tr.appendChild(td); pending = null; }
        else { const td = document.createElement('td'); td.colSpan = 2; while (ch.firstChild) td.appendChild(ch.firstChild); tr.appendChild(td); }
        tb.appendChild(tr);
      }
      if (pending) { const tr = document.createElement('tr'); const th = document.createElement('th'); th.textContent = pending.textContent.trim(); const td = document.createElement('td'); tr.appendChild(th); tr.appendChild(td); tb.appendChild(tr); }
      dl.replaceWith(t);
    };
    // 안쪽 dl부터 바꾼다.
    const dls = [...body.querySelectorAll('dl')].reverse(); dls.forEach(toTable);
    body.querySelectorAll('.List01 > li').forEach(li => { const head = document.createElement('div'); head.className = 'kh'; while (li.firstChild && !(li.firstChild.nodeType === 1 && /^(DL|UL|DIV|TABLE)$/.test(li.firstChild.tagName))) head.appendChild(li.firstChild); if (head.textContent.trim()) li.insertBefore(head, li.firstChild); });
    sections.push('<section><h2>' + esc(h.textContent.trim()) + '</h2><div class="kbody">' + body.innerHTML + '</div></section>');
  });
  if (!sections.length) return false;
  const today = new Date(), p = n => String(n).padStart(2, '0'), stamp = today.getFullYear() + '-' + p(today.getMonth() + 1) + '-' + p(today.getDate());
  const html = '<div class="kdoc"><header><div class="ksrc">물질안전보건자료 (MSDS) · 출처: 안전보건공단 화학물질정보 (msds.kosha.or.kr)</div><h1>' + esc(name.trim()) + '</h1><div class="kids">' + ids.join('') + '</div><div class="kstamp">받은 날짜 ' + stamp + ' · 본 자료는 안전보건공단이 제공하는 물질 기준 MSDS입니다. 제품 고유 정보는 제조사 MSDS를 확인하세요.</div></header>' + sections.join('') + '<footer>안전보건공단 화학물질정보 · ' + esc(name.trim()) + ' · 받은 날짜 ' + stamp + '</footer></div>';
  document.querySelectorAll('link[rel=stylesheet], style').forEach(e => e.remove());
  document.body.innerHTML = html; document.body.removeAttribute('class'); document.body.removeAttribute('style');
  return true;
})()`;
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
      // 사이트 서식 대신 우리 서식으로 본문을 다시 만든 뒤 PDF로 저장한다.
      const rebuilt = await Promise.race([win.webContents.executeJavaScript(BUILD_DOC, true), timeout(15000, 'KOSHA 페이지를 문서로 정리하지 못했습니다.')]);
      if (!rebuilt) throw new Error('KOSHA MSDS 절 구성을 찾지 못했습니다. 사이트 구조가 바뀌었을 수 있습니다.');
      await win.webContents.insertCSS(CLEAN_CSS);
      await new Promise(r => setTimeout(r, 400));
      const pdf = await Promise.race([
        win.webContents.printToPDF({printBackground: true, pageSize: 'A4', margins: {marginType: 'default'}, preferCSSPageSize: true}),
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
        if (typeof ghs.summary === 'string') ghs.summary = ghs.summary.replace(/그림문자 .*?(?= · 작성| · 2절| · 절 구분|$)/, '그림문자 ' + ghs.pictograms.join('·') + ' (원문 그림 기준)');
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
