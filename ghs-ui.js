'use strict';
// GHS 분류·표시 입력과 표시. 그림문자는 프로그램 내장 PNG를 사용하며 인터넷이 필요 없습니다.
(() => {
  const D=window.GHSData;
  const CODES=Object.keys(D.PICTOGRAMS);
  const icons=new Map();
  let preloadPromise=null;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const E=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined&&text!==null)e.textContent=text;if(cls)e.className=cls;return e;};
  const button=(text,fn,cls='ghost')=>{const b=E('button',text,cls);b.type='button';b.onclick=fn;return b;};
  const today=()=>{const d=new Date(),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;};
  const clone=v=>JSON.parse(JSON.stringify(v));
  const SIGNAL_CLS={Danger:'danger',Warning:'warning',None:'none'};

  async function preload(){
    if(preloadPromise)return preloadPromise;
    preloadPromise=(async()=>{
      if(!window.inventorySafety?.icons)return;
      try{const r=await window.inventorySafety.icons(CODES);for(const i of r?.icons||[])if(i.dataURI)icons.set(i.code,i.dataURI);}catch(e){console.error('GHS icon preload failed',e);}
    })();
    return preloadPromise;
  }
  const icon=code=>icons.get(code)||null;
  function iconImg(code,px,cls){const uri=icon(code);const label=D.PICTOGRAMS[code]?.label||code;if(uri)return `<img class="${cls||'ghs-ico'}" src="${uri}" alt="${esc(code)} ${esc(label)}" title="${esc(code)} ${esc(label)}" width="${px}" height="${px}">`;return `<span class="ghs-ico-code" title="${esc(label)}">${esc(code)}</span>`;}
  function signalBadge(word,small){if(!word)return '';return `<span class="ghs-signal ${SIGNAL_CLS[word]||''}${small?' small':''}">${esc(D.SIGNAL[word]||word)}</span>`;}
  function reviewMonths(settings){const n=Number(settings?.msdsReviewMonths);return Number.isFinite(n)&&n>=0?n:12;}

  // 재고 목록 셀
  function cellHtml(item,settings){
    const g=item?.ghs,st=D.msdsStatus(item,reviewMonths(settings),today());
    const msds=st.state==='overdue'?`<span class="ghs-msds bad" title="${esc(st.label)}">MSDS 검토</span>`:st.state==='due-soon'?`<span class="ghs-msds warn" title="${esc(st.label)}">MSDS D-${st.days}</span>`:st.attached?`<span class="ghs-msds ok" title="MSDS ${st.attached}개 첨부">MSDS</span>`:'';
    if(!D.hasClassification(item))return `<div class="ghs-cell"><span class="ghs-none">GHS 미입력</span>${msds}</div>`;
    return `<div class="ghs-cell" title="${esc(D.summaryText(item))}"><span class="ghs-icons">${g.pictograms.map(c=>iconImg(c,22)).join('')}</span>${signalBadge(g.signalWord,true)}${msds}</div>`;
  }
  // 스캔·입출고 확인창 요약
  function inlineHtml(item){
    if(!D.hasClassification(item))return '';
    const g=item.ghs,h=g.hCodes.slice(0,4).map(c=>`<span>${esc(c)} ${esc(D.hText(c))}</span>`).join('');
    return `<div class="ghs-inline"><div class="ghs-inline-head"><span class="ghs-icons">${g.pictograms.map(c=>iconImg(c,34)).join('')}</span>${signalBadge(g.signalWord)}${g.hazardClasses?`<span class="ghs-inline-class">${esc(g.hazardClasses)}</span>`:''}</div>${h?`<div class="ghs-inline-h">${h}${g.hCodes.length>4?`<span>외 ${g.hCodes.length-4}개</span>`:''}</div>`:''}</div>`;
  }
  // 라벨 인쇄용 (data URI 이미지)
  function labelHtml(item,mm){
    if(!D.hasClassification(item))return '';
    const g=item.ghs,imgs=g.pictograms.slice(0,5).map(c=>{const u=icon(c);return u?`<img src="${u}" alt="${esc(c)}" style="width:${mm}mm;height:${mm}mm;display:block">`:'';}).join('');
    if(!imgs&&!g.signalWord)return '';
    return `<div class="ghs" style="display:flex;align-items:center;gap:.35mm;flex:none">${imgs}${g.signalWord&&g.signalWord!=='None'?`<span style="font-weight:800;font-size:${Math.max(2.2,mm*.62)}mm;line-height:1;margin-left:.2mm">${esc(D.SIGNAL[g.signalWord])}</span>`:''}</div>`;
  }
  const FILTERS=[['all','GHS·MSDS 전체'],['ghs-missing','GHS 미입력'],['ghs-set','GHS 입력됨'],['danger','신호어 위험'],['msds-missing','MSDS 미첨부'],['msds-review','MSDS 검토 필요'],...CODES.map(c=>[c,`${c} ${D.PICTOGRAMS[c].label}`])];
  function matchesFilter(item,filter,settings){
    if(!filter||filter==='all')return true;
    const has=D.hasClassification(item),g=item.ghs||{};
    if(filter==='ghs-missing')return !has;
    if(filter==='ghs-set')return has;
    if(filter==='danger')return g.signalWord==='Danger';
    const st=D.msdsStatus(item,reviewMonths(settings),today());
    if(filter==='msds-missing')return !st.attached;
    if(filter==='msds-review')return st.state==='overdue'||st.state==='due-soon'||st.state==='unset';
    if(D.PICTOGRAMS[filter])return has&&g.pictograms.includes(filter);
    return true;
  }
  function counts(items,settings){
    const c={total:0,ghsMissing:0,danger:0,msdsMissing:0,msdsReview:0,pictograms:Object.fromEntries(CODES.map(k=>[k,0]))};
    for(const r of items||[]){c.total++;const has=D.hasClassification(r);if(!has)c.ghsMissing++;if(r.ghs?.signalWord==='Danger')c.danger++;const st=D.msdsStatus(r,reviewMonths(settings),today());if(!st.attached)c.msdsMissing++;if(st.state==='overdue'||st.state==='due-soon'||st.state==='unset')c.msdsReview++;if(has)for(const p of r.ghs.pictograms)c.pictograms[p]++;}
    return c;
  }
  function searchText(item){const g=item?.ghs;if(!g)return '';return [g.signalWord?D.SIGNAL[g.signalWord]:'',...g.pictograms.map(c=>c+' '+D.PICTOGRAMS[c].label),...g.hCodes,g.hazardClasses].filter(Boolean).join(' ');}
  function excelRows(items,settings){
    const header=['QR코드ID','분류','품명','영문명','CAS No.','제조사','신호어','그림문자','유해·위험성 분류','H코드','P코드','GHS 출처','MSDS 첨부','MSDS 작성·개정일','개정번호','MSDS 검토일','다음 검토 예정','MSDS 상태','비고'];
    const rows=(items||[]).map(r=>{const g=r.ghs||{},st=D.msdsStatus(r,reviewMonths(settings),today());const src={supplier:'공급자 MSDS',kosha:'KOSHA MSDS',catalog:'검토 SDS 자료',other:'기타'}[g.source]||'';
      return [r.id,(r.category||'reagent')==='standard'?'표준물질':'시약',r.name||'',r.nameEn||'',r.casNo||'',r.maker||'',g.signalWord?D.SIGNAL[g.signalWord]:'',(g.pictograms||[]).map(c=>c+' '+D.PICTOGRAMS[c].label).join(', '),g.hazardClasses||'',(g.hCodes||[]).map(c=>c+' '+D.hText(c)).join('\n'),(g.pCodes||[]).map(c=>c+' '+D.pText(c)).join('\n'),src+(g.sourceNote?' · '+g.sourceNote:''),st.attached,g.msdsIssuedAt||'',g.msdsRevision||'',g.msdsReviewedAt||'',st.nextReviewAt||'',st.label,g.note||''];});
    return {header,rows};
  }

  // 추출 결과를 저장 가능한 GHS 객체로 만든다 (일괄 처리용). 읽은 내용이 없으면 null.
  function ghsFromExtract(doc,r,origin,existing){
    if(!r||!r.found)return null;
    const g=existing?clone(existing):{};
    g.pictograms=r.pictograms.slice();g.signalWord=r.signalWord||'';g.hCodes=r.hCodes.slice();
    if(r.pCodes.length)g.pCodes=r.pCodes.slice();
    if(r.hazardClasses)g.hazardClasses=r.hazardClasses;
    g.source=origin==='kosha'?'kosha':'supplier';g.sourceNote=`${doc.fileName}에서 자동 추출 (${today()})`;
    if(r.issuedAt)g.msdsIssuedAt=r.issuedAt;if(r.revision)g.msdsRevision=r.revision;if(!g.msdsReviewedAt)g.msdsReviewedAt=today();
    g.extractedFrom={documentId:doc.id,at:new Date().toISOString()};g.updatedAt=new Date().toISOString();
    return D.normalizeGHS(g);
  }
  // ---------- 상세 화면 편집기 ----------
  const panels=new Map();
  function mountDetail(opts){
    const {element,itemId,getItem,save,toast,confirm}=opts;if(!element)return;
    panels.set(element,opts);
    let editing=false,draft=null,busy=false,lastExtract=null,pickedDocId='',koshaChoices=null;
    const alive=()=>element.isConnected&&!!getItem(itemId);
    const settings=()=>opts.settings?.()||{};
    async function lookup(kind){
      const item=getItem(itemId);if(!item)return;
      const query=(item.casNo||'').trim()||item.nameEn||item.name||'';
      if(!window.inventorySafety?.lookup){toast('외부 검색은 설치형 앱에서 사용할 수 있습니다.',true);return;}
      try{const r=await window.inventorySafety.lookup(kind,query);if(!r?.ok)throw new Error(r?.error||'열기 실패');if(r.copied)toast(`'${query}'을(를) 복사했습니다. 검색창에 붙여넣으세요.`);}catch(e){toast('검색 페이지를 열지 못했습니다: '+String(e.message||e),true);}
    }
    async function fromCatalog(){
      const item=getItem(itemId);if(!item)return null;
      try{const s=await window.InventorySafetyUI?.suggestion?.(item);if(!s?.source?.ghs)return null;return s;}catch{return null;}
    }
    async function applyCatalog(){
      const s=await fromCatalog();if(!s){toast('이 품목에 맞는 검토 SDS 자료가 없습니다. 공급자 MSDS를 보고 직접 입력하세요.',true);return;}
      const src=s.source,ref=s.status==='reference';
      if(!confirm(`${src.publisher} · ${src.productName} (검토본 ${src.revisionDate})의 GHS 정보를 입력란에 채울까요?${ref?'\n같은 물질의 다른 제품 자료입니다.':''}\n채운 뒤 저장을 눌러야 반영됩니다.`))return;
      if(!editing)startEdit();
      draft.pictograms=src.ghs.pictograms.slice();draft.signalWord=src.ghs.signalWord||'';draft.hCodes=src.ghs.hCodes.slice();
      draft.source='catalog';draft.sourceNote=`${src.publisher} · ${src.productName} · 검토본 ${src.revisionDate}${ref?' · 동일 물질 참고자료':''}`;
      if(!draft.msdsIssuedAt)draft.msdsIssuedAt=src.revisionDate||'';if(!draft.msdsRevision)draft.msdsRevision=src.revision||'';
      draw();
    }
    function docs(){return (getItem(itemId)?.msdsDocuments||[]).slice();}
    function pickedDoc(){const list=docs();return list.find(d=>d.id===pickedDocId)||list[list.length-1]||null;}
    // 추출 결과를 입력란에 채운다. 저장은 사용자가 확인한 뒤 누른다.
    function applyExtract(doc,r,origin){
      if(!editing)startEdit();
      if(!r||!r.found){lastExtract={doc,result:r||{summary:''},empty:true};return false;}
      draft.pictograms=r.pictograms.slice();draft.signalWord=r.signalWord||'';draft.hCodes=r.hCodes.slice();
      if(r.pCodes.length)draft.pCodes=r.pCodes.slice();
      if(r.hazardClasses)draft.hazardClasses=r.hazardClasses;
      draft.source=origin==='kosha'?'kosha':(!draft.source||draft.source==='catalog'?'supplier':draft.source);
      draft.sourceNote=`${doc.fileName}에서 자동 추출 (${today()})`;
      if(r.issuedAt)draft.msdsIssuedAt=r.issuedAt;if(r.revision)draft.msdsRevision=r.revision;if(!draft.msdsReviewedAt)draft.msdsReviewedAt=today();
      draft.extractedFrom={documentId:doc.id,at:new Date().toISOString()};
      lastExtract={doc,result:r};return true;
    }
    // 품목에 문서를 연결하고 저장한다. 실패하면 되돌린다.
    async function attachDocument(doc){
      const item=getItem(itemId);if(!item)throw new Error('품목을 찾을 수 없습니다.');
      const before=item.msdsDocuments,beforeUpdated=item.updatedAt,old=item.msdsDocuments||[];
      if(old.some(d=>d.id===doc.id))return doc;
      if(old.length>=20)throw new Error('이 품목의 첨부 문서가 이미 20개입니다.');
      item.msdsDocuments=[...old,doc];item.updatedAt=new Date().toISOString();
      let ok=false;try{ok=await save();}catch{}
      if(!ok){const live=getItem(itemId);if(live){if(before===undefined)delete live.msdsDocuments;else live.msdsDocuments=before;live.updatedAt=beforeUpdated;}throw new Error('문서 연결을 저장하지 못했습니다.');}
      return doc;
    }
    function remountMsds(){const el=document.getElementById('msds-panel');if(el&&window.MSDSUI)window.MSDSUI.mount({element:el,itemId,getItem,save,toast,confirm});}
    // KOSHA 화학물질정보에서 CAS로 MSDS를 찾아 PDF로 받고, 첨부한 뒤 GHS 항목까지 채운다.
    async function koshaAuto(choice){
      if(busy||!alive())return;
      const item=getItem(itemId),cas=String(item.casNo||'').trim(),query=cas||String(item.name||item.nameEn||'').trim();
      if(!query){toast('CAS 번호나 품명을 먼저 입력하고 저장해주세요.',true);return;}
      if(!window.inventorySafety?.koshaSearch){toast('KOSHA 자동 받기는 설치형 앱에서 사용할 수 있습니다.',true);return;}
      busy=true;
      try{
        let pick=choice;
        if(!pick){
          toast(`KOSHA 화학물질정보에서 '${query}' 검색 중…`);
          const r=await window.inventorySafety.koshaSearch(query);if(!alive())return;
          if(!r?.ok)throw new Error(r?.error||'검색 실패');
          const rows=r.rows||[];
          if(!rows.length){toast(`KOSHA에 '${query}'의 MSDS가 없습니다. 제조사 MSDS PDF를 첨부해주세요.`,true);return;}
          if(rows.length>1&&!r.exactCas){koshaChoices=rows.slice(0,15);draw();toast('검색 결과가 여러 개입니다. 아래에서 맞는 물질을 선택하세요.');return;}
          pick=rows[0];
        }
        koshaChoices=null;
        if(!confirm(`KOSHA의 '${pick.name}' (CAS ${pick.casNo||'미표기'}${pick.revisedAt?', 개정 '+pick.revisedAt:''}) MSDS를 PDF로 받아 이 품목에 첨부할까요?\n받은 뒤 GHS 항목을 자동으로 채우며, 저장을 눌러야 반영됩니다.`))return;
        toast('KOSHA MSDS를 PDF로 변환해 저장하는 중입니다… (10~30초)');
        const rec=await window.inventorySafety.koshaReceive(pick.chemId,{name:pick.name,casNo:pick.casNo,revisedAt:pick.revisedAt});if(!alive())return;
        if(!rec?.ok)throw new Error(rec?.error||'MSDS 받기 실패');
        await attachDocument(rec.document);
        pickedDocId=rec.document.id;
        const filled=applyExtract(rec.document,rec.extract,'kosha');
        if(filled&&!draft.pictograms.length&&pick.pictograms?.length){draft.pictograms=pick.pictograms.slice();if(!draft.signalWord&&pick.signalWord)draft.signalWord=pick.signalWord;}
        draw();remountMsds();
        toast(filled?'KOSHA MSDS를 첨부하고 GHS 항목을 채웠습니다. 저장을 누르세요.':'KOSHA MSDS를 첨부했지만 GHS 항목을 읽지 못했습니다. 직접 선택해주세요.',!filled);
      }catch(e){toast('KOSHA MSDS 받기 실패: '+String(e.message||e),true);}
      finally{busy=false;}
    }
    // 첨부된 MSDS PDF에서 GHS 항목을 읽어 입력란을 채운다. 저장은 사용자가 확인한 뒤 누른다.
    async function extractFrom(doc){
      if(busy||!alive()||!doc)return;busy=true;
      try{
        if(!window.inventoryMSDS?.extract)throw new Error('자동 추출은 설치형 앱에서 사용할 수 있습니다.');
        toast('MSDS에서 GHS 정보를 읽는 중입니다…');
        const r=await window.inventoryMSDS.extract(doc);
        if(!alive())return;
        if(!r?.ok)throw new Error(r?.error||'추출 실패');
        const filled=applyExtract(doc,r,doc.koshaChemId?'kosha':'supplier');draw();
        if(!filled){toast(r.textLength<200?'글자 정보가 없는 PDF(스캔본)라 자동으로 읽을 수 없습니다. 아래에서 직접 선택해주세요.':'MSDS에서 GHS 항목을 찾지 못했습니다. 아래에서 직접 선택해주세요.',true);return;}
        toast('MSDS에서 읽은 내용을 채웠습니다. 확인 후 저장을 누르세요.');
      }catch(e){toast('자동 추출 실패: '+String(e.message||e),true);}
      finally{busy=false;}
    }
    async function attachThenExtract(){
      const cur=window.MSDSUI?.current;
      if(!cur||cur.itemId!==itemId){toast('아래 MSDS 영역의 PDF 첨부 버튼을 사용해주세요.',true);return;}
      await cur.attach(); // 첨부가 끝나면 onDocumentsAttached가 자동 추출을 이어서 실행한다.
    }
    function startEdit(){const item=getItem(itemId);draft=clone(item.ghs||{});for(const k of ['pictograms','hCodes','pCodes'])if(!Array.isArray(draft[k]))draft[k]=[];for(const k of ['signalWord','hazardClasses','source','sourceNote','msdsIssuedAt','msdsRevision','msdsReviewedAt','note'])if(typeof draft[k]!=='string')draft[k]='';editing=true;}
    async function commit(next){
      if(busy||!alive())return;busy=true;
      const item=getItem(itemId),before=item.ghs,beforeUpdated=item.updatedAt;
      try{
        if(next){next.updatedAt=new Date().toISOString();item.ghs=next;}else delete item.ghs;
        item.updatedAt=new Date().toISOString();
        let ok=false;try{ok=await save();}catch{}
        if(!ok){const live=getItem(itemId);if(live){if(before===undefined)delete live.ghs;else live.ghs=before;live.updatedAt=beforeUpdated;}throw new Error('저장하지 못해 GHS 정보를 되돌렸습니다.');}
        editing=false;draft=null;lastExtract=null;toast(next?'GHS 분류를 저장했습니다.':'GHS 분류를 지웠습니다.');
        opts.onSaved?.();
      }catch(e){toast(String(e.message||e),true);}
      finally{busy=false;draw();}
    }
    function codePicker(kind,list,title,hint){
      const wrap=E('div',undefined,'ghs-picker'),head=E('div',undefined,'ghs-picker-head');head.append(E('strong',title),E('span',hint,'hint'));wrap.append(head);
      const chips=E('div',undefined,'ghs-chips');wrap.append(chips);
      const text=kind==='H'?D.hText:D.pText;
      function drawChips(){chips.replaceChildren();if(!list.length)chips.append(E('span','선택된 코드가 없습니다.','hint'));for(const c of list){const chip=E('span',undefined,'ghs-chip');chip.append(E('b',c),E('span',' '+text(c)));const x=button('×',()=>{list.splice(list.indexOf(c),1);drawChips();onChange();},'ghs-chip-x');x.setAttribute('aria-label',c+' 제거');chip.append(x);chips.append(chip);}}
      const row=E('div',undefined,'ghs-picker-row'),input=E('input');input.type='text';input.placeholder=kind==='H'?'H225, H319 또는 문구 검색 (예: 인화성)':'P210, P280 또는 문구 검색 (예: 보호장갑)';input.setAttribute('aria-label',title+' 입력');
      const results=E('div',undefined,'ghs-picker-results');results.hidden=true;
      const add=button('추가',()=>addTyped(),'primary');row.append(input,add);wrap.append(row,results);
      const rows=kind==='H'?D.H_ROWS:D.P_ROWS;
      function addCodes(codes){let n=0;for(const c of codes)if(!list.includes(c)){list.push(c);n++;}if(n){drawChips();onChange();}return n;}
      function addTyped(){const codes=D.parseCodes(input.value,kind);if(!codes.length){toast(`${kind}코드 형식(예: ${kind}2xx)으로 입력하거나 목록에서 선택하세요.`,true);return;}addCodes(codes);input.value='';results.hidden=true;input.focus();}
      function search(){const q=input.value.trim().toLowerCase();results.replaceChildren();if(!q){results.hidden=true;return;}const hits=rows.filter(([code,ko])=>code.toLowerCase().includes(q)||ko.toLowerCase().includes(q)).slice(0,12);if(!hits.length){results.hidden=true;return;}for(const [code,ko] of hits){const b=button(`${code} · ${ko}`,()=>{addCodes([code]);input.value='';results.hidden=true;input.focus();},'ghs-picker-hit');if(list.includes(code))b.disabled=true;results.append(b);}results.hidden=false;}
      input.oninput=search;input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();const first=results.hidden?null:results.querySelector('button:not(:disabled)');if(first&&!/^[hp]\d/i.test(input.value.trim()))first.click();else addTyped();}else if(e.key==='Escape'){results.hidden=true;}};
      let onChange=()=>{};wrap.setOnChange=fn=>{onChange=fn;};drawChips();return wrap;
    }
    function field(label,control,full){const d=E('div',undefined,full?'full':'');const l=E('label',label);d.append(l,control);return d;}
    function editor(item){
      const box=E('div',undefined,'ghs-editor');
      if(lastExtract){
        const r=lastExtract.result,info=E('div',undefined,'ghs-extract-box'+(lastExtract.empty?' empty':''));
        info.append(E('strong',lastExtract.empty?`'${lastExtract.doc.fileName}'에서 GHS 항목을 찾지 못했습니다. 아래에서 직접 선택하세요.`:`'${lastExtract.doc.fileName}'에서 읽어온 내용으로 채웠습니다.`));
        info.append(E('p',r.summary||'','hint'));
        if(!lastExtract.empty)info.append(E('p',(r.pictogramSource==='from-h'?'그림문자는 H코드로 추정했습니다. ':'')+'저장 전에 MSDS 2절과 한 번 비교하세요.','hint'));
        box.append(info);
      }
      // 그림문자
      box.append(E('p','그림문자 (해당하는 것을 모두 선택)','ghs-section-title'));
      const grid=E('div',undefined,'ghs-picto-grid');
      for(const code of CODES){const b=E('button',undefined,'ghs-picto');b.type='button';b.dataset.code=code;b.innerHTML=iconImg(code,46,'ghs-picto-img')+`<span>${esc(code)}</span><small>${esc(D.PICTOGRAMS[code].label)}</small>`;b.title=D.PICTOGRAMS[code].desc;const sync=()=>{const on=draft.pictograms.includes(code);b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on));};sync();b.onclick=()=>{const i=draft.pictograms.indexOf(code);if(i>=0)draft.pictograms.splice(i,1);else draft.pictograms.push(code);draft.pictograms.sort((a,b)=>CODES.indexOf(a)-CODES.indexOf(b));sync();};grid.append(b);}
      box.append(grid);
      const fg=E('div',undefined,'field-grid ghs-field-grid');
      const signal=E('select');for(const [v,t] of [['','(미지정)'],['Danger','위험 (Danger)'],['Warning','경고 (Warning)'],['None','신호어 없음']]){const o=E('option',t);o.value=v;signal.append(o);}signal.value=draft.signalWord;signal.onchange=()=>{draft.signalWord=signal.value;};
      const source=E('select');for(const [v,t] of [['','(선택)'],['supplier','공급자(제조사) MSDS'],['kosha','KOSHA 화학물질정보 MSDS'],['catalog','검토 SDS 자료(프로그램 내장)'],['other','기타']]){const o=E('option',t);o.value=v;source.append(o);}source.value=draft.source;source.onchange=()=>{draft.source=source.value;};
      const sourceNote=E('input');sourceNote.type='text';sourceNote.value=draft.sourceNote;sourceNote.placeholder='예: Sigma-Aldrich SDS 2024-03 개정본';sourceNote.maxLength=200;sourceNote.oninput=()=>{draft.sourceNote=sourceNote.value;};
      const classes=E('input');classes.type='text';classes.value=draft.hazardClasses;classes.placeholder='예: 인화성 액체 구분 2; 눈 자극성 구분 2A';classes.maxLength=500;classes.oninput=()=>{draft.hazardClasses=classes.value;};
      const issued=E('input');issued.type='date';issued.value=draft.msdsIssuedAt;issued.onchange=()=>{draft.msdsIssuedAt=issued.value;};
      const rev=E('input');rev.type='text';rev.value=draft.msdsRevision;rev.placeholder='예: Rev. 6';rev.maxLength=40;rev.oninput=()=>{draft.msdsRevision=rev.value;};
      const reviewedWrap=E('div',undefined,'ghs-date-row'),reviewed=E('input');reviewed.type='date';reviewed.value=draft.msdsReviewedAt;reviewed.onchange=()=>{draft.msdsReviewedAt=reviewed.value;};reviewedWrap.append(reviewed,button('오늘',()=>{reviewed.value=today();draft.msdsReviewedAt=reviewed.value;}));
      const note=E('textarea');note.rows=2;note.value=draft.note;note.placeholder='예: 보관 시 산화제와 분리, 국소배기 하에서 취급';note.maxLength=1000;note.oninput=()=>{draft.note=note.value;};
      fg.append(field('신호어',signal),field('유해·위험성 분류 (MSDS 2절)',classes),field('GHS 정보 출처',source),field('출처 메모',sourceNote),field('MSDS 작성·개정일',issued),field('MSDS 개정번호',rev),field('MSDS 검토일 (비치 자료 확인일)',reviewedWrap),field('취급·보관 메모',note,true));
      box.append(fg);
      const hp=codePicker('H',draft.hCodes,'유해·위험 문구 (H코드)','코드나 문구로 검색해 추가합니다.');
      const suggest=button('H코드로 그림문자·신호어 제안',()=>{if(!draft.hCodes.length){toast('먼저 H코드를 추가하세요.',true);return;}const s=D.suggestFromH(draft.hCodes);draft.pictograms=s.pictograms;draft.signalWord=s.signalWord;draw(true);toast(`제안: ${s.pictograms.join(', ')||'그림문자 없음'} · ${D.SIGNAL[s.signalWord]||'신호어 미지정'}. 혼합물·구분에 따라 다를 수 있으니 MSDS와 대조하세요.`);});
      hp.querySelector('.ghs-picker-head').append(suggest);box.append(hp);
      box.append(codePicker('P',draft.pCodes,'예방조치 문구 (P코드)','선택 사항. 라벨·교육용으로 주요 문구만 입력해도 됩니다.'));
      const actions=E('div',undefined,'msds-actions ghs-actions');
      actions.append(button('저장',()=>commit(D.normalizeGHS(draft)),'primary'),button('취소',()=>{editing=false;draft=null;lastExtract=null;draw();}),button('검토 SDS 자료로 채우기',applyCatalog));
      if(item.ghs)actions.append(button('GHS 정보 지우기',()=>{if(confirm('이 품목의 GHS 분류·MSDS 정보를 모두 지울까요?\n첨부된 MSDS PDF는 지워지지 않습니다.'))commit(null);},'danger'));
      box.append(actions);
      return box;
    }
    function viewer(item){
      const box=E('div',undefined,'ghs-view'),g=item.ghs,st=D.msdsStatus(item,reviewMonths(settings()),today());
      if(!D.hasClassification(item)){
        box.append(E('p',docs().length?'GHS 분류가 아직 없습니다. \'첨부 MSDS에서 추출\'을 누르면 첨부한 PDF의 2절(유해성·위험성)에서 그림문자·신호어·H/P 문구를 읽어옵니다.':'GHS 분류가 아직 없습니다. CAS 번호가 있으면 \'KOSHA MSDS 자동 받기\'로 국문 MSDS를 받아 첨부하고 GHS까지 자동으로 채웁니다. 제조사 PDF가 있으면 첨부하면 자동으로 읽어옵니다.','hint ghs-empty'));
      }else{
        const head=E('div',undefined,'ghs-view-head');
        const sym=E('div',undefined,'safety-symbols ghs-symbols');
        for(const code of g.pictograms){const tile=E('div',undefined,'safety-symbol');tile.innerHTML=iconImg(code,60)+`<small>${esc(code)} ${esc(D.PICTOGRAMS[code].label)}</small>`;sym.append(tile);}
        if(!g.pictograms.length)sym.append(E('span','그림문자 없음','hint'));
        head.append(sym);
        const meta=E('div',undefined,'ghs-view-meta');
        meta.innerHTML=`<div>신호어: ${signalBadge(g.signalWord)||'<span class="hint">미지정</span>'}</div>${g.hazardClasses?`<div class="ghs-classes">${esc(g.hazardClasses)}</div>`:''}`;
        head.append(meta);box.append(head);
        if(g.hCodes.length){const d=E('details',undefined,'safety-hazards');d.open=true;d.append(E('summary',`유해·위험 문구 ${g.hCodes.length}개`));const l=E('div');for(const c of g.hCodes)l.append(E('p',`${c} · ${D.hText(c)}`));d.append(l);box.append(d);}
        if(g.pCodes.length){const d=E('details',undefined,'safety-hazards');d.append(E('summary',`예방조치 문구 ${g.pCodes.length}개`));const l=E('div');for(const c of g.pCodes)l.append(E('p',`${c} · ${D.pText(c)}`));d.append(l);box.append(d);}
        if(g.note)box.append(E('p','메모: '+g.note,'hint'));
      }
      const src={supplier:'공급자(제조사) MSDS',kosha:'KOSHA MSDS',catalog:'검토 SDS 자료',other:'기타'}[g?.source]||'';
      const info=E('div',undefined,'ghs-msds-info');
      const bits=[`MSDS 첨부 ${st.attached}개`,g?.msdsIssuedAt?`작성·개정일 ${g.msdsIssuedAt}${g.msdsRevision?' ('+g.msdsRevision+')':''}`:'',g?.msdsReviewedAt?`검토일 ${g.msdsReviewedAt}`:'',st.nextReviewAt?`다음 검토 ${st.nextReviewAt}`:'',src?`출처 ${src}${g.sourceNote?' · '+g.sourceNote:''}`:''].filter(Boolean);
      info.innerHTML=`<span class="ghs-msds ${st.state==='overdue'?'bad':st.state==='due-soon'||st.state==='unset'||st.state==='missing'?'warn':st.state==='none'?'':'ok'}">${esc(st.label)}</span> <span class="hint">${esc(bits.join(' · '))}</span>`;
      box.append(info);
      return box;
    }
    async function draw(keepScroll){
      if(!alive())return;
      const item=getItem(itemId);
      const scroller=element.closest('.detail-modal-scroll'),y=keepScroll&&scroller?scroller.scrollTop:null;
      element.replaceChildren();
      const heading=E('div',undefined,'msds-heading'),title=E('h4','GHS 분류·표시 (유해성·위험성)'),tools=E('div',undefined,'msds-actions');
      const list=docs();
      tools.append(button('KOSHA MSDS 자동 받기',()=>koshaAuto(),'primary'));
      if(list.length>1){const sel=E('select');sel.className='ghs-doc-select';sel.title='자동 추출에 사용할 MSDS';for(const d of list){const o=E('option',d.fileName);o.value=d.id;sel.append(o);}sel.value=pickedDoc()?.id||'';sel.onchange=()=>{pickedDocId=sel.value;};tools.append(sel);}
      if(list.length)tools.append(button('첨부 MSDS에서 추출',()=>extractFrom(pickedDoc())));
      else tools.append(button('PDF 첨부 → 추출',attachThenExtract));
      if(!editing){tools.append(button(D.hasClassification(item)||item.ghs?'편집':'직접 입력',()=>{startEdit();draw();}));}
      tools.append(button('KOSHA MSDS 검색',()=>lookup('kosha')),button('PubChem',()=>lookup('pubchem')));
      heading.append(title,tools);element.append(heading);
      if(!icons.size)await preload();
      if(!alive())return;
      if(koshaChoices){
        const box=E('div',undefined,'ghs-extract-box');box.append(E('strong','KOSHA 검색 결과에서 맞는 물질을 선택하세요.'));
        const list=E('div',undefined,'ghs-kosha-list');
        for(const row of koshaChoices){list.append(button(`${row.name} · CAS ${row.casNo||'미표기'}${row.revisedAt?' · 개정 '+row.revisedAt:''}${row.pictograms?.length?' · '+row.pictograms.join(' '):''}`,()=>koshaAuto(row),'ghs-picker-hit'));}
        list.append(button('취소',()=>{koshaChoices=null;draw();}));box.append(list);element.append(box);
      }
      element.append(editing?editor(item):viewer(item));
      if(y!==null&&scroller)scroller.scrollTop=y;
    }
    element._ghsApi={refresh:draw,autoExtract:async doc=>{
      const item=getItem(itemId);if(!item)return;
      if(D.hasClassification(item)&&!confirm(`새로 첨부한 MSDS '${doc.fileName}'에서 GHS 정보를 다시 읽어 기존 분류를 바꿀까요?\n읽어온 내용은 저장을 누르기 전까지 반영되지 않습니다.`))return;
      pickedDocId=doc.id;await extractFrom(doc);
      try{element.scrollIntoView({block:'start',behavior:'smooth'});}catch{}
    }};
    draw();
    return element._ghsApi;
  }
  function refreshAll(){for(const [el,opts] of panels){if(!el.isConnected)panels.delete(el);else mountDetail(opts);}}
  // MSDS가 새로 첨부되면 해당 품목의 GHS 패널에서 자동 추출을 시작한다.
  function onDocumentsAttached(itemId,documents){
    const doc=(documents||[]).slice(-1)[0];if(!doc)return;
    for(const [el,opts] of panels){
      if(!el.isConnected){panels.delete(el);continue;}
      if(opts.itemId!==itemId||!el._ghsApi)continue;
      el._ghsApi.autoExtract(doc);return;
    }
  }
  window.GHSUI={preload,icon,iconImg,cellHtml,inlineHtml,labelHtml,FILTERS,matchesFilter,counts,searchText,excelRows,mountDetail,refreshAll,reviewMonths,onDocumentsAttached,ghsFromExtract};
})();
