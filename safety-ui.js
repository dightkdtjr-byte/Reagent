'use strict';
(() => {
 const C=window.InventorySafetyCommon;
 const LABELS={GHS01:'폭발성',GHS02:'인화성 등',GHS03:'산화성',GHS04:'고압가스',GHS05:'부식성',GHS06:'급성독성',GHS07:'유해·자극성 등',GHS08:'건강 유해성',GHS09:'환경 유해성'};
 // Korean reading aid, not a Korean legal label or a replacement for the supplier SDS.
 const H={H225:'인화성이 매우 높은 액체·증기',H226:'인화성 액체·증기',H272:'산화 작용으로 화재를 강하게 할 수 있음',H290:'금속을 부식시킬 수 있음',H301:'삼키면 독성이 있음',H302:'삼키면 유해함',H304:'삼켜 기도로 들어가면 치명적일 수 있음',H311:'피부에 접촉하면 독성이 있음',H312:'피부에 접촉하면 유해함',H314:'심한 피부 화상과 눈 손상을 일으킴',H315:'피부 자극을 일으킴',H317:'알레르기성 피부 반응을 일으킬 수 있음',H318:'심한 눈 손상을 일으킴',H319:'심한 눈 자극을 일으킴',H320:'눈 자극을 일으킴',H330:'흡입하면 치명적임',H331:'흡입하면 독성이 있음',H332:'흡입하면 유해함',H334:'흡입 시 알레르기·천식 증상이나 호흡 곤란을 일으킬 수 있음',H335:'호흡기를 자극할 수 있음',H336:'졸음이나 어지러움을 일으킬 수 있음',H341:'유전적 결함을 일으킬 것으로 의심됨',H350:'암을 일으킬 수 있음',H373:'장기간 또는 반복 노출로 장기에 손상을 일으킬 수 있음',H351:'암을 일으킬 것으로 의심됨',H360:'생식능력 또는 태아에 손상을 줄 수 있음',H361:'생식능력 또는 태아에 손상을 줄 것으로 의심됨',H362:'모유를 먹는 아이에게 해를 줄 수 있음',H370:'장기에 손상을 일으킴',H371:'장기에 손상을 일으킬 수 있음',H372:'장기간 또는 반복 노출로 장기에 손상을 일으킴',H400:'수생생물에 매우 강한 독성이 있음',H401:'수생생물에 독성이 있음',H402:'수생생물에 유해함',H410:'수생생물에 매우 강한 독성이 있으며 영향이 오래 지속됨',H411:'수생생물에 독성이 있으며 영향이 오래 지속됨',H412:'수생생물에 유해하며 영향이 오래 지속됨'};
 let catalogPromise=null,busy=false,stop=false,settingsOpts=null,lastBatchResult=null;
 const panels=new Map(),lastDetailErrors=new Map(),lastFeedback=new Map();
 const E=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
 const button=(text,fn,cls='ghost')=>{const b=E('button',text,cls);b.type='button';b.onclick=fn;return b;};
 const clone=v=>JSON.parse(JSON.stringify(v));
 const safeError=e=>String(e?.message||e);
 function reportEntry(error,item,source){
   const d=error?.diagnostic||{};
   return {id:item?.id||'',name:item?.name||item?.nameEn||'',sourceId:source?.id||error?.record?.sourceId||'',url:source?.pdfURL||d.url||'',error:d.message||safeError(error),diagnostic:d,historyWarning:error?.historyWarning||null};
 }
 function entryText(entry){
   const d=entry.diagnostic||{},lines=[];
   if(entry.id||entry.name)lines.push(`품목: ${entry.id||''} ${entry.name||''}`.trim());
   if(entry.sourceName)lines.push('문서: '+entry.sourceName);
   if(entry.at||d.at)lines.push('발생 시각: '+new Date(entry.at||d.at).toLocaleString('ko-KR',{hour12:false}));
   lines.push('결과: '+(entry.ok===true?`PDF 사본 저장됨${entry.cached?' (기존 사본 사용)':''}${entry.warningCount?' / 그림문자 '+entry.warningCount+'개 미완료':''}`:(entry.error||d.message||'다운로드 실패')));
   if(entry.ok!==true){
    lines.push('단계: '+(d.stage||'자료 연결'),'오류 코드: '+(d.code||'UNKNOWN'));
    if(d.httpStatus)lines.push('서버 응답: HTTP '+d.httpStatus);
    if(d.hint)lines.push('설명: '+d.hint);
    if(d.nativeMessage)lines.push('원래 오류: '+d.nativeMessage);
   }
   if(entry.url||d.url)lines.push('원문 주소: '+(entry.url||d.url));
   if(d.transport)lines.push('연결 방식: '+d.transport);
   if(d.receivedBytes)lines.push('수신 크기: '+d.receivedBytes+' bytes');
   if(d.contentType)lines.push('응답 형식: '+d.contentType);
   if(d.elapsedMs)lines.push('경과: '+(d.elapsedMs/1000).toFixed(1)+'초');
   for(const w of entry.warnings||[])lines.push('그림문자 '+w.code+': '+(w.diagnostic?.message||w.error||'받지 못함')+' ['+(w.diagnostic?.code||'UNKNOWN')+']');
   if(entry.historyWarning)lines.push('추가: 오류 기록 파일도 저장하지 못했습니다. 이 창에서 내용을 복사해주세요.');
   return lines.join('\n');
 }
 async function copyText(value,status){
   try{
    if(window.inventorySafety?.copy){const r=await window.inventorySafety.copy(value);if(!r?.ok)throw new Error(r?.error||'복사 실패');}
    else if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(value);
    else throw new Error('클립보드를 사용할 수 없습니다. 아래 오류 내용을 직접 선택해 복사해주세요.');
    status.textContent='오류 내용을 복사했습니다.';
   }catch(e){status.textContent='복사하지 못했습니다: '+safeError(e)+' 아래 텍스트를 선택한 뒤 Ctrl+C로 복사할 수 있습니다.';}
 }
 function showReport(entries,title='MSDS 다운로드 실패 내역'){
   document.getElementById('safety-download-dialog')?.remove();
   const dialog=E('dialog',undefined,'safety-download-dialog');dialog.id='safety-download-dialog';dialog.setAttribute('aria-labelledby','safety-download-title');
   const heading=E('h3',title);heading.id='safety-download-title';
   const note=E('p','이 창은 자동으로 사라지지 않습니다. 실패한 다운로드는 문서 연결 완료로 처리하지 않습니다.','hint');
   const report=E('textarea');report.id='safety-download-report';report.readOnly=true;report.setAttribute('aria-label','복사 가능한 다운로드 진단 내역');
   report.value='시약 재고관리시스템 v3.12.0 · '+title+'\n\n'+(entries.length?entries.map(entryText).join('\n\n────────────────────\n\n'):'저장된 다운로드 결과가 없습니다.');
   const status=E('p','','hint');status.setAttribute('role','status');const actions=E('div',undefined,'msds-actions');
   actions.append(button('오류 내용 복사',()=>copyText(report.value,status)),button('닫기',()=>dialog.close(),'primary'));
   dialog.append(heading,note,report,status,actions);document.body.append(dialog);
   dialog.addEventListener('keydown',e=>e.stopPropagation());dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
 }
 window.addEventListener('keydown',e=>{const dialog=document.getElementById('safety-download-dialog');if(dialog?.open&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();dialog.close();}},true);
 async function history(){
   if(!window.inventorySafety?.history)return [];
   const r=await window.inventorySafety.history();if(!r?.ok)throw new Error(r?.error||'다운로드 기록 읽기 실패');return r.entries||[];
 }
 async function showHistory(toast){try{showReport(await history(),'최근 다운로드 결과 (최대 50건)');}catch(e){toast(safeError(e),true);showReport([{error:safeError(e)}],'다운로드 기록 읽기 실패');}}
 function failurePanel(entry,source,toast){
   const box=E('details',undefined,'safety-download-failure');box.open=false;
   box.append(E('summary','다운로드 실패 — '+(entry.error||entry.diagnostic?.message||'오류 내역 확인')));
   const info=E('pre',entryText(entry));box.append(info);const actions=E('div',undefined,'msds-actions'),status=E('p','','hint');
   actions.append(button('오류 내용 복사',()=>copyText(entryText(entry),status)),button('상세 오류 보기',()=>showReport([entry])));
   if(source)actions.append(button('제조사 원문 주소 열기',()=>sourceOpen(source,toast)));
   box.append(actions,status);return box;
 }
 async function catalog(){if(!window.inventorySafety)return null;if(!catalogPromise)catalogPromise=window.inventorySafety.catalog().then(r=>{if(!r?.ok)throw new Error(r?.error||'자료 목록 확인 실패');return r.catalog;}).catch(e=>{catalogPromise=null;throw e;});return catalogPromise;}
 function state(cat,item){return C.resolve(cat,item);}
 function statusText(entry){return {ready:'제품번호 일치 MSDS',reference:'동일 물질 참고 MSDS',composition:'조성 확인 필요',review:'제품 정보 확인 필요',unresolved:'미확인'}[entry.status]||'미확인';}
 function sourceInfo(root,source){root.append(E('p',source.publisher+' · '+source.productName,'safety-source'));root.append(E('p',`검토본 ${source.revisionDate} · 버전 ${source.revision} · ${source.language} · ${source.jurisdiction}`,'hint'));}
 function networkConfirm(confirm,count,usage='product'){return confirm(`${usage==='reference'?'같은 물질 참고 SDS':'제품번호 일치 SDS'} ${count}개 품목의 MSDS를 제조사 서버에서 받아 첨부할까요?\n인터넷 연결이 필요합니다.${usage==='reference'?'\n같은 물질의 다른 제품 자료이므로 실제 제품 MSDS와 다를 수 있습니다.':''}`);}
 function changedForm(item){const map={'d-name':'name','d-name-en':'nameEn','d-spec':'spec','d-cas':'casNo','d-maker':'maker','d-serial':'serialNo','d-concentration':'concentration','d-purity':'purity'};return Object.entries(map).some(([id,key])=>{const el=document.getElementById(id);return el&&!el.disabled&&el.value!==String(item[key]??'');});}
 function refresh(){for(const [el,opts]of panels){if(!el.isConnected)panels.delete(el);else drawDetail(opts);}if(settingsOpts?.element?.isConnected)drawSettings(settingsOpts);}
 function locks(){document.querySelectorAll('[data-safety-receive]').forEach(b=>b.disabled=busy);const stopButton=document.getElementById('safety-stop');if(stopButton){stopButton.disabled=!busy;stopButton.hidden=!busy;}}
 async function commit(opts,itemId,expected,source,doc,cat,usage){
   const item=opts.getItem(itemId);if(!item||C.identity(item)!==expected)throw new Error('처리 중 품목의 식별정보가 변경되어 연결하지 않았습니다.');
   if(opts.itemId===itemId&&changedForm(item))throw new Error('처리 중 상세 입력란이 수정되어 연결하지 않았습니다. 먼저 품목을 저장해주세요.');
   const key=usage==='reference'?'safetyReferenceInfo':'safetyInfo',before=item.msdsDocuments,previous=item[key];
   const attached=usage==='reference'?{...doc,safetyUsage:'reference',fileName:'REFERENCE_'+doc.fileName}:doc;
   item.msdsDocuments=C.mergeDocuments(item,attached);
   item[key]={sourceId:source.id,identity:expected,documentId:doc.id,linkedAt:new Date().toISOString(),reviewedAt:source.reviewedAt||cat.reviewedAt,usage,equivalenceVerified:false,downloadedRevisionVerified:false,source:clone(source)};
   let ok=false;try{ok=await opts.save();}catch{}
   if(!ok){const live=opts.getItem(itemId);if(live){if(before===undefined)delete live.msdsDocuments;else live.msdsDocuments=before;if(previous===undefined)delete live[key];else live[key]=previous;}throw new Error('재고 파일에 연결 정보를 저장하지 못했습니다. 변경을 되돌렸습니다.');}
 }
 async function connectOne(opts,itemId,cat,usage='product',failedSources=null){
   const item=opts.getItem(itemId);if(!C.canConnect(cat,item,usage))throw new Error('선택한 종류의 자료 연결 조건이 맞지 않아 연결하지 않았습니다.');
   const expected=C.identity(item),source=C.resolvedSource(cat,item);
   if((item.msdsDocuments||[]).length>=20&&!item.msdsDocuments.some(d=>d.sourceId===source.id))throw new Error('이 품목의 첨부 문서가 이미 20개입니다.');
   if(failedSources?.has(source.id))throw failedSources.get(source.id);
   let result;try{result=await window.inventorySafety.receive(source.id);if(!result?.ok){const error=new Error(result?.error||'자료 다운로드 실패');error.diagnostic=result?.diagnostic;error.record=result?.record;error.historyWarning=result?.historyWarning;throw error;}}
   catch(e){failedSources?.set(source.id,e);throw e;}
   await commit(opts,itemId,expected,source,result.document,cat,usage);return result;
 }
 function currentDocument(opts,source,reference){
   const item=opts.getItem(opts.itemId);if(!item)return null;
   const link=item[reference?'safetyReferenceInfo':'safetyInfo'];
   if(!link||link.identity!==C.identity(item)||link.sourceId!==source.id)return null;
   return (item.msdsDocuments||[]).find(d=>d.id===link.documentId)||null;
 }
 async function availableDocument(opts,source,reference){
   const doc=currentDocument(opts,source,reference);if(!doc||!window.inventoryMSDS?.list)return null;
   const result=await window.inventoryMSDS.list([doc]);return result?.ok&&result.files?.[0]?.available?doc:null;
 }
 async function one(opts,intent='connect'){
  if(busy)return;busy=true;stop=false;locks();let source=null,item=null,phase='자료 연결';
  try{
   const cat=await catalog();item=opts.getItem(opts.itemId);
   if(!cat||!item)throw new Error('선택한 품목의 자료를 확인할 수 없습니다.');
   const entry=state(cat,item),reference=entry.status==='reference',usage=reference?'reference':'product';
   source=C.resolvedSource(cat,item);
   if(!source||!C.canConnect(cat,item,usage))throw new Error(entry.reason||'제품·조성 확인이 필요한 품목입니다.');
   if(changedForm(item)){opts.toast('수정 중인 품목 정보를 먼저 저장한 뒤 자료를 연결해주세요.',true);return;}
   let doc=await availableDocument(opts,source,reference);
   const status=opts.element.querySelector('.safety-file-status');
   if(!doc){
    if(!networkConfirm(opts.confirm,1,usage))return;
    if(status)status.textContent='MSDS 원본을 받아 문서 폴더에 저장하는 중입니다…';
    await connectOne(opts,item.id,cat,usage);
    doc=await availableDocument(opts,source,reference);
    if(!doc)throw new Error('연결 후 실제 PDF 파일을 확인하지 못했습니다.');
   }
   lastDetailErrors.delete(item.id);
   lastFeedback.set(item.id,{identity:C.identity(opts.getItem(item.id)),text:'PDF 저장·연결 완료 · '+doc.fileName});
   if(intent==='connect')setTimeout(()=>{try{window.GHSUI?.onDocumentsAttached?.(item.id,[doc]);}catch(e){console.error(e);}},50);
   // Never open a file/dialog for a different item after the user changed the detail view.
   if(panels.get(opts.element)!==opts||!opts.element.isConnected||opts.element.offsetParent===null)return;
   if(intent==='open'){
    phase='PDF 열기';const r=await window.inventoryMSDS.open(doc);if(!r?.ok)throw new Error(r?.error||'PDF 열기 실패');
   }else if(intent==='download'){
    phase='PDF 다운로드';
    const r=await window.inventoryMSDS.export({...doc,fileName:reference?'REFERENCE_'+doc.fileName.replace(/^REFERENCE_/,''):doc.fileName});
    if(!r?.ok)throw new Error(r?.error||'PDF 파일 내보내기 실패');
    if(r.canceled){lastFeedback.set(item.id,{identity:C.identity(opts.getItem(item.id)),text:'다른 위치에 저장은 취소했습니다. 프로그램의 PDF 사본은 연결되어 있습니다.'});}
    else{
     lastFeedback.set(item.id,{identity:C.identity(opts.getItem(item.id)),text:'PDF 다운로드 완료'+(r.path?' · '+r.path:'')});
     opts.toast('선택한 위치에 MSDS PDF를 저장했습니다.');
    }
   }else opts.toast(reference?'참고 MSDS를 저장·연결했습니다. 옆의 열기 또는 PDF 다운로드 버튼을 사용하세요.':'MSDS를 저장·연결했습니다. 옆의 열기 또는 PDF 다운로드 버튼을 사용하세요.');
  }catch(e){
   const entry=reportEntry(e,item,source);entry.diagnostic={...(entry.diagnostic||{}),stage:entry.diagnostic?.stage||phase};
   lastDetailErrors.set(opts.itemId,entry);opts.toast(phase+' 실패 — 상세 내용을 확인하세요.',true);showReport([entry],phase+' 실패');
  }finally{
   busy=false;locks();refresh();
   if(opts.getItem(opts.itemId)&&document.getElementById('msds-panel')&&panels.get(opts.element)===opts)
     window.MSDSUI?.mount({...opts,element:document.getElementById('msds-panel')});
  }
 }
 async function sourceOpen(source,toast){try{const r=await window.inventorySafety.source(source.id);if(!r?.ok)throw new Error(r?.error||'제조사 주소를 열지 못했습니다.');}catch(e){toast(safeError(e),true);}}
 async function drawDetail(opts){
  const {element,itemId,getItem,toast}=opts;if(!element?.isConnected)return;
  panels.set(element,opts);const token=(element._safetyToken||0)+1;element._safetyToken=token;
  const live=()=>element.isConnected&&element._safetyToken===token;
  element.hidden=false;element.replaceChildren(E('h4','제조사 검토 SDS (내장 자료)'));
  try{
   const cat=await catalog();if(!live())return;
   if(!cat){element.append(E('p','자료 연결은 설치형 앱에서 사용할 수 있습니다.','hint'));return;}
   const item=getItem(itemId);if(!item)return;
   const entry=state(cat,item),source=C.resolvedSource(cat,item),reference=entry.status==='reference',connectable=entry.status==='ready'||reference;
   element.dataset.safetyStatus=entry.status;
   element.append(E('p',statusText(entry),'hint'));
   const stale=[item.safetyInfo,item.safetyReferenceInfo].filter(i=>i&&i.identity!==C.identity(item));
   if(stale.length)element.append(E('p','품목 정보가 바뀌어 기존 연결 문서를 다시 확인해야 합니다.','hint safety-warning'));
   if(!source){element.replaceChildren();element.hidden=true;return;}
   const actions=E('div',undefined,'msds-actions safety-toolbar');
   if(connectable){
    const receive=button(reference?'참고 MSDS 받기 · 연결':'MSDS 받기 · 연결',()=>one(opts),'primary');receive.id='safety-detail-receive';receive.dataset.safetyReceive='1';
    const open=button('MSDS 열기',()=>one(opts,'open'));open.id='safety-detail-open';open.dataset.safetyReceive='1';
    const save=button('PDF 다운로드',()=>one(opts,'download'));save.id='safety-detail-download';save.dataset.safetyReceive='1';
    actions.append(receive,open,save);
   }
   actions.append(button('제조사 원문 주소 열기',()=>sourceOpen(source,toast)));element.append(actions);locks();
   if(!connectable){element.append(E('p',entry.reason,'hint'));sourceInfo(element,source);return;}
   const fileStatus=E('p','PDF 파일 상태 확인 중…','hint safety-file-status');fileStatus.setAttribute('role','status');element.append(fileStatus);
   element.append(E('p',reference?'같은 물질 참고 SDS 기준 GHS (다른 제품 자료)':'제품번호가 일치하는 제조사 SDS 기준 GHS','safety-reference-note'));
   element.append(E('p',`신호어: ${{Danger:'위험 (Danger)',Warning:'경고 (Warning)',None:'없음 (None)'}[source.ghs.signalWord]||source.ghs.signalWord}`,'safety-signal'));
   const symbols=E('div',undefined,'safety-symbols');symbols.setAttribute('aria-label','GHS 그림문자');element.append(symbols);
   // No history/HTTP request can block the toolbar or the offline pictograms.
   if(!source.ghs.pictograms.length)symbols.append(E('span',source.ghs.notClassifiedHazardous?'이 SDS에서는 GHS 유해물질로 분류하지 않았습니다.':'SDS에 그림문자가 없습니다. 신호어와 위험문구를 확인하세요.','hint'));
   else{
    try{
     const result=await window.inventorySafety.icons(source.ghs.pictograms);if(!live())return;
     for(const code of source.ghs.pictograms){
      const icon=result?.icons?.find(i=>i.code===code),tile=E('div',undefined,'safety-symbol');
      if(/^data:image\/(?:png|svg\+xml);base64,/.test(icon?.dataURI||'')){
       const img=E('img');img.src=icon.dataURI;img.alt=code+' '+LABELS[code];img.width=60;img.height=60;tile.append(img);
      }else tile.append(E('div',code,'safety-symbol-code'));
      tile.append(E('small',LABELS[code]));symbols.append(tile);
     }
     if(!result?.ok||result.icons?.some(i=>!i.dataURI))element.append(E('p','내장 그림 파일을 확인하지 못했습니다. GHS 코드와 원문을 함께 확인하세요.','hint safety-warning'));
    }catch(e){if(live())symbols.append(E('p','그림 표시 실패: '+safeError(e),'hint safety-warning'));}
   }
   if(source.ghs.hCodes.length){
    const details=E('details',undefined,'safety-hazards');details.append(E('summary',`유해·위험 문구 ${source.ghs.hCodes.length}개 · 한국어 요약`));
    const list=E('div');for(const code of source.ghs.hCodes)list.append(E('p',`${code} · ${H[code]||'원문 참조'}${source.ghs.organNotes?.[code]?' — '+source.ghs.organNotes[code]:''}`));details.append(list);element.append(details);
   }
   const more=E('details',undefined,'safety-source-details');more.append(E('summary','자료 출처 · 제품 비교 · 주의사항'));
   sourceInfo(more,source);more.append(E('p',entry.reason,'hint'));
   const comparison=E('div',undefined,'safety-comparison');comparison.append(E('p',`보유 품목: ${item.name||item.nameEn} · CAS ${item.casNo||'미입력'} · 규격 ${item.spec||'미입력'} · 농도 ${item.concentration||'미입력'} · 제조사 ${item.maker||'미입력'}`,'hint'),E('p',`문서의 제품/조성: ${source.productName} · ${source.compositionSummary||'제조사 원문에서 확인하세요.'}`,'hint'));more.append(comparison);
   more.append(E('p','검토한 문서 버전 기준입니다. 한국어 문구는 읽기용 요약입니다.','hint safety-notice'));
   for(const note of entry.notes||[])more.append(E('p',note,'hint'));element.append(more);
   try{
    const doc=await availableDocument(opts,source,reference);if(!live())return;
    const feedback=lastFeedback.get(itemId);
    fileStatus.textContent=feedback&&feedback.identity===C.identity(item)?feedback.text:doc?'PDF 저장·연결됨 · '+doc.fileName:'아직 PDF가 없습니다. 받기·열기·다운로드 중 원하는 작업을 누르세요.';
   }catch(e){if(live())fileStatus.textContent='PDF 상태 확인 실패: '+safeError(e);}
   try{
    const logs=await history();if(!live())return;
    const latest=logs.find(r=>r.sourceId===source.id),failed=lastDetailErrors.get(itemId)||(latest?.ok===false?{...latest,id:itemId,name:item.name}:null);
    if(failed)element.append(failurePanel(failed,source,toast));
   }catch(e){if(live()){const info=E('details');info.append(E('summary','이전 다운로드 기록을 읽지 못했습니다.'),E('p',safeError(e),'hint'));element.append(info);}}
   locks();
  }catch(e){if(live())element.append(E('p','자료 표시 실패: '+safeError(e),'hint safety-warning'));}
 }
 function cleanMaker(item){return item.maker&& !/^(?:nan|null|-)?$/i.test(item.maker.trim());}
 async function bulk(opts,usage='product'){
  if(busy)return;let successes=0,errors=[],warnings=0,unattempted=0,automaticStop=false;const failedSources=new Map();
  try{const cat=await catalog();if(!cat)return;const ids=opts.getItems().filter(r=>C.canConnect(cat,r,usage)).map(r=>r.id);
   if(!ids.length){opts.toast('현재 목록에 자동 연결할 수 있는 품목이 없습니다.');return;}
   if(!networkConfirm(opts.confirm,ids.length,usage))return;busy=true;stop=false;locks();
   for(let i=0;i<ids.length;i++){
    if(stop)break;const item=opts.getItem(ids[i]),source=item?C.resolvedSource(cat,item):null;
    const status=document.getElementById('safety-progress');if(status)status.textContent=`${i+1} / ${ids.length} · ${ids[i]} ${item?.name||''} 자료를 받는 중…`;
    try{const result=await connectOne(opts,ids[i],cat,usage,failedSources);successes++;lastDetailErrors.delete(ids[i]);if(result.icons?.some(icon=>!icon.dataURI))warnings++;}
    catch(e){const entry=reportEntry(e,item||{id:ids[i]},source);errors.push(entry);lastDetailErrors.set(ids[i],entry);
     // Repeated downloads cannot repair a DNS/proxy/certificate failure.
     if(/EAI_AGAIN|ENOTFOUND|NAME_NOT_RESOLVED|PROXY|TUNNEL|CERT|SSL|TLS|INTERNET_DISCONNECTED/.test(e.diagnostic?.code||'')){automaticStop=true;stop=true;break;}}
   }
   unattempted=ids.length-(successes+errors.length);lastBatchResult={successes,errors,warnings,stopped:stop,usage,unattempted,automaticStop};
   opts.toast(`자료 연결 ${successes}개 · 실패 ${errors.length}개${stop?' · 중단됨':''}${errors.length?' — 오류 상세창을 확인하세요.':''}`,errors.length>0);
   if(errors.length)showReport(errors,`MSDS 다운로드 결과: 연결 ${successes}개 · 실패 ${errors.length}개${unattempted?' · 미시도 '+unattempted+'개':''}${automaticStop?' (연결 오류로 중단)':''}`);
  }catch(e){opts.toast(safeError(e),true);showReport([reportEntry(e)],'자료 연결 실행 실패');}
  finally{busy=false;locks();refresh();}
 }
 async function drawSettings(opts){const {element,getItems}=opts;if(!element?.isConnected)return;settingsOpts=opts;const filterState=element.querySelector('#safety-filter')?.value||'all',queryState=element.querySelector('#safety-query')?.value||'';const token=(element._safetyToken||0)+1;element._safetyToken=token;
  try{const cat=await catalog();if(!element.isConnected||element._safetyToken!==token)return;element.replaceChildren(E('h3','제조사 검토 SDS 연결 (내장 자료)'));if(!cat){element.append(E('p','설치형 앱에서 사용할 수 있습니다.','hint'));return;}
   const items=getItems(),counts={ready:0,reference:0,composition:0,review:0,unresolved:0};for(const r of items)counts[state(cat,r).status]++;
   element.append(E('p',`현재 ${items.length}개 품목 · 제품번호 일치 ${counts.ready}개 · 참고자료 연결 가능 ${counts.reference}개 · 조성 확인 필요 ${counts.composition}개 · 제품 정보 확인 필요 ${counts.review}개 · 미확인 ${counts.unresolved}개`,'settings-desc'));
   element.append(E('p',`확인 기준 ${cat.reviewedAt}. 제품번호가 일치하는 자료와 같은 물질 참고자료를 구분해 연결합니다. MSDS를 받는 더 쉬운 방법은 왼쪽 'MSDS 관리'의 KOSHA 일괄 받기입니다.`,'hint'));
   const actions=E('div',undefined,'settings-actions'),receive=button('확인된 제조사 자료 받기',()=>bulk(opts),'primary');receive.id='safety-bulk-receive';receive.dataset.safetyReceive='1';const stopButton=button('현재 파일 후 중단',()=>{stop=true;stopButton.disabled=true;});stopButton.id='safety-stop';stopButton.hidden=!busy;
   const referenceButton=button('참고 MSDS 받기',()=>bulk(opts,'reference'));referenceButton.id='safety-bulk-reference';referenceButton.dataset.safetyReceive='1';const historyButton=button('최근 다운로드 결과',()=>showHistory(opts.toast));historyButton.id='safety-download-history';actions.append(receive,referenceButton,stopButton,button('문서 폴더 열기',async()=>{try{const r=await window.inventoryMSDS.folder();if(!r?.ok)throw new Error(r?.error||'문서 폴더 열기 실패');}catch(e){opts.toast(safeError(e),true);}}),button('목록 새로고침',()=>drawSettings(opts)),historyButton);element.append(actions);
   const progress=E('p','받은 PDF는 문서 폴더에 저장되고 품목에 연결됩니다.','hint');progress.id='safety-progress';progress.setAttribute('role','status');element.append(progress);
   if(lastBatchResult){const result=lastBatchResult;progress.textContent=`직전 실행 (${result.usage==='reference'?'참고용':'제품번호 일치'}): PDF 연결 ${result.successes}개 / 실패 ${result.errors.length}개 / 그림문자 미완료 ${result.warnings}개${result.stopped?' / 중단됨':''}${result.unattempted?' / 미시도 '+result.unattempted+'개':''}`;if(result.errors.length){const errors=E('details');errors.open=false;errors.append(E('summary','실패 내역 보기'));for(const error of result.errors)errors.append(E('pre',entryText(error),'hint safety-warning'));element.append(errors);}}
   try{const logs=await history();if(!element.isConnected||element._safetyToken!==token)return;const latest=new Map();for(const row of logs)if(!latest.has(row.sourceId))latest.set(row.sourceId,row);const failed=[...latest.values()].filter(row=>!row.ok);
    if(failed.length){const area=E('details',undefined,'safety-download-failure');area.id='safety-persistent-errors';area.append(E('summary',`최근 다운로드에서 실패한 문서 ${failed.length}개`),E('p','아래 기록은 프로그램을 닫았다 열어도 남습니다. 같은 문서의 최신 수신 결과를 기준으로 표시합니다.','hint'));
     for(const row of failed.slice(0,3))area.append(E('p',(row.sourceName||row.sourceId)+' · '+(row.diagnostic?.message||'다운로드 실패')+' ['+(row.diagnostic?.code||'UNKNOWN')+']','hint safety-warning'));
     area.append(button('저장된 오류 상세 보기',()=>showReport(failed)));element.append(area);}
   }catch(e){element.append(E('p','다운로드 기록 확인 실패: '+safeError(e),'hint safety-warning'));}
   element.append(E('p','제조사 영문 SDS 기준 참고 표시입니다. 국내 공급자 MSDS가 있으면 그쪽을 우선하세요.','hint safety-notice'));
   const controls=E('div',undefined,'safety-controls'),input=E('input');input.id='safety-query';input.type='search';input.placeholder='품목명 / ID / 제품번호';input.setAttribute('aria-label','MSDS 연결 목록 검색');input.value=queryState;
   const select=E('select');select.id='safety-filter';select.setAttribute('aria-label','MSDS 자료 확인 상태');for(const [v,t]of [['all','전체'],['ready','제품번호 일치'],['reference','동일 물질 참고 MSDS'],['composition','조성 확인 필요'],['review','제품 정보 확인 필요'],['unresolved','미확인']]){const option=E('option',t);option.value=v;select.append(option);}select.value=filterState;controls.append(input,select);element.append(controls);
   const tableWrap=E('div',undefined,'safety-table-wrap'),table=E('table',undefined,'safety-table');table.append(E('caption','제품별 MSDS 연결 검토 결과'));const head=E('thead'),tr=E('tr');for(const t of ['품목','제품번호','상태 / 확인 내용','자료'])tr.append(E('th',t));head.append(tr);const body=E('tbody');table.append(head,body);tableWrap.append(table);element.append(tableWrap);
   function rows(){const q=input.value.trim().toLowerCase();body.replaceChildren();for(const r of getItems()){const entry=state(cat,r);if(select.value!=='all'&&entry.status!==select.value)continue;if(q&&![r.id,r.name,r.nameEn,r.serialNo].join(' ').toLowerCase().includes(q))continue;const row=E('tr'),name=E('td');name.append(button(r.id+' · '+(r.name||r.nameEn||''),()=>opts.openItem(r.id)));const code=E('td',r.serialNo||'미입력'),status=E('td');status.append(E('strong',statusText(entry)),E('p',entry.reason,'hint'));const docs=E('td'),source=C.resolvedSource(cat,r);if(source)docs.append(button(entry.status==='ready'?'제품 원문':entry.status==='reference'?'참고 원문':'후보 원문',()=>sourceOpen(source,opts.toast)));else docs.textContent='—';row.append(name,code,status,docs);body.append(row);}if(!body.children.length){const row=E('tr'),td=E('td','해당 항목이 없습니다.');td.colSpan=4;row.append(td);body.append(row);}}
   input.oninput=rows;select.onchange=rows;rows();locks();
  }catch(e){element.replaceChildren(E('h3','제조사 검토 SDS 연결 (내장 자료)'),E('p','목록 확인 실패: '+safeError(e),'hint safety-warning'));}
 }
 async function suggestion(item){const cat=await catalog();if(!cat||!item)return null;const entry=state(cat,item),source=C.resolvedSource(cat,item);if(!source||!(entry.status==='ready'||entry.status==='reference'))return null;return {status:entry.status,source};}
 window.InventorySafetyUI={mountDetail:drawDetail,mountSettings:drawSettings,isBusy:()=>busy,refresh,suggestion};
})();
