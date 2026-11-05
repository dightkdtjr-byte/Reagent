'use strict';
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.InventorySafetyCommon=api;})(typeof window==='object'?window:globalThis,function(){
 const fields=['id','category','name','nameEn','spec','serialNo','casNo','maker','concentration','purity'];
 function identity(item){return JSON.stringify(fields.map(k=>String(item?.[k]??'')));}
 function matching(catalog,item){return (catalog.entries||[]).find(e=>e.itemId===item?.id&&e.identity===identity(item))||null;}
 function sourceFor(catalog,item){const entry=matching(catalog,item);return entry?.sourceId?(catalog.sources||[]).find(s=>s.id===entry.sourceId)||null:null;}
 function eligible(catalog,item){const entry=matching(catalog,item);return !!entry&&entry.status==='ready'&&!!sourceFor(catalog,item);}
 function mergeDocuments(item,document){const old=item.msdsDocuments||[];if(old.some(d=>d.id===document.id))return old.slice();if(old.length>=20)throw new Error('기존 MSDS가 20개여서 추가하지 않았습니다.');return [...old,document];}
 const clean=v=>{const s=String(v??'').normalize('NFKC').trim();return /^(?:nan|null|undefined|n\/a|-)?$/i.test(s)?'':s;};
 const normalize=v=>clean(v).toLowerCase().replace(/[\s,\-()·]/g,'');
 function validCAS(v){const s=clean(v);if(!/^\d{2,7}-\d{2}-\d$/.test(s))return false;const digits=s.replace(/-/g,'');return [...digits.slice(0,-1)].reverse().reduce((n,d,i)=>n+Number(d)*(i+1),0)%10===Number(digits.slice(-1));}
 function percentages(item){
   const text=['name','nameEn','spec','concentration','purity'].map(k=>clean(item?.[k])).join(' | '), ranges=[];
   const re=/(>=|<=|>|<|≥|≤)?\s*(\d+(?:\.\d+)?)\s*(?:%?\s*[~–—-]\s*(\d+(?:\.\d+)?))?\s*(\+)?\s*(?:wt\s*)?%/gi;
   for(const m of text.matchAll(re)) {let lo=+m[2],hi=m[3]?+m[3]:lo;if(!m[3]&&(m[1]==='>'||m[1]==='>='||m[1]==='≥'||m[4]))hi=100;if(!m[3]&&(m[1]==='<'||m[1]==='<='||m[1]==='≤'))lo=0;ranges.push([lo,hi]);}
   // Only an explicit purity label/field can imply percent without a percent sign.
   for(const m of clean(item?.spec).matchAll(/순도\s*[:：]\s*(\d+(?:\.\d+)?)(?![\d.])(?!\s*%)/g))ranges.push([+m[1],+m[1]]);
   const p=clean(item?.purity);if(/^\d+(?:\.\d+)?$/.test(p)&&Number(p)>1)ranges.push([+p,+p]);
   return {ranges,invalid:/(?:^|[\s|:,])-\s*\d+(?:\.\d+)?\s*%/.test(text)||/\d\s*[<>]\s*\d/.test(text)||ranges.some(([a,b])=>a<0||b>100||a>b)||ranges.length>0&&Math.max(...ranges.map(r=>r[0]))>Math.min(...ranges.map(r=>r[1]))};
 }
 function referenceMatch(catalog,item){
   if(!item)return null;
   const cas=clean(item.casNo),profiles=catalog.referenceProfiles||[],names=[clean(item.name),clean(item.nameEn)].filter(Boolean);
   const profile=profiles.find(p=>p.casNo===cas)||profiles.find(p=>names.some(n=>(p.aliases||[]).some(a=>normalize(a)===normalize(n))));
   if(!profile)return null;
   const source=(catalog.sources||[]).find(s=>s.id===profile.sourceId);if(!source)return null;
   const base={sourceId:source.id,profileId:profile.id,status:'composition',usage:'reference',equivalenceVerified:false,notes:[]};
   const no=reason=>({...base,reason});
   if(item.category==='standard')return no('표준물질은 용매·농도·혼합 조성 확인이 필요합니다. 순물질의 MSDS/GHS를 자동 연결하지 않습니다.');
   if(item.category!=='reagent')return no('품목 분류를 확인해야 합니다.');
   if(!validCAS(profile.casNo)||source.casNo!==profile.casNo)return no('참고 프로필과 문서의 물질 식별정보를 다시 확인해야 합니다.');
   if(!validCAS(cas)||cas!==profile.casNo)return no('CAS가 없거나 형식·검증번호·물질명이 맞지 않습니다. 원래 입력값은 수정하지 않았습니다.');
   if(!names.length)return no('품명이 없어 같은 물질인지 확인할 수 없습니다.');
   // Only a terminal aqueous percentage may be removed from an identity name.
   const nameKey=n=>normalize(profile.form==='aqueous'?n.replace(/\s*\(\s*\d+(?:\.\d+)?\s*%\s*\)\s*$/,''):n);
   if(names.some(n=>!profile.aliases.some(a=>normalize(a)===nameKey(n))))return no('품명·영문명 또는 용액/형태 표기가 참고 물질과 다릅니다. CAS만으로 연결하지 않습니다.');
   const text=['name','nameEn','spec','concentration','purity'].map(k=>clean(item[k])).join(' ').toLowerCase();
   if(/nano|나노|quartz|석영|indicator|지시약|stabili[sz]|안정제|inhibitor|억제제|denatur|변성|혼합|mixture|buffer|완충/.test(text))return no('첨가제·혼합물·특수 형태 등의 표기가 있어 제품 조성 확인이 필요합니다.');
   if(/w\s*\/\s*v|v\s*\/\s*v|vol\s*%|부피\s*%/.test(text))return no('부피 기준 농도는 참고 SDS의 질량 기준 농도와 자동으로 같게 보지 않습니다.');
   if(/\b(?:[mun]?mol\s*\/\s*l|ppm|ppb)\b|\b\d+(?:\.\d+)?\s*[mn]\b|(?:[µμuｍmkn]?g)\s*\/\s*(?:m?l)\b/i.test(text))return no('몰농도·질량/부피 농도의 용액입니다. 용매와 질량분율을 확인한 뒤 제품별 자료를 사용해야 합니다.');
   if(profile.form!=='aqueous'&&/solution|용액|솔루션|표준|standard|수용액/.test(text))return no('용액·표준제품에 순물질 참고 GHS를 자동 적용하지 않습니다.');
   if(profile.form==='aqueous'&&/메탄올|methanol|ethanol|에탄올|acetonitrile|아세토니트릴|dichloromethane|디클로로메탄/.test(text))return no('유기용매 표기가 있어 수용액 참고자료와 조성이 일치하지 않습니다.');
   if(profile.form==='solid'&&(/\b\d+(?:\.\d+)?\s*m?l\b/i.test(text)||/기체|gas|액체|liquid/.test(text)))return no('고체 참고문서와 보유 품목의 용량·형태 표기를 함께 확인해야 합니다.');
   if(profile.form!=='solid'&&/분말|powder|펠릿|pellet|기체|\bgas\b/.test(text))return no('보유 품목의 물리적 형태가 참고문서와 다릅니다.');
   if(!['solid','liquid','aqueous'].includes(profile.form)||!Number.isFinite(profile.minPercent)||!Number.isFinite(profile.maxPercent)||profile.minPercent>profile.maxPercent)return no('검토 프로필의 농도·형태 정보가 불완전합니다.');
   const pct=percentages(item);if(pct.invalid)return no('농도·순도 표기가 잘못되었거나 서로 충돌합니다.');
   if(pct.ranges.some(([a,b])=>a<profile.minPercent||b>profile.maxPercent))return no(`보유 농도·순도 범위가 검토한 참고 조건(${profile.minPercent}–${profile.maxPercent}%) 밖입니다. 농도가 다른 문서를 자동 연결하지 않습니다.`);
   let basis;
   if(pct.ranges.length)basis='CAS·품명 및 기재 농도/순도 범위 기준';
   else if(profile.form!=='aqueous'&&profile.allowGradeWithoutPercent&&/\bhplc\b|\bacs\b|\bgr\b|\bep\b|특급/.test(text))basis='CAS·품명 및 순물질 시약 등급 표기 기준 (수치 순도 미입력)';
   else return no('수치 농도·순도 또는 검토 가능한 시약 등급 정보가 부족합니다. 같은 CAS만으로 GHS를 연결하지 않습니다.');
   return {...base,status:'reference',reason:`${basis}의 참고 후보입니다. 제조사·정확한 순도·첨가제 일치 또는 제품 동등성을 확인한 자료는 아닙니다.`,notes:['참고 SDS에 기재된 위험정보이며 실제 보유 제품의 확정 GHS가 아닙니다.','표시된 %의 기준, 안정제·불순물, 세부 물리적 형태 및 국내 분류는 실제 공급자 자료로 확인해야 합니다.']};
 }
 function resolve(catalog,item){
   const exact=matching(catalog,item);
   // Retain reviewed conflicts. Reference mode must not silently bypass an existing review flag.
   if(exact&&(exact.status==='ready'||exact.status==='review'))return {...exact,usage:'product'};
   const ref=referenceMatch(catalog,item);if(ref)return ref;
   if(item?.category==='standard')return {status:'composition',sourceId:null,reason:'표준물질의 용매·농도·혼합 조성과 제품번호를 확인해야 합니다. 순물질 자료는 자동 적용하지 않습니다.'};
   const known=(catalog.entries||[]).some(e=>e.itemId===item?.id);
   return exact||{status:'unresolved',sourceId:null,reason:known?'검토 당시와 식별정보가 달라 제품 일치 연결을 중단했습니다. 조건에 맞는 참고자료도 아직 없습니다.':'검토된 제품 자료 또는 조건에 맞는 동일 물질 참고자료가 없습니다.'};
 }
 function resolvedSource(catalog,item){const e=resolve(catalog,item);return (catalog.sources||[]).find(s=>s.id===e.sourceId)||null;}
 function canConnect(catalog,item,usage='product'){const e=resolve(catalog,item);return usage==='reference'?e.status==='reference'&&!!resolvedSource(catalog,item):eligible(catalog,item);}
 function linkRole(item,document){
   const live=i=>!!i&&i.documentId===document.id&&i.identity===identity(item);
   if(live(item.safetyInfo))return 'product';
   if(live(item.safetyReferenceInfo))return 'reference';
   if(item.safetyReferenceInfo?.documentId===document.id||item.safetyInfo?.documentId===document.id||document.safetyUsage==='reference')return 'stale';
   return document.sourceId?'unverified':'manual';
 }
 return {fields,identity,matching,sourceFor,eligible,mergeDocuments,validCAS,percentages,referenceMatch,resolve,resolvedSource,canConnect,linkRole};
});
