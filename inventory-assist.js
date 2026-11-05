/* v3.9.5 — deterministic, read-only inventory tools. No network or database writes. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.InventoryAssist=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const norm=v=>String(v??'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
const arr=v=>Array.isArray(v)?v:[];
const number=v=>typeof v!=='boolean'&&v!==null&&String(v).trim()!==''&&Number.isFinite(Number(v));
const qty=v=>number(v)?Number(v):0;
const label=r=>r.category==='standard'?'표준물질':'시약';
function localDate(value=new Date()) {const d=value instanceof Date?value:new Date(value);if(!Number.isFinite(d.getTime()))return '';return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function dateNumber(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;const [y,m,d]=s.split('-').map(Number);const t=new Date(Date.UTC(y,m-1,d));return t.toISOString().slice(0,10)===s?t.getTime()/86400000:null;}
function batchList(r){return arr(r.batches).length?r.batches:[{stock:r.stock,expiryDate:r.expiryDate,receivedDate:r.receivedDate}];}
function stock(r){return batchList(r).reduce((a,b)=>a+Math.max(0,qty(b.stock)),0);}
function usable(r,today){return batchList(r).filter(b=>!b.expiryDate||(dateNumber(b.expiryDate)!==null&&b.expiryDate>=today)).reduce((a,b)=>a+Math.max(0,qty(b.stock)),0);}
function expiryMatches(r,kind,days,today){if(kind==='any')return true;const t=dateNumber(today);return batchList(r).some(b=>{if(qty(b.stock)<=0)return false;const d=dateNumber(b.expiryDate);if(kind==='missing')return !b.expiryDate;if(d===null)return false;if(kind==='expired')return d<t;if(kind==='valid')return d>=t;return d>=t&&d<=t+days;});}
function periodRange(period,today){if(dateNumber(today)===null)throw new Error('기준 날짜를 확인해주세요.');const [y,m]=today.split('-').map(Number);if(period==='today')return [today,today];if(period==='this_month')return [`${today.slice(0,7)}-01`,today];if(period==='last_month'){const last=new Date(Date.UTC(y,m-1,0));return [last.toISOString().slice(0,7)+'-01',last.toISOString().slice(0,10)];}return ['0000-01-01',today];}
function transactionType(log){const t=log.type;if((t==='in'||t==='register')&&qty(log.qty)>0)return 'in';if(t==='out'&&qty(log.qty)>0)return 'out';return '';}
// Ordinary keyword search only. Every word must appear in the item metadata;
// nothing is interpreted as an instruction, period, stock or expiry condition.
function search(db,query='',{category='all',includeArchived=false}={}){
 if(!['all','reagent','standard'].includes(category))return [];
 const terms=norm(query).split(' ').filter(Boolean);
 return arr(db.reagents).filter(r=>{
  if(!r||typeof r!=='object')return false;
  if(!includeArchived&&r.archivedAt)return false;
  if(category!=='all'&&(r.category||'reagent')!==category)return false;
  const hay=norm([r.id,r.name,r.nameEn,r.casNo,r.maker,r.serialNo,r.storage,r.spec,r.concentration,
   ...batchList(r).flatMap(b=>[b.lotNo,b.batchId,`${r.id}-${b.batchId}`])].join(' '));
  return terms.every(term=>hay.includes(term));
 });
}
function duplicates(db,draft){const name=norm(draft.name),cas=norm(draft.casNo);if(!name&&!cas)return [];return arr(db.reagents).filter(r=>!r.archivedAt&&(r.category||'reagent')===(draft.category||'reagent')&&r.id!==draft.id&&((cas&&norm(r.casNo)===cas)||(name&&[r.name,r.nameEn].some(v=>norm(v).includes(name))))).slice(0,8);}
function inspect(db,today=localDate()){const issues=[];const push=(r,code,message,batchId='',level='확인')=>issues.push({id:String(r.id||''),name:String(r.name||r.id||'이름 없음'),category:label(r),code,message,batchId,level});const groups=new Map();
 for(const r of arr(db.reagents)){if(r.archivedAt)continue;for(const [field,title] of [['name','품목명'],['unit','단위'],['maker','제조사'],['storage','보관방법']])if(!norm(r[field]))push(r,'missing-'+field,`${title} 미입력`);if(!norm(r.casNo))push(r,'missing-cas','CAS 번호 미입력 — 혼합물·표준용액은 해당 여부 확인');if(r.category==='standard'&&!norm(r.concentration))push(r,'missing-concentration','표준물질 농도 미입력');
 const bs=batchList(r);let total=0;const seen=new Set();for(const b of bs){if(!number(b.stock)||qty(b.stock)<0)push(r,'stock-invalid','재고수량이 숫자가 아니거나 음수입니다.',b.batchId,'오류');else total+=qty(b.stock);if(b.batchId&&seen.has(b.batchId))push(r,'batch-duplicate','입고회차 ID 중복',b.batchId,'오류');seen.add(b.batchId);if(number(b.initialQty)&&qty(b.stock)>qty(b.initialQty))push(r,'stock-over','남은 수량이 최초 입고수량보다 큽니다. 재고조정 이력 확인',b.batchId);
 if(qty(b.stock)>0){if(!b.expiryDate)push(r,'expiry-missing','유효기간 미입력 — 유효기간이 없는 제품인지 확인',b.batchId);if(r.category==='standard'&&!norm(b.lotNo))push(r,'lot-missing','표준물질 Lot 번호 미입력',b.batchId);}
 for(const [k,n] of [['receivedDate','입고일'],['expiryDate','유효기간'],['openedDate','개봉일']])if(b[k]&&dateNumber(b[k])===null)push(r,'date-invalid',`${n} 형식이 올바르지 않습니다.`,b.batchId,'오류');
 if(dateNumber(b.expiryDate)!==null&&dateNumber(b.receivedDate)!==null&&b.expiryDate<b.receivedDate)push(r,'expiry-before-receipt','유효기간이 입고일보다 빠릅니다.',b.batchId);
 }
 if(!number(r.stock)||Math.abs(qty(r.stock)-total)>1e-7)push(r,'stock-sum','품목 총 재고와 입고회차별 합계가 다릅니다.', '', '오류');
 const substance=norm(r.casNo)||norm(r.name);if(substance){const key=[r.category||'reagent',substance,norm(r.maker),norm(r.spec),norm(r.concentration)].join('|');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
 }
 for(const group of groups.values())if(group.length>1)for(const r of group)push(r,'possible-duplicate','중복 후보: '+group.filter(x=>x!==r).map(x=>x.id).join(', ')+' — 규격·농도·제조사와 실물 확인');
 return issues.sort((a,b)=>(a.level==='오류'?0:1)-(b.level==='오류'?0:1)||a.id.localeCompare(b.id,'ko',{numeric:true}));
}
function summarize(db,{today=localDate(),period='this_month',days=30}={}){const items=arr(db.reagents),active=items.filter(r=>!r.archivedAt);const [start,end]=periodRange(period,today);const c={reagent:0,standard:0,archived:items.length-active.length,stockZero:0,low:0,soon:0,expired:0,missingExpiry:0};for(const r of active){c[r.category==='standard'?'standard':'reagent']++;if(stock(r)<=0)c.stockZero++;if(qty(r.minStock)>0&&usable(r,today)<=qty(r.minStock))c.low++;if(expiryMatches(r,'soon',days,today))c.soon++;if(expiryMatches(r,'expired',days,today))c.expired++;if(expiryMatches(r,'missing',days,today))c.missingExpiry++;}
 const units=new Map(),byId=new Map(items.map(r=>[r.id,r]));let inc=0,out=0,unknown=0;for(const log of arr(db.logs)){const typ=transactionType(log),d=localDate(log.date);if(!typ||!d||d<start||d>end)continue;if(typ==='in')inc++;else out++;const unit=String(log.unit||byId.get(log.id)?.unit||'단위 미입력').trim();if(unit==='단위 미입력')unknown++;if(!units.has(unit))units.set(unit,{unit,in:0,out:0});units.get(unit)[typ]+=qty(log.qty);}
 const periodText=period==='any'?`전체 기록 ~ ${end}`:start===end?start:`${start} ~ ${end}`;const lines=[`재고 현황 (${today} 기준)`,`등록된 활성 품목: 시약 ${c.reagent}종, 표준물질 ${c.standard}종. 폐기·비활성 ${c.archived}종은 현재 재고 집계에서 제외함.`,`총 재고 0: ${c.stockZero}종. 최소재고 기준 이하: ${c.low}종.`,`오늘부터 ${days}일 이내 만료 회차 보유: ${c.soon}종. 이미 만료된 회차 보유: ${c.expired}종. 유효기간 미입력 회차 보유: ${c.missingExpiry}종.`,``,`입출고 현황 (${periodText})`,`입고 ${inc}건 (최초 등록 포함), 출고 ${out}건.`];for(const u of units.values())lines.push(`${u.unit}: 입고 ${+u.in.toFixed(6)}, 출고 ${+u.out.toFixed(6)}`);lines.push('','※ 품목 수와 병 수는 다릅니다. 만료·부족 조건은 중복될 수 있습니다.','※ 서로 다른 단위는 합산하지 않습니다. 과거 이력에 단위가 없으면 현재 품목 단위를 사용합니다.','※ 수량 0인 정보수정·재고조정·폐기 이력은 입출고 건수에서 제외합니다.');if(unknown)lines.push(`※ 단위를 확인할 수 없는 이력 ${unknown}건은 별도 표시했습니다.`);return {counts:c,period:periodText,transactions:{in:inc,out,units:[...units.values()]},text:lines.join('\n')};}
return {norm,localDate,dateNumber,stock,usable,search,duplicates,inspect,summarize,periodRange};
});
