'use strict';
// Fixed, unmodified GHS pictograms. No HTTP call or writable user directory is needed.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const manifest=require('./safety-icons.json');
const cache=new Map();
function bundledIcon(code){
 const entry=typeof code==='string'&&Object.hasOwn(manifest,code)?manifest[code]:null;if(!entry)throw new Error('지원하지 않는 GHS 그림문자입니다.');
 if(cache.has(code))return cache.get(code);
 const file=path.join(__dirname,'assets','ghs',entry.fileName),stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==entry.size)throw new Error('내장 GHS 그림 파일을 확인할 수 없습니다.');
 const bytes=fs.readFileSync(file);
 if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||crypto.createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw new Error('내장 GHS 그림 파일의 무결성 검사에 실패했습니다.');
 const dataURI='data:image/png;base64,'+bytes.toString('base64');cache.set(code,dataURI);return dataURI;
}
module.exports={bundledIcon,manifest};
