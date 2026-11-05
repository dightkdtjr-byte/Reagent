'use strict';
const path=require('path'),{fileURLToPath}=require('url');
const {errorInfo}=require('./safety-errors');
// 외부 검색 페이지. 주소 틀은 고정이며 렌더러는 종류와 검색어만 보낸다.
const LOOKUPS={
 kosha:{url:()=>'https://msds.kosha.or.kr/MSDSInfo/kcic/msdssearchMain.do',copy:true},
 pubchem:{url:q=>'https://pubchem.ncbi.nlm.nih.gov/#query='+encodeURIComponent(q),copy:false},
 echa:{url:q=>'https://echa.europa.eu/search-for-chemicals?p_p_id=disssimplesearch_WAR_disssearchportlet&p_p_lifecycle=0&_disssimplesearch_WAR_disssearchportlet_searchOccurred=true&_disssimplesearch_WAR_disssearchportlet_sskeywordKey='+encodeURIComponent(q),copy:false}
};
function registerSafetyHandlers({ipcMain,shell,clipboard,store,documentPath}){
 function trusted(event){try{const frame=event.senderFrame;if(frame&&event.sender?.mainFrame&&frame!==event.sender.mainFrame)return false;return path.resolve(fileURLToPath(frame?.url||event.sender?.getURL?.()))===path.resolve(documentPath);}catch{return false;}}
 function handle(name,fn){ipcMain.handle('inventory-safety:'+name,async(event,...args)=>{if(!trusted(event))return {ok:false,error:'허용되지 않은 안전자료 요청입니다.'};try{return await fn(...args);}catch(e){const diagnostic=errorInfo(e);return {ok:false,error:diagnostic.message,diagnostic,record:e.diagnosticRecord||null,historyWarning:e.historyWarning||null};}});}
 handle('catalog',()=>({ok:true,catalog:store.catalog()}));
 handle('receive',id=>store.receive(id));
 handle('history',()=>({ok:true,entries:store.history()}));
 handle('copy',text=>{if(typeof text!=='string'||text.length>100000)throw new Error('복사할 오류 내용이 올바르지 않습니다.');if(!clipboard?.writeText)throw new Error('클립보드를 사용할 수 없습니다.');clipboard.writeText(text);return {ok:true};});
 handle('icons',codes=>store.icons(codes,false).then(icons=>({ok:true,icons})));
 handle('lookup',async(kind,query)=>{
  const def=LOOKUPS[kind];if(!def)throw new Error('지원하지 않는 검색 종류입니다.');
  const q=String(query||'').normalize('NFKC').trim().slice(0,120);if(!q)throw new Error('CAS 번호 또는 품명이 없어 검색할 수 없습니다.');
  if(/[\x00-\x1f<>"]/.test(q))throw new Error('검색어에 사용할 수 없는 문자가 있습니다.');
  let copied=false;if(def.copy&&clipboard?.writeText){clipboard.writeText(q);copied=true;}
  await shell.openExternal(def.url(q));return {ok:true,copied};
 });
 handle('source',async id=>{const s=store.getSource(id);await shell.openExternal(s.pdfURL);return {ok:true};});
}
module.exports={registerSafetyHandlers};
