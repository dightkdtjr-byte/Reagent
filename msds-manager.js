'use strict';
// MSDS 관리 화면: 모든 품목의 MSDS 첨부·검토 상태와 GHS 입력 현황을 한곳에서 보고, KOSHA 일괄 받기를 실행한다.
(() => {
  const D=window.GHSData;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const E=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined&&text!==null)e.textContent=text;if(cls)e.className=cls;return e;};
  const button=(text,fn,cls='ghost')=>{const b=E('button',text,cls);b.type='button';b.onclick=fn;return b;};
  const today=()=>{const d=new Date(),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;};
  const CAS_RE=/^\d{2,7}-\d{2}-\d$/;
  const SOURCE={supplier:'공급자 MSDS',kosha:'받은 MSDS (KOSHA)',catalog:'검토 SDS',other:'기타'};
  let state={filter:'all',query:'',busy:false,stop:false,progress:'',lastRun:null};
  const FILTERS=[['all','전체'],['msds-missing','MSDS 없음'],['msds-review','검토 필요·기한 경과'],['ghs-missing','GHS 미입력'],['kosha','받은 MSDS (KOSHA)'],['supplier','직접 첨부 자료'],['ok','정상']];
  function docSource(doc){return doc.koshaChemId?'받은 MSDS (KOSHA)':doc.sourceId?'검토 SDS':'직접 첨부';}
  function rowState(item,settings){return D.msdsStatus(item,window.GHSUI.reviewMonths(settings),today());}
  function matches(item,st,settings){
    const f=state.filter,docs=item.msdsDocuments||[];
    if(f==='msds-missing'&&docs.length)return false;
    if(f==='msds-review'&&!(st.state==='overdue'||st.state==='due-soon'||st.state==='unset'))return false;
    if(f==='ghs-missing'&&D.hasClassification(item))return false;
    if(f==='kosha'&&!docs.some(d=>d.koshaChemId))return false;
    if(f==='supplier'&&!docs.some(d=>!d.koshaChemId&&!d.sourceId))return false;
    if(f==='ok'&&!(docs.length&&st.state==='ok'&&D.hasClassification(item)))return false;
    const q=state.query.trim().toLowerCase();
    if(q&&![item.id,item.name,item.nameEn,item.casNo,item.maker,...docs.map(d=>d.fileName)].join(' ').toLowerCase().includes(q))return false;
    return true;
  }
  const severity=(item,st)=>(!(item.msdsDocuments||[]).length?0:st.state==='overdue'?1:st.state==='due-soon'||st.state==='unset'?2:!D.hasClassification(item)?3:4);
  function mount(opts){
    const {element,getItems,getItem,save,toast,confirm,settings,openItem}=opts;if(!element)return;
    const items=()=>getItems().filter(r=>!r.archivedAt);
    async function saveItem(){let ok=false;try{ok=await save();}catch{}return ok;}
    async function markReviewed(item){
      const before=item.ghs?JSON.parse(JSON.stringify(item.ghs)):undefined,beforeUpdated=item.updatedAt;
      const g=item.ghs?{...item.ghs}:{};g.msdsReviewedAt=today();g.updatedAt=new Date().toISOString();item.ghs=D.normalizeGHS(g)||g;item.updatedAt=g.updatedAt;
      if(!await saveItem()){if(before===undefined)delete item.ghs;else item.ghs=before;item.updatedAt=beforeUpdated;toast('저장하지 못했습니다.',true);return;}
      toast(`${item.id} MSDS 검토일을 오늘로 기록했습니다.`);draw();
    }
    async function preview(doc){try{const r=await window.inventoryMSDS.preview(doc);if(!r?.ok)throw new Error(r?.error||'열기 실패');}catch(e){toast('PDF 미리보기 실패: '+String(e.message||e),true);}}
    async function exportDoc(doc){try{const r=await window.inventoryMSDS.export(doc);if(!r?.ok)throw new Error(r?.error||'저장 실패');if(!r.canceled)toast('PDF 사본을 저장했습니다.');}catch(e){toast('PDF 저장 실패: '+String(e.message||e),true);}}
    // 한 품목을 KOSHA에서 받아 첨부하고, GHS가 비어 있으면 읽어온 값으로 채운다.
    async function koshaOne(item){
      const cas=String(item.casNo||'').trim();if(!CAS_RE.test(cas))throw new Error('CAS 번호가 없거나 형식이 맞지 않습니다.');
      const s=await window.inventorySafety.koshaSearch(cas);if(!s?.ok)throw new Error(s?.error||'검색 실패');
      const rows=(s.rows||[]).filter(r=>r.casNo===cas);if(!rows.length)throw new Error('해당 CAS의 MSDS를 찾지 못했습니다 (KOSHA).');
      const pick=rows[0];
      const rec=await window.inventorySafety.koshaReceive(pick.chemId,{name:pick.name,casNo:pick.casNo,revisedAt:pick.revisedAt});if(!rec?.ok)throw new Error(rec?.error||'받기 실패');
      const live=getItem(item.id);if(!live)throw new Error('품목이 삭제되었습니다.');
      const beforeDocs=live.msdsDocuments,beforeGhs=live.ghs,beforeUpdated=live.updatedAt;
      const old=live.msdsDocuments||[];if(!old.some(d=>d.id===rec.document.id)){if(old.length>=20)throw new Error('첨부 문서가 20개입니다.');live.msdsDocuments=[...old,rec.document];}
      let filled=false;
      if(!D.hasClassification(live)){const g=window.GHSUI.ghsFromExtract(rec.document,rec.extract,'kosha',live.ghs);if(g){if(!g.pictograms.length&&pick.pictograms?.length){g.pictograms=pick.pictograms.slice();if(!g.signalWord&&pick.signalWord)g.signalWord=pick.signalWord;}live.ghs=g;filled=true;}}
      live.updatedAt=new Date().toISOString();
      if(!await saveItem()){if(beforeDocs===undefined)delete live.msdsDocuments;else live.msdsDocuments=beforeDocs;if(beforeGhs===undefined)delete live.ghs;else live.ghs=beforeGhs;live.updatedAt=beforeUpdated;throw new Error('저장하지 못해 되돌렸습니다.');}
      return {name:pick.name,filled};
    }
    async function bulkKosha(){
      if(state.busy)return;
      if(!window.inventorySafety?.koshaSearch){toast('MSDS 받기는 설치형 앱에서 사용할 수 있습니다.',true);return;}
      const targets=items().filter(r=>CAS_RE.test(String(r.casNo||'').trim())&&!(r.msdsDocuments||[]).length);
      const noCas=items().filter(r=>!(r.msdsDocuments||[]).length&&!CAS_RE.test(String(r.casNo||'').trim())).length;
      if(!targets.length){toast(noCas?`MSDS가 없는 품목 ${noCas}개는 CAS 번호가 없어 자동으로 받을 수 없습니다. CAS를 입력하거나 PDF를 직접 첨부하세요.`:'MSDS가 없는 품목이 없습니다.',!!noCas);return;}
      if(!confirm(`CAS 번호가 있고 MSDS가 없는 품목 ${targets.length}개의 MSDS를 받아 첨부할까요? (출처: 안전보건공단 KOSHA)${noCas?`\n(CAS가 없는 ${noCas}개는 건너뜁니다.)`:''}\n품목당 10~30초 걸리며 중간에 중단할 수 있습니다. GHS가 비어 있는 품목은 읽어온 분류로 채웁니다.`))return;
      state.busy=true;state.stop=false;const result={ok:0,filled:0,errors:[]};
      try{
        for(let i=0;i<targets.length;i++){
          if(state.stop)break;const item=getItem(targets[i].id);if(!item)continue;
          state.progress=`${i+1} / ${targets.length} · ${item.id} ${item.name||''} 받는 중…`;drawProgress();
          try{const r=await koshaOne(item);result.ok++;if(r.filled)result.filled++;}
          catch(e){result.errors.push(`${item.id} ${item.name||''}: ${String(e.message||e)}`);if(/서버 응답이 늦어|네트워크|인터넷|CERT|ENOTFOUND/.test(String(e.message||e))&&result.errors.length>=2){state.stop=true;}}
          drawTable();
        }
      }finally{state.busy=false;state.progress='';state.lastRun={...result,at:new Date().toLocaleString('ko-KR',{hour12:false}),stopped:state.stop,total:targets.length};draw();}
      toast(`MSDS ${result.ok}개 첨부${result.filled?` · GHS ${result.filled}개 채움`:''}${result.errors.length?` · 실패 ${result.errors.length}개`:''}${state.lastRun.stopped?' · 중단됨':''}`,result.errors.length>0);
    }
    function drawProgress(){const p=element.querySelector('#msds-mgr-progress');if(p){p.textContent=state.progress;p.hidden=!state.progress;}const stop=element.querySelector('#msds-mgr-stop');if(stop){stop.hidden=!state.busy;}element.querySelectorAll('[data-busy-lock]').forEach(b=>b.disabled=state.busy);}
    function summaryChips(){
      const list=items(),s=settings();let missing=0,review=0,ghsMissing=0,kosha=0,docs=0;
      for(const r of list){const st=rowState(r,s),n=(r.msdsDocuments||[]).length;docs+=n;if(!n)missing++;if(st.state==='overdue'||st.state==='due-soon'||st.state==='unset')review++;if(!D.hasClassification(r))ghsMissing++;if((r.msdsDocuments||[]).some(d=>d.koshaChemId))kosha++;}
      const chips=E('div',undefined,'stat-chips');
      const chip=(label,n,cls,filter)=>{const c=E('div',undefined,'chip clickable'+(cls&&n?' '+cls:''));c.innerHTML=`${esc(label)} <b>${n}</b>`;c.onclick=()=>{state.filter=state.filter===filter?'all':filter;draw();};if(state.filter===filter)c.style.borderColor='var(--teal-dark)';return c;};
      chips.append(chip('활성 품목',list.length,'','all'),chip('MSDS 문서',docs,'','all'),chip('MSDS 없음',missing,'bad','msds-missing'),chip('검토 필요',review,'warn','msds-review'),chip('GHS 미입력',ghsMissing,'warn','ghs-missing'),chip('받은 MSDS (KOSHA)',kosha,'','kosha'));
      return chips;
    }
    function docRow(item,doc,st){
      const row=E('div',undefined,'msds-mgr-doc');
      const info=E('div',undefined,'msds-mgr-doc-info');
      info.append(E('div',doc.fileName,'msds-name'));
      const meta=[docSource(doc),doc.koshaRevisedAt?`원문 개정 ${doc.koshaRevisedAt}`:'',`첨부 ${String(doc.addedAt||'').slice(0,10)}`,`${(doc.size/1048576).toFixed(1)} MB`].filter(Boolean).join(' · ');
      info.append(E('div',meta,'hint'));
      const actions=E('div',undefined,'msds-actions');
      actions.append(button('미리보기',()=>preview(doc),'primary'),button('내보내기',()=>exportDoc(doc)));
      row.append(info,actions);return row;
    }
    function drawTable(){
      const wrap=element.querySelector('#msds-mgr-table');if(!wrap)return;wrap.replaceChildren();
      const s=settings(),rows=items().map(r=>({r,st:rowState(r,s)})).filter(x=>matches(x.r,x.st,s)).sort((a,b)=>severity(a.r,a.st)-severity(b.r,b.st)||a.r.id.localeCompare(b.r.id));
      if(!rows.length){wrap.append(E('p','해당하는 품목이 없습니다.','hint'));return;}
      const table=E('table',undefined,'msds-mgr-tbl');table.innerHTML='<thead><tr><th style="width:24%">품목</th><th style="width:15%">GHS</th><th>MSDS 문서</th><th style="width:160px">상태</th><th style="width:196px">작업</th></tr></thead>';
      const body=E('tbody');
      for(const {r,st} of rows){
        const tr=E('tr');
        const c1=E('td');const nameBtn=button(`${r.id} · ${r.name||r.nameEn||''}`,()=>openItem(r.id),'msds-mgr-link');c1.append(nameBtn,E('div',[(r.category||'reagent')==='standard'?'표준물질':'시약',r.casNo?`CAS ${r.casNo}`:'CAS 미입력',r.maker||''].filter(Boolean).join(' · '),'hint'));
        const c2=E('td');c2.innerHTML=window.GHSUI.cellHtml(r,s).replace(/<span class="ghs-msds[^"]*"[^>]*>[^<]*<\/span>/g,'');
        const c3=E('td');const docs=r.msdsDocuments||[];if(!docs.length)c3.append(E('span','첨부된 MSDS가 없습니다.','hint'));else for(const d of docs)c3.append(docRow(r,d,st));
        const g=r.ghs||{};const bits=[g.msdsIssuedAt?`작성·개정 ${g.msdsIssuedAt}`:'',g.msdsReviewedAt?`검토 ${g.msdsReviewedAt}`:'',st.nextReviewAt?`다음 검토 ${st.nextReviewAt}`:'',g.source?SOURCE[g.source]:''].filter(Boolean);
        const c4=E('td');c4.innerHTML=`<span class="ghs-msds ${st.state==='overdue'?'bad':st.state==='due-soon'||st.state==='unset'||st.state==='missing'||st.state==='none'?'warn':'ok'}">${esc(st.label)}</span><div class="hint">${esc(bits.join(' · '))}</div>`;
        const c5=E('td');const acts=E('div',undefined,'msds-mgr-acts');
        if(!docs.length){const hasCas=CAS_RE.test(String(r.casNo||'').trim());const b=button('MSDS 받기',async()=>{if(state.busy)return;if(!hasCas){toast(`${r.id}: CAS 번호가 없어 자동으로 찾을 수 없습니다. 품목 열기에서 CAS를 입력하거나, 상세 화면의 'MSDS 받기'로 품명 검색을 하거나, PDF를 직접 첨부하세요.`,true);return;}state.busy=true;drawProgress();try{const res=await koshaOne(r);toast(`${r.id}: MSDS 첨부${res.filled?' · GHS 채움':''}`);}catch(e){toast(`${r.id}: ${String(e.message||e)}`,true);}finally{state.busy=false;draw();}},hasCas?'primary':'ghost');b.title=hasCas?'안전보건공단(KOSHA) 화학물질정보에서 CAS로 받기':'CAS 번호가 없어 자동으로 받을 수 없습니다';if(!hasCas)b.style.opacity='.6';b.dataset.busyLock='1';acts.append(b);}
        if(docs.length){const b=button('검토 완료',()=>markReviewed(r));b.title='오늘 날짜로 MSDS 검토일 기록';b.dataset.busyLock='1';acts.append(b);}
        acts.append(button('품목 열기',()=>openItem(r.id)));
        c5.append(acts);tr.append(c1,c2,c3,c4,c5);body.append(tr);
      }
      table.append(body);wrap.append(table);drawProgress();
    }
    function draw(){
      element.replaceChildren();
      const head=E('div',undefined,'msds-mgr-head');head.append(E('h3','MSDS · GHS 관리'));
      head.append(E('p','전체 품목의 MSDS 첨부·검토 상태와 GHS 입력 현황. CAS 번호가 있는 품목은 MSDS를 한 번에 받을 수 있습니다 (출처: 안전보건공단 KOSHA).','hint'));
      element.append(head,summaryChips());
      const tools=E('div',undefined,'msds-mgr-tools');
      const search=E('input');search.type='search';search.placeholder='품목명 / ID / CAS / 파일명 검색';search.value=state.query;search.oninput=()=>{state.query=search.value;drawTable();};
      const sel=E('select');for(const [v,t] of FILTERS){const o=E('option',t);o.value=v;sel.append(o);}sel.value=state.filter;sel.onchange=()=>{state.filter=sel.value;drawTable();};
      const bulk=button('MSDS 일괄 받기 (KOSHA)',bulkKosha,'primary');bulk.dataset.busyLock='1';
      const stop=button('중단',()=>{state.stop=true;});stop.id='msds-mgr-stop';stop.hidden=!state.busy;
      tools.append(search,sel,bulk,stop,button('현황 엑셀 저장',()=>opts.exportExcel?.()),button('MSDS 폴더 열기',async()=>{try{const r=await window.inventoryMSDS.folder();if(!r?.ok)throw new Error(r?.error||'폴더 열기 실패');}catch(e){toast(String(e.message||e),true);}}),button('새로고침',draw));
      element.append(tools);
      const progress=E('p','','hint msds-mgr-progress');progress.id='msds-mgr-progress';progress.setAttribute('role','status');progress.hidden=!state.progress;progress.textContent=state.progress;element.append(progress);
      if(state.lastRun){const r=state.lastRun;const box=E('details',undefined,'msds-mgr-lastrun');box.open=r.errors.length>0;box.append(E('summary',`직전 일괄 받기 (${r.at}): 대상 ${r.total}개 · 첨부 ${r.ok}개 · GHS 채움 ${r.filled}개 · 실패 ${r.errors.length}개${r.stopped?' · 중단됨':''}`));for(const e of r.errors)box.append(E('p',e,'hint safety-warning'));element.append(box);}
      const wrap=E('div',undefined,'msds-mgr-table');wrap.id='msds-mgr-table';element.append(wrap);
      element.append(E('p','받은 MSDS는 안전보건공단(KOSHA)의 물질 기준 국문 자료입니다. 검토 주기는 설정에서 바꿀 수 있습니다.','hint safety-notice'));
      drawTable();
    }
    draw();
    return {refresh:draw};
  }
  window.MSDSManager={mount};
})();
