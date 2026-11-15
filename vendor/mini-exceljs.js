(function(g){
'use strict';
const TE=new TextEncoder(), TD=new TextDecoder('utf-8');
function esc(s){return String(s??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
function unesc(s){return String(s??'').replace(/&#x([0-9a-f]+);/gi,(m,h)=>{try{return String.fromCodePoint(parseInt(h,16));}catch{return m;}}).replace(/&#(\d+);/g,(m,d)=>{try{return String.fromCodePoint(Number(d));}catch{return m;}}).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');}
function colName(n){let s='';while(n>0){let r=(n-1)%26;s=String.fromCharCode(65+r)+s;n=Math.floor((n-1)/26);}return s;}
function cellRC(ref){const m=/^([A-Z]+)(\d+)$/i.exec(ref);if(!m)return [1,1];let c=0;for(const ch of m[1].toUpperCase())c=c*26+ch.charCodeAt(0)-64;return [Number(m[2]),c];}
function flatten(v){if(v==null)return '';if(v instanceof Date)return v;if(typeof v==='object'&&Array.isArray(v.richText))return v.richText.map(x=>x.text||'').join('');if(typeof v==='object'&&v.text!=null)return String(v.text);return v;}
class Cell{constructor(row,col){this.row=row;this.col=col;this.value=null;this.font={};this.fill={};this.alignment={};this.border={};this.numFmt='';}}
class Row{constructor(ws,n){this.ws=ws;this.number=n;this.cells=new Map();this.height=null;}
 getCell(c){c=typeof c==='string'?cellRC(c)[1]:Number(c);if(!this.cells.has(c))this.cells.set(c,new Cell(this.number,c));return this.cells.get(c);}
 set values(arr){this.cells.clear();if(!Array.isArray(arr))return;let start=(arr.length>0&&arr[0]===undefined)?1:0;for(let i=start;i<arr.length;i++){if(arr[i]!==undefined&&arr[i]!==null)this.getCell(i-start+1).value=arr[i];}}
 get values(){let m=Math.max(0,...this.cells.keys());let a=new Array(m+1);for(const [c,x] of this.cells)a[c]=x.value;return a;}
 eachCell(a,b){let opt={},cb;if(typeof a==='function')cb=a;else{opt=a||{};cb=b;}let max=Math.max(0,...this.cells.keys());for(let c=1;c<=max;c++){let cell=this.cells.get(c);if(!cell&&opt.includeEmpty)cell=this.getCell(c);if(cell&&cb)cb(cell,c);}}
}
class Worksheet{constructor(name,opts){this.name=name;this.options=opts||{};this.rows=new Map();this.columns=new Map();this.merges=[];this.views=(opts&&opts.views)||[];this.pageSetup=(opts&&opts.pageSetup)||{};this.headerFooter={};this.autoFilter=null;this.properties=(opts&&opts.properties)||{};this.images=[];}
 getRow(r){r=Number(r);if(!this.rows.has(r))this.rows.set(r,new Row(this,r));return this.rows.get(r);}
 getCell(a,b){if(b!==undefined)return this.getRow(Number(a)).getCell(Number(b));const [r,c]=cellRC(String(a));return this.getRow(r).getCell(c);}
 getColumn(c){c=typeof c==='string'?cellRC(c+'1')[1]:Number(c);if(!this.columns.has(c))this.columns.set(c,{number:c,width:null,numFmt:''});return this.columns.get(c);}
 mergeCells(){let args=[...arguments],range;if(args.length===1)range=String(args[0]);else range=colName(args[1])+args[0]+':'+colName(args[3])+args[2];this.merges.push(range);}
 addImage(imageId,range){this.images.push({imageId:Number(imageId),range:range||{}});return imageId;}
 eachRow(opts,cb){if(typeof opts==='function'){cb=opts;opts={};}opts=opts||{};let max=0;for(const k of this.rows.keys())if(k>max)max=k;for(let r=1;r<=max;r++){let row=this.rows.get(r);if(!row){if(opts.includeEmpty)row=this.getRow(r);else continue;}if(!opts.includeEmpty&&row.cells.size===0)continue;cb(row,r);}}
}
class Workbook{constructor(){this.worksheets=[];this.creator='';this.created=new Date();this.images=[];this.xlsx={writeBuffer:()=>writeWorkbook(this),load:(buf)=>loadWorkbook(this,buf)};}
 addWorksheet(name,opts){let n=String(name||'Sheet').replace(/[\\\/\?\*\[\]:]/g,' ').replace(/^'+|'+$/g,'').slice(0,31)||'Sheet';const used=new Set(this.worksheets.map(x=>x.name.toLowerCase()));let base=n,k=2;while(used.has(n.toLowerCase())){const suf=' ('+(k++)+')';n=base.slice(0,31-suf.length)+suf;}const w=new Worksheet(n,opts);this.worksheets.push(w);return w;}
 addImage(img){this.images.push(img||{});return this.images.length;}
}
function argb(v,def){const x=v&&typeof v==='object'?(v.argb||v.rgb||''):v;let t=String(x||def||'').replace(/^#/,'').toUpperCase();if(t.length===6)t='FF'+t;return /^[0-9A-F]{8}$/.test(t)?t:(def||'FF000000');}
function normFont(f){f=f||{};return {name:f.name||'Calibri',size:Number(f.size)||11,bold:!!f.bold,italic:!!f.italic,underline:!!f.underline,color:argb(f.color,'FF000000')};}
function normFill(f){f=f||{};if(f.pattern==='solid'||(f.type==='pattern'&&f.fgColor))return {pattern:'solid',fg:argb(f.fgColor,'FFFFFFFF'),bg:argb(f.bgColor,'FFFFFFFF')};return {pattern:'none'};}
const BORDER_STYLES=new Set(['thin','medium','dashed','dotted','thick','double','hair','mediumDashed','dashDot','mediumDashDot','dashDotDot','mediumDashDotDot','slantDashDot']);
const V_ALIGN=new Set(['top','center','bottom','justify','distributed']), H_ALIGN=new Set(['general','left','center','right','fill','justify','centerContinuous','distributed']);
function normSide(x){x=x||{};return x.style&&BORDER_STYLES.has(String(x.style))?{style:String(x.style),color:argb(x.color,'FFD9D9D9')}:{style:''};}
function normBorder(b){b=b||{};return {left:normSide(b.left),right:normSide(b.right),top:normSide(b.top),bottom:normSide(b.bottom)};}
function normAlign(a){a=a||{};const v=a.vertical==='middle'?'center':a.vertical;return {horizontal:H_ALIGN.has(a.horizontal)?a.horizontal:'',vertical:V_ALIGN.has(v)?v:'',wrapText:!!a.wrapText,indent:Math.max(0,Math.floor(Number(a.indent)||0))};}
function dateFmtFor(d){return (d.getHours()||d.getMinutes()||d.getSeconds())?'yyyy-mm-dd hh:mm':'yyyy-mm-dd';}
function dateSerial(d){return (Date.UTC(d.getFullYear(),d.getMonth(),d.getDate(),d.getHours(),d.getMinutes(),d.getSeconds())-Date.UTC(1899,11,30))/86400000;}
function validDate(v){return v instanceof Date&&!Number.isNaN(v.getTime())&&v.getFullYear()<=9999&&v.getTime()>=new Date(1900,2,1).getTime();}
function key(o){return JSON.stringify(o);}
function xmlFont(f){return `<font><name val="${esc(f.name)}"/>${f.bold?'<b/>':''}${f.italic?'<i/>':''}<color rgb="${f.color}"/><sz val="${f.size}"/>${f.underline?'<u/>':''}</font>`;}
function xmlFill(f){if(f.pattern==='solid')return `<fill><patternFill patternType="solid"><fgColor rgb="${f.fg}"/><bgColor rgb="${f.bg}"/></patternFill></fill>`;return '<fill><patternFill patternType="none"/></fill>';}
function xmlSide(tag,s){return s&&s.style?`<${tag} style="${esc(s.style)}"><color rgb="${s.color}"/></${tag}>`:`<${tag}/>`;}
function xmlBorder(b){return `<border>${xmlSide('left',b.left)}${xmlSide('right',b.right)}${xmlSide('top',b.top)}${xmlSide('bottom',b.bottom)}<diagonal/></border>`;}
function buildStyles(wb){
  const fonts=[normFont({})], fills=[{pattern:'none'},{pattern:'gray125'}], borders=[normBorder({})], numFmts=[], xfs=[{fontId:0,fillId:0,borderId:0,numFmtId:0,align:normAlign({})}];
  const fm=new Map([[key(fonts[0]),0]]), fim=new Map([[key(fills[0]),0],[key(fills[1]),1]]), bm=new Map([[key(borders[0]),0]]), nm=new Map(), xm=new Map([[key(xfs[0]),0]]), styleMap=new Map();
  let nextNumFmt=164;
  function getFont(f){const n=normFont(f),k=key(n);if(!fm.has(k)){fm.set(k,fonts.length);fonts.push(n);}return fm.get(k);}
  function getFill(f){const n=normFill(f),k=key(n);if(!fim.has(k)){fim.set(k,fills.length);fills.push(n);}return fim.get(k);}
  function getBorder(b){const n=normBorder(b),k=key(n);if(!bm.has(k)){bm.set(k,borders.length);borders.push(n);}return bm.get(k);}
  function getNumFmt(fmt){fmt=String(fmt||'');if(!fmt||fmt==='General')return 0;if(fmt==='#,##0')return 3;if(fmt==='@')return 49;if(!nm.has(fmt)){nm.set(fmt,nextNumFmt++);numFmts.push([nm.get(fmt),fmt]);}return nm.get(fmt);}
  function getStyle(c){const o={fontId:getFont(c.font),fillId:getFill(c.fill),borderId:getBorder(c.border),numFmtId:getNumFmt(c.numFmt||(validDate(c.value)?dateFmtFor(c.value):'')),align:normAlign(c.alignment)};const k=key(o);if(!xm.has(k)){xm.set(k,xfs.length);xfs.push(o);}return xm.get(k);}
  for(const ws of wb.worksheets){for(const row of ws.rows.values())for(const cell of row.cells.values())styleMap.set(cell,getStyle(cell));for(const col of ws.columns.values())if(col.numFmt)styleMap.set(col,getStyle({numFmt:col.numFmt}));}
  const numXml=numFmts.length?`<numFmts count="${numFmts.length}">${numFmts.map(([id,fmt])=>`<numFmt numFmtId="${id}" formatCode="${esc(fmt)}"/>`).join('')}</numFmts>`:'';
  const xfsXml=xfs.map(x=>{const a=x.align||{},attrs=[`numFmtId="${x.numFmtId}"`,`fontId="${x.fontId}"`,`fillId="${x.fillId}"`,`borderId="${x.borderId}"`,`xfId="0"`];if(x.fontId)attrs.push('applyFont="1"');if(x.fillId)attrs.push('applyFill="1"');if(x.borderId)attrs.push('applyBorder="1"');if(x.numFmtId)attrs.push('applyNumberFormat="1"');const hasA=a.horizontal||a.vertical||a.wrapText||a.indent;if(hasA)attrs.push('applyAlignment="1"');let ax='';if(hasA){let aa='';if(a.horizontal)aa+=` horizontal="${esc(a.horizontal)}"`;if(a.vertical)aa+=` vertical="${esc(a.vertical)}"`;if(a.wrapText)aa+=' wrapText="1"';if(a.indent)aa+=` indent="${a.indent}"`;ax=`<alignment${aa}/>`;}return `<xf ${attrs.join(' ')}>${ax}</xf>`;}).join('');
  const xml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${numXml}<fonts count="${fonts.length}">${fonts.map(xmlFont).join('')}</fonts><fills count="${fills.length}">${fills.map((f,i)=>i===1?'<fill><patternFill patternType="gray125"/></fill>':xmlFill(f)).join('')}</fills><borders count="${borders.length}">${borders.map(xmlBorder).join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfsXml}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return {xml,styleMap};
}
function runFontPr(f){f=normFont(f);return `<rPr><rFont val="${esc(f.name)}"/>${f.bold?'<b/>':''}${f.italic?'<i/>':''}<color rgb="${f.color}"/><sz val="${f.size}"/>${f.underline?'<u/>':''}</rPr>`;}
function inlineStrXml(v){if(v&&typeof v==='object'&&Array.isArray(v.richText)){return '<is>'+v.richText.map(x=>`<r>${runFontPr(x.font||{})}<t xml:space="preserve">${esc(x.text||'')}</t></r>`).join('')+'</is>';}return `<is><t xml:space="preserve">${esc(v)}</t></is>`;}
function worksheetXml(ws,styleMap,drawingRid){
  let maxRow=1;for(const k of ws.rows.keys())if(k>maxRow)maxRow=k;let maxCol=Math.max(1,...ws.columns.keys());for(const row of ws.rows.values())for(const c of row.cells.keys())maxCol=Math.max(maxCol,c);
  const tc=ws.properties&&ws.properties.tabColor&&argb(ws.properties.tabColor.argb||ws.properties.tabColor,'');
  const fit=ws.pageSetup&&ws.pageSetup.fitToPage;
  const sheetPr=(tc||fit)?`<sheetPr>${tc?`<tabColor rgb="${tc}"/>`:''}${fit?'<pageSetUpPr fitToPage="1"/>':''}</sheetPr>`:'';
  let cols='';if(ws.columns.size){let arr=[...ws.columns.entries()].filter(x=>x[1].width||styleMap.get(x[1])).sort((a,b)=>a[0]-b[0]);if(arr.length)cols='<cols>'+arr.map(([c,o])=>{const sid=styleMap.get(o);return `<col min="${c}" max="${c}" width="${Number(o.width)||9}"${sid?` style="${sid}"`:''}${o.width?' customWidth="1"':''}/>`;}).join('')+'</cols>';}
  let views='<sheetViews><sheetView workbookViewId="0"';if(ws.views&&ws.views[0]&&ws.views[0].state==='frozen'&&ws.views[0].ySplit){const y=ws.views[0].ySplit;views+=`><pane ySplit="${y}" topLeftCell="A${y+1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`;}else views+='/></sheetViews>';
  let rows='';for(let r=1;r<=maxRow;r++){const row=ws.rows.get(r);if(!row)continue;let cells='';for(const [c,cell] of [...row.cells.entries()].sort((a,b)=>a[0]-b[0])){let v=cell.value;const ref=colName(c)+r,sid=styleMap.get(cell)||0,sa=sid?` s="${sid}"`:'';if(v===null||v===undefined||v===''){if(sid)cells+=`<c r="${ref}"${sa}/>`;continue;}if(typeof v==='number'&&Number.isFinite(v))cells+=`<c r="${ref}"${sa}><v>${v}</v></c>`;else if(typeof v==='boolean')cells+=`<c r="${ref}"${sa} t="b"><v>${v?1:0}</v></c>`;else if(validDate(v))cells+=`<c r="${ref}"${sa}><v>${dateSerial(v)}</v></c>`;else{if(v instanceof Date)v=Number.isNaN(v.getTime())?'':`${String(v.getFullYear()).padStart(4,'0')}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}`;cells+=`<c r="${ref}"${sa} t="inlineStr">${inlineStrXml(v)}</c>`;}}if(cells||row.height)rows+=`<row r="${r}"${row.height?` ht="${row.height}" customHeight="1"`:''}>${cells}</row>`;}
  const merges=ws.merges.length?`<mergeCells count="${ws.merges.length}">${ws.merges.map(x=>`<mergeCell ref="${esc(x)}"/>`).join('')}</mergeCells>`:'';
  let af='';if(ws.autoFilter){if(typeof ws.autoFilter==='string')af=`<autoFilter ref="${esc(ws.autoFilter)}"/>`;else if(ws.autoFilter.from&&ws.autoFilter.to)af=`<autoFilter ref="${esc(ws.autoFilter.from+':'+ws.autoFilter.to)}"/>`;}
  const ps=ws.pageSetup||{};const margins=ps.margins||{left:.4,right:.4,top:.5,bottom:.5,header:.2,footer:.2};
  const printOptions=ps.horizontalCentered?'<printOptions horizontalCentered="1"/>':'';
  const pageMargins=`<pageMargins left="${margins.left??.4}" right="${margins.right??.4}" top="${margins.top??.5}" bottom="${margins.bottom??.5}" header="${margins.header??.2}" footer="${margins.footer??.2}"/>`;
  let pageSetup='';if(ps.paperSize||ps.orientation||ps.fitToWidth!=null||ps.fitToHeight!=null){pageSetup='<pageSetup';if(ps.paperSize)pageSetup+=` paperSize="${ps.paperSize}"`;if(ps.orientation)pageSetup+=` orientation="${esc(ps.orientation)}"`;if(ps.fitToWidth!=null)pageSetup+=` fitToWidth="${ps.fitToWidth}"`;if(ps.fitToHeight!=null)pageSetup+=` fitToHeight="${ps.fitToHeight}"`;if(ps.pageOrder==='overThenDown')pageSetup+=' pageOrder="overThenDown"';pageSetup+='/>';}
  let hf='';if(ws.headerFooter&&(ws.headerFooter.oddFooter||ws.headerFooter.oddHeader))hf=`<headerFooter>${ws.headerFooter.oddHeader?`<oddHeader>${esc(ws.headerFooter.oddHeader)}</oddHeader>`:''}${ws.headerFooter.oddFooter?`<oddFooter>${esc(ws.headerFooter.oddFooter)}</oddFooter>`:''}</headerFooter>`;
  const drawing=drawingRid?`<drawing r:id="${drawingRid}"/>`:'';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${sheetPr}<dimension ref="A1:${colName(maxCol)}${maxRow}"/>${views}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows}</sheetData>${af}${merges}${printOptions}${pageMargins}${pageSetup}${hf}${drawing}</worksheet>`;
}
let crcTable=null;function crc32(u){if(!crcTable){crcTable=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);crcTable[n]=c>>>0;}}let c=0xffffffff;for(const b of u)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function put16(a,o,v){a[o]=v&255;a[o+1]=(v>>>8)&255;}function put32(a,o,v){a[o]=v&255;a[o+1]=(v>>>8)&255;a[o+2]=(v>>>16)&255;a[o+3]=(v>>>24)&255;}
async function deflateRaw(u){if(typeof CompressionStream==='undefined')return null;try{const cs=new CompressionStream('deflate-raw');const ab=await new Response(new Blob([u]).stream().pipeThrough(cs)).arrayBuffer();return new Uint8Array(ab);}catch{return null;}}
async function zipStore(entries){let locals=[],centrals=[],off=0;for(const [name,content] of entries){const n=TE.encode(name),d=typeof content==='string'?TE.encode(content):content,crc=crc32(d);let body=d,method=0;if(d.length>256&&!/\.(png|jpe?g|gif)$/i.test(name)){const z=await deflateRaw(d);if(z&&z.length<d.length){body=z;method=8;}}const l=new Uint8Array(30+n.length+body.length);put32(l,0,0x04034b50);put16(l,4,20);put16(l,6,0x800);put16(l,8,method);put32(l,14,crc);put32(l,18,body.length);put32(l,22,d.length);put16(l,26,n.length);l.set(n,30);l.set(body,30+n.length);locals.push(l);const c=new Uint8Array(46+n.length);put32(c,0,0x02014b50);put16(c,4,20);put16(c,6,20);put16(c,8,0x800);put16(c,10,method);put32(c,16,crc);put32(c,20,body.length);put32(c,24,d.length);put16(c,28,n.length);put32(c,42,off);c.set(n,46);centrals.push(c);off+=l.length;}const csize=centrals.reduce((a,x)=>a+x.length,0),e=new Uint8Array(22);put32(e,0,0x06054b50);put16(e,8,entries.length);put16(e,10,entries.length);put32(e,12,csize);put32(e,16,off);const total=off+csize+22,out=new Uint8Array(total);let p=0;for(const x of locals){out.set(x,p);p+=x.length;}for(const x of centrals){out.set(x,p);p+=x.length;}out.set(e,p);return out;}
function base64Bytes(s){s=String(s||'');if(s.includes(','))s=s.slice(s.indexOf(',')+1);if(typeof atob==='function'){const b=atob(s),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u;}if(typeof Buffer!=='undefined')return new Uint8Array(Buffer.from(s,'base64'));return new Uint8Array();}
function imageExt(img){let e=String((img&&img.extension)||'png').toLowerCase().replace('jpeg','jpg');return e==='jpg'?'jpeg':e;}
function drawingXml(items){const EMU=9525;let body='';items.forEach((it,i)=>{const r=it.range||{},tl=r.tl||{},ext=r.ext||{};const c=Math.max(0,Math.floor(Number(tl.col)||0)),rr=Math.max(0,Math.floor(Number(tl.row)||0));const co=Math.round(((Number(tl.col)||0)-c)*64*EMU),ro=Math.round(((Number(tl.row)||0)-rr)*20*EMU),cx=Math.round((Number(ext.width)||100)*EMU),cy=Math.round((Number(ext.height)||100)*EMU);body+=`<xdr:oneCellAnchor><xdr:from><xdr:col>${c}</xdr:col><xdr:colOff>${co}</xdr:colOff><xdr:row>${rr}</xdr:row><xdr:rowOff>${ro}</xdr:rowOff></xdr:from><xdr:ext cx="${cx}" cy="${cy}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${i+1}" name="Picture ${i+1}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${i+1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`;});return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${body}</xdr:wsDr>`;}
async function writeWorkbook(wb){
  const sheets=wb.worksheets.length?wb.worksheets:[new Worksheet('Sheet1')], sty=buildStyles(wb);
  const drawingSheets=[];sheets.forEach((s,i)=>{if(s.images&&s.images.length)drawingSheets.push([i,s]);});
  const extSet=new Set((wb.images||[]).map(imageExt));
  const defaults=[...extSet].map(e=>e==='jpeg'?'<Default Extension="jpg" ContentType="image/jpeg"/>':`<Default Extension="${e}" ContentType="image/${e}"/>`).join('');
  const drawingOverrides=drawingSheets.map((_,i)=>`<Override PartName="/xl/drawings/drawing${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`).join('');
  const ct=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${defaults}<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}${drawingOverrides}</Types>`;
  const rootR=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  let defined='';const defs=[];sheets.forEach((s,i)=>{const pr=s.pageSetup&&s.pageSetup.printTitlesRow,pc=s.pageSetup&&s.pageSetup.printTitlesColumn;const sn="'"+esc(String(s.name).replace(/'/g,"''"))+"'!",parts=[];const mc=pc&&String(pc).match(/([A-Za-z]+)\s*:\s*([A-Za-z]+)/);if(mc)parts.push(`${sn}$${mc[1].toUpperCase()}:$${mc[2].toUpperCase()}`);const m=pr&&String(pr).match(/(\d+)\s*:\s*(\d+)/);if(m)parts.push(`${sn}$${m[1]}:$${m[2]}`);if(parts.length)defs.push(`<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${parts.join(',')}</definedName>`);});if(defs.length)defined=`<definedNames>${defs.join('')}</definedNames>`;
  const workbook=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s,i)=>`<sheet name="${esc(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets>${defined}</workbook>`;
  const wr=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const entries=[['[Content_Types].xml',ct],['_rels/.rels',rootR],['xl/workbook.xml',workbook],['xl/_rels/workbook.xml.rels',wr],['xl/styles.xml',sty.xml]];
  let dno=0;for(let i=0;i<sheets.length;i++){const ws=sheets[i];let drid='';if(ws.images&&ws.images.length){dno++;drid='rId1';const rels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${dno}.xml"/></Relationships>`;entries.push([`xl/worksheets/_rels/sheet${i+1}.xml.rels`,rels]);entries.push([`xl/drawings/drawing${dno}.xml`,drawingXml(ws.images)]);const drels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${ws.images.map((it,j)=>{const img=(wb.images||[])[it.imageId-1]||{};const ext=imageExt(img);return `<Relationship Id="rId${j+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${it.imageId}.${ext==='jpeg'?'jpg':ext}"/>`;}).join('')}</Relationships>`;entries.push([`xl/drawings/_rels/drawing${dno}.xml.rels`,drels]);}
    entries.push([`xl/worksheets/sheet${i+1}.xml`,worksheetXml(ws,sty.styleMap,drid)]);
  }
  (wb.images||[]).forEach((img,i)=>{const ext=imageExt(img);entries.push([`xl/media/image${i+1}.${ext==='jpeg'?'jpg':ext}`,base64Bytes(img.base64||img.buffer||'')]);});
  const u=await zipStore(entries);return u.buffer.slice(u.byteOffset,u.byteOffset+u.byteLength);
}
function u16(a,o){return a[o]|(a[o+1]<<8)}function u32(a,o){return (a[o]|(a[o+1]<<8)|(a[o+2]<<16)|(a[o+3]<<24))>>>0;}
async function inflateRaw(u){if(typeof DecompressionStream==='undefined')throw new Error('deflate unsupported');const ds=new DecompressionStream('deflate-raw');const ab=await new Response(new Blob([u]).stream().pipeThrough(ds)).arrayBuffer();return new Uint8Array(ab);}
async function unzip(ab){const a=new Uint8Array(ab);let e=-1;for(let i=a.length-22;i>=Math.max(0,a.length-66000);i--){if(u32(a,i)===0x06054b50){e=i;break;}}if(e<0)throw new Error('invalid xlsx zip');const count=u16(a,e+10),cd=u32(a,e+16);let p=cd,out={};for(let k=0;k<count;k++){if(u32(a,p)!==0x02014b50)break;const method=u16(a,p+10),cs=u32(a,p+20),nl=u16(a,p+28),el=u16(a,p+30),cl=u16(a,p+32),lo=u32(a,p+42),name=TD.decode(a.slice(p+46,p+46+nl));const lnl=u16(a,lo+26),lel=u16(a,lo+28),start=lo+30+lnl+lel,comp=a.slice(start,start+cs);out[name]=method===0?comp:method===8?await inflateRaw(comp):null;p+=46+nl+el+cl;}return out;}
function xmlText(u){return u?TD.decode(u):'';}
function tagText(s,tag){const re=new RegExp('<(?:\\w+:)?'+tag+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:\\w+:)?'+tag+'>','i');const m=re.exec(s);return m?unesc(m[1].replace(/<[^>]+>/g,'')):'';}
function allText(s){let t='';const tre=/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/gi;for(const q of String(s||'').replace(/_x000[Dd]_/g,'').replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/gi,'').matchAll(tre))t+=unesc(q[1]);return t;}
function parseShared(s){const out=[], re=/<(?:\w+:)?si\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?si>)/gi;for(const m of s.matchAll(re))out.push(allText(m[1]||''));return out;}
function dateStyleSet(styles){
  const builtin=new Set([14,15,16,17,18,19,20,21,22,27,28,29,30,31,32,33,34,35,36,45,46,47,50,51,52,53,54,55,56,57,58]), custom={}, out=new Set();out.fmts=[];const BUILTIN_FMT={9:'0%',10:'0.00%',49:'@'};
  const nfre=/<(?:\w+:)?numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"[^>]*\/?>(?:<\/(?:\w+:)?numFmt>)?/gi;
  for(const m of styles.matchAll(nfre)) custom[Number(m[1])]=unesc(m[2]);
  const cm=/<(?:\w+:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:\w+:)?cellXfs>/i.exec(styles), block=cm?cm[1]:'';
  let idx=0; const xfre=/<(?:\w+:)?xf\b([^>]*)\/?>(?:<\/(?:\w+:)?xf>)?/gi;
  for(const m of block.matchAll(xfre)){
    const n=/numFmtId="(\d+)"/.exec(m[1]);
    if(n){const id=Number(n[1]),fmt=custom[id]||''; out.fmts[idx]=fmt||BUILTIN_FMT[id]||''; if((!fmt&&builtin.has(id))||/[ymdhs]/i.test(fmt.replace(/"[^"]*"/g,'').replace(/\\./g,'').replace(/\[[^\]]+\]/g,'').replace(/General/gi,''))) out.add(idx);}
    idx++;
  }
  return out;
}
function excelDate(n){const d=new Date(Date.UTC(1899,11,30)+Math.round(Number(n)*86400)*1000);return new Date(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),d.getUTCHours(),d.getUTCMinutes(),d.getUTCSeconds());}
async function loadWorkbook(wb,ab){
  const z=await unzip(ab), w=xmlText(z['xl/workbook.xml']), rel=xmlText(z['xl/_rels/workbook.xml.rels']);
  const d1904=/<(?:\w+:)?workbookPr\b[^>]*\bdate1904="(?:1|true|on)"/i.test(w);
  const shared=parseShared(xmlText(z['xl/sharedStrings.xml']||new Uint8Array())), dateStyles=dateStyleSet(xmlText(z['xl/styles.xml']||new Uint8Array()));
  const rels={}, rre=/<Relationship\b([^>]*)\/?>(?:<\/Relationship>)?/gi;
  for(const m of rel.matchAll(rre)){const id=/\bId="([^"]+)"/i.exec(m[1]), target=/\bTarget="([^"]+)"/i.exec(m[1]);if(id&&target)rels[id[1]]=target[1].replace(/^\//,'');}
  wb.worksheets=[];
  const sre=/<(?:\w+:)?sheet\b([^>]*)\/?>(?:<\/(?:\w+:)?sheet>)?/gi;
  for(const m of w.matchAll(sre)){
    const nm=/\bname="([^"]+)"/i.exec(m[1]), rid=/\br:id="([^"]+)"/i.exec(m[1]); if(!nm||!rid)continue;
    const name=unesc(nm[1]), target=rels[rid[1]]||'', path=target.startsWith('xl/')?target:'xl/'+target.replace(/^\.\//,'');
    const sx=xmlText(z[path]), ws=new Worksheet(name), rowre=/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/gi;
    let lastRow=0;
    for(const rm of sx.matchAll(rowre)){
      const rn=/\br="(\d+)"/i.exec(rm[1]), rowNo=rn?Number(rn[1]):lastRow+1; lastRow=rowNo;
      if(!rm[2])continue;
      const row=ws.getRow(rowNo), cre=/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/gi;
      let lastCol=0;
      for(const cm2 of rm[2].matchAll(cre)){
        const attrs=cm2[1], body=cm2[2]||'', rr=/\br="([A-Z]+)\d+"/i.exec(attrs), tt=/\bt="([^"]+)"/i.exec(attrs), ss=/\bs="(\d+)"/i.exec(attrs);
        const cc=rr?cellRC(rr[1]+'1')[1]:lastCol+1; lastCol=cc;
        if(!body)continue;
        let val='',fmt='';
        if(tt&&tt[1]==='inlineStr')val=allText(body);
        else{const v=tagText(body,'v');if(tt&&tt[1]==='s')val=shared[Number(v)]??'';else if(tt&&tt[1]==='b')val=v==='1';else if(tt&&['str','e'].includes(tt[1]))val=v;else if(tt&&tt[1]==='d'){const d=new Date(v);val=Number.isNaN(d.getTime())?v:d;}else if(v!==''){val=Number(v);if(ss){const si=Number(ss[1]);if(dateStyles.has(si)&&val>=0&&val<2958466)val=excelDate(val+(d1904?1462:0));fmt=dateStyles.fmts[si]||'';}}}
        if(val===''||val==null)continue;
        const cell=row.getCell(cc);cell.value=val;if(fmt)cell.numFmt=fmt;
      }
    }
    wb.worksheets.push(ws);
  }
  return wb;
}
g.ExcelJS={Workbook};g.__MINI_EXCELJS_OFFLINE__=true;
})(globalThis);
