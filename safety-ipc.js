'use strict';
const path=require('path'),{fileURLToPath}=require('url');
const {errorInfo}=require('./safety-errors');
function registerSafetyHandlers({ipcMain,shell,clipboard,store,documentPath}){
 function trusted(event){try{const frame=event.senderFrame;if(frame&&event.sender?.mainFrame&&frame!==event.sender.mainFrame)return false;return path.resolve(fileURLToPath(frame?.url||event.sender?.getURL?.()))===path.resolve(documentPath);}catch{return false;}}
 function handle(name,fn){ipcMain.handle('inventory-safety:'+name,async(event,...args)=>{if(!trusted(event))return {ok:false,error:'허용되지 않은 안전자료 요청입니다.'};try{return await fn(...args);}catch(e){const diagnostic=errorInfo(e);return {ok:false,error:diagnostic.message,diagnostic,record:e.diagnosticRecord||null,historyWarning:e.historyWarning||null};}});}
 handle('catalog',()=>({ok:true,catalog:store.catalog()}));
 handle('receive',id=>store.receive(id));
 handle('history',()=>({ok:true,entries:store.history()}));
 handle('copy',text=>{if(typeof text!=='string'||text.length>100000)throw new Error('복사할 오류 내용이 올바르지 않습니다.');if(!clipboard?.writeText)throw new Error('클립보드를 사용할 수 없습니다.');clipboard.writeText(text);return {ok:true};});
 handle('icons',codes=>store.icons(codes,false).then(icons=>({ok:true,icons})));
 handle('source',async id=>{const s=store.getSource(id);await shell.openExternal(s.pdfURL);return {ok:true};});
}
module.exports={registerSafetyHandlers};
