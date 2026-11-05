'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {safeURL,download}=require('./safety-network');
const {errorInfo,failure}=require('./safety-errors');
const {MAX_BYTES}=require('./msds-store');
const COMMON=require('./safety-common');
const {bundledIcon}=require('./safety-icons');
const SYMBOLS={GHS01:'폭발성',GHS02:'인화성 등',GHS03:'산화성',GHS04:'고압가스',GHS05:'부식성',GHS06:'급성독성',GHS07:'유해·자극성 등',GHS08:'건강 유해성',GHS09:'환경 유해성'};
const SVG_HOST='pubchem.ncbi.nlm.nih.gov';
function plainSVG(bytes){const text=bytes.toString('utf8');if(!/<svg[\s>]/i.test(text)||/<(?:script|foreignObject|iframe|object|embed)\b|\son[a-z]+\s*=|(?:href|src)\s*=\s*['"]\s*(?:https?:|\/\/|data:)|<!ENTITY|<!DOCTYPE|@import|url\s*\(/i.test(text))throw new Error('그림문자 파일 형식을 확인할 수 없습니다.');return text;}
function createSafetyStore({dataDir,msds,catalog,fetchBytes=download}){
 for(const source of catalog.sources){
  if(!/^[a-z0-9-]{1,80}$/.test(source.id)||!/^[-a-zA-Z0-9_ .]+\.pdf$/.test(source.fileName))throw new Error('안전자료 목록의 파일명이 잘못되었습니다.');
  safeURL(source.pdfURL,new Set(source.allowedHosts||[new URL(source.pdfURL).hostname]));
  if((source.ghs?.pictograms||[]).some(code=>!Object.hasOwn(SYMBOLS,code)))throw new Error('안전자료 목록의 그림문자가 잘못되었습니다.');
 }
 const sources=new Map(catalog.sources.map(s=>[s.id,s]));if(sources.size!==catalog.sources.length)throw new Error('안전자료 식별자 중복');const inFlight=new Map(),iconFlight=new Map();
 const cacheDir=()=>{const p=path.join(dataDir(),'safety');fs.mkdirSync(p,{recursive:true});if(fs.lstatSync(p).isSymbolicLink())throw new Error('안전자료 저장 폴더가 잘못되었습니다.');return p;};
 function getSource(id){if(typeof id!=='string'||!sources.has(id))throw new Error('등록된 제조사 자료가 아닙니다.');return sources.get(id);}
 function regularRead(file){const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink())throw new Error('일반 파일이 아닙니다.');return fs.readFileSync(file);}
 function cached(id){getSource(id);try{const doc=JSON.parse(regularRead(path.join(cacheDir(),id+'.json')));return doc.sourceId===id&&doc.sourceURL===getSource(id).pdfURL&&msds.list([doc]).files[0]?.available?doc:null;}catch{return null;}}
 function atomic(file,bytes){const p=file+'.tmp-'+crypto.randomBytes(6).toString('hex');try{fs.writeFileSync(p,bytes,{flag:'wx',mode:0o600});fs.renameSync(p,file);}finally{try{fs.unlinkSync(p);}catch{}}}
 async function icon(code,online=false){
  if(!Object.hasOwn(SYMBOLS,code))throw new Error('지원하지 않는 그림문자입니다.');
  // The old online argument is retained for API compatibility, but never used.
  return {code,label:SYMBOLS[code],dataURI:bundledIcon(code),bundled:true};
 }
 async function icons(codes,online=false){if(!Array.isArray(codes)||codes.length>9)throw new Error('그림문자 요청이 잘못되었습니다.');return Promise.all([...new Set(codes)].map(async code=>{try{return await icon(code,online);}catch(e){return {code,label:SYMBOLS[code]||code,dataURI:null,error:errorInfo(e).message,diagnostic:errorInfo(e)};}}));}
 function history(){
  const file=path.join(cacheDir(),'download-history.json');if(!fs.existsSync(file))return [];
  const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)throw new Error('다운로드 기록 파일이 올바르지 않습니다.');
  const rows=JSON.parse(regularRead(file));if(!Array.isArray(rows))throw new Error('다운로드 기록 형식이 올바르지 않습니다.');
  return rows.filter(r=>r&&sources.has(r.sourceId)&&typeof r.ok==='boolean').slice(0,50);
 }
 function record(row){
  try{const rows=[row,...history()].slice(0,50);let content=JSON.stringify(rows,null,2);while(Buffer.byteLength(content)>900000&&rows.length>1){rows.pop();content=JSON.stringify(rows,null,2);}atomic(path.join(cacheDir(),'download-history.json'),content);return null;}
  catch(e){return errorInfo(e,{stage:'다운로드 기록 저장'});}
 }
 async function receive(id){const source=getSource(id);if(inFlight.has(id))return inFlight.get(id);
 let stage='캐시 확인';
 const promise=(async()=>{
  try{
   const old=cached(id);let result;
   if(old)result={ok:true,document:old,source,cached:true,icons:await icons(source.ghs?.pictograms||[],true)};
   else{
    const hosts=new Set(source.allowedHosts||[new URL(source.pdfURL).hostname]);safeURL(source.pdfURL,hosts);
    stage='파일 다운로드';const bytes=await fetchBytes(source.pdfURL,{hosts,maxBytes:MAX_BYTES});
    stage='PDF 형식 검사';if(!Buffer.isBuffer(bytes)||bytes.length<8||bytes.length>MAX_BYTES||!/^%PDF-\d\.\d/.test(bytes.subarray(0,8).toString('ascii')))
      throw failure('INVALID_PDF','서버가 PDF 대신 로그인·오류 페이지를 반환했습니다. 문서를 연결하지 않았습니다.',{...bytes?.downloadInfo,stage,url:source.pdfURL});
    stage='MSDS 사본 저장';const temp=path.join(cacheDir(),source.id+'-'+crypto.randomBytes(5).toString('hex')+'.pdf');let document;
    try{fs.writeFileSync(temp,bytes,{flag:'wx',mode:0o600});const r=msds.importFiles([temp]);if(!r.documents?.length)throw failure(r.errors?.[0]?.code||'SAVE_FAILED',r.errors?.[0]?.error||'MSDS 사본 저장 실패',{stage});
     document={...r.documents[0],fileName:source.fileName,sourceURL:source.pdfURL,sourceId:source.id,sourcePublisher:source.publisher,reviewedRevision:source.revision,reviewedAt:catalog.reviewedAt};
     if(!msds.list([document]).files[0]?.available)throw failure('VERIFY_FAILED','저장한 MSDS 파일을 다시 확인하지 못했습니다.',{stage:'저장 파일 검사'});
     atomic(path.join(cacheDir(),id+'.json'),JSON.stringify(document,null,2));
    }finally{try{fs.unlinkSync(temp);}catch{}}
    stage='그림문자 수신';result={ok:true,document,source,cached:false,icons:await icons(source.ghs?.pictograms||[],true)};
   }
   const row={at:new Date().toISOString(),sourceId:id,sourceName:source.productName,fileName:source.fileName,url:source.pdfURL,ok:true,cached:result.cached,stage:'PDF 사본 저장 완료',warningCount:result.icons.filter(i=>!i.dataURI).length,
    warnings:result.icons.filter(i=>!i.dataURI).map(i=>({code:i.code,error:i.error||'그림문자 파일 없음',diagnostic:i.diagnostic}))};
   result.diagnosticRecord=row;const warning=record(row);if(warning)result.historyWarning=warning;
   return result;
  }catch(e){
   if(!(e instanceof Error))e=new Error(String(e));
   e.diagnostic=errorInfo(e,{stage,url:source.pdfURL});
   e.diagnosticRecord={at:new Date().toISOString(),sourceId:id,sourceName:source.productName,fileName:source.fileName,url:source.pdfURL,ok:false,diagnostic:e.diagnostic};
   const warning=record(e.diagnosticRecord);if(warning)e.historyWarning=warning;throw e;
  }
 })();inFlight.set(id,promise);try{return await promise;}finally{inFlight.delete(id);}
 }
 return {catalog:()=>catalog,getSource,cached,receive,icons,history,clear:()=>{if(inFlight.size||iconFlight.size)throw new Error('MSDS 다운로드가 끝난 뒤 초기화해주세요.');fs.rmSync(cacheDir(),{recursive:true,force:true});},busy:()=>inFlight.size>0||iconFlight.size>0};
}
module.exports={createSafetyStore,download,safeURL,plainSVG,SYMBOLS};
