'use strict';
// GHS 분류·표시 사전. 한국어 문구는 읽기용 요약이며 공급자 MSDS와 법정 경고표지를 대체하지 않습니다.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.GHSData=api;})(typeof window==='object'?window:globalThis,function(){
  const PICTOGRAMS={
    GHS01:{label:'폭발성',desc:'폭발성 물질·자기반응성·유기과산화물'},
    GHS02:{label:'인화성',desc:'인화성 가스·에어로졸·액체·고체, 자연발화성, 물반응성'},
    GHS03:{label:'산화성',desc:'산화성 가스·액체·고체'},
    GHS04:{label:'고압가스',desc:'압축·액화·용해·냉동액화 가스'},
    GHS05:{label:'부식성',desc:'금속 부식성, 피부 부식성, 심한 눈 손상'},
    GHS06:{label:'급성독성',desc:'급성 독성 구분 1~3'},
    GHS07:{label:'경고',desc:'급성 독성 구분 4, 피부·눈 자극, 피부 과민성, 호흡기 자극, 마취 작용'},
    GHS08:{label:'건강유해성',desc:'발암성, 생식세포 변이원성, 생식독성, 호흡기 과민성, 특정표적장기 독성, 흡인 유해성'},
    GHS09:{label:'환경유해성',desc:'수생환경 유해성'}
  };
  const SIGNAL={Danger:'위험',Warning:'경고',None:'없음'};
  // [코드, 한국어 문구, 그림문자(없으면 null), 신호어]
  const H_ROWS=[
    ['H200','불안정한 폭발성 물질','GHS01','Danger'],
    ['H201','폭발성 물질: 대폭발 위험','GHS01','Danger'],
    ['H202','폭발성 물질: 심한 분출 위험','GHS01','Danger'],
    ['H203','폭발성 물질: 화재, 폭풍 또는 분출 위험','GHS01','Danger'],
    ['H204','화재 또는 분출 위험','GHS01','Warning'],
    ['H205','화재 시 대폭발할 수 있음','GHS01','Danger'],
    ['H220','극인화성 가스','GHS02','Danger'],
    ['H221','인화성 가스','GHS02','Warning'],
    ['H222','극인화성 에어로졸','GHS02','Danger'],
    ['H223','인화성 에어로졸','GHS02','Warning'],
    ['H224','극인화성 액체 및 증기','GHS02','Danger'],
    ['H225','고인화성 액체 및 증기','GHS02','Danger'],
    ['H226','인화성 액체 및 증기','GHS02','Warning'],
    ['H228','인화성 고체','GHS02','Warning'],
    ['H229','압력 용기: 가열하면 터질 수 있음',null,'Warning'],
    ['H230','공기가 없어도 폭발적으로 반응할 수 있음','GHS02','Danger'],
    ['H231','공기가 없어도 상승된 압력 및/또는 온도에서 폭발적으로 반응할 수 있음','GHS02','Danger'],
    ['H240','가열하면 폭발할 수 있음','GHS01','Danger'],
    ['H241','가열하면 화재 또는 폭발할 수 있음','GHS01','Danger'],
    ['H242','가열하면 화재를 일으킬 수 있음','GHS02','Warning'],
    ['H250','공기에 노출되면 스스로 발화함','GHS02','Danger'],
    ['H251','자기발열성; 화재를 일으킬 수 있음','GHS02','Danger'],
    ['H252','대량으로 존재 시 자기발열성; 화재를 일으킬 수 있음','GHS02','Warning'],
    ['H260','물과 접촉 시 자연 발화성 인화성 가스를 발생시킴','GHS02','Danger'],
    ['H261','물과 접촉 시 인화성 가스를 발생시킴','GHS02','Danger'],
    ['H270','화재를 일으키거나 강렬하게 함; 산화제','GHS03','Danger'],
    ['H271','화재 또는 폭발을 일으킬 수 있음; 강산화제','GHS03','Danger'],
    ['H272','화재를 강렬하게 함; 산화제','GHS03','Danger'],
    ['H280','고압가스 포함; 가열하면 폭발할 수 있음','GHS04','Warning'],
    ['H281','냉동액화가스 포함; 극저온의 화상 또는 손상을 일으킬 수 있음','GHS04','Warning'],
    ['H290','금속을 부식시킬 수 있음','GHS05','Warning'],
    ['H300','삼키면 치명적임','GHS06','Danger'],
    ['H301','삼키면 유독함','GHS06','Danger'],
    ['H302','삼키면 유해함','GHS07','Warning'],
    ['H304','삼켜서 기도로 유입되면 치명적일 수 있음','GHS08','Danger'],
    ['H310','피부와 접촉하면 치명적임','GHS06','Danger'],
    ['H311','피부와 접촉하면 유독함','GHS06','Danger'],
    ['H312','피부와 접촉하면 유해함','GHS07','Warning'],
    ['H314','피부에 심한 화상과 눈에 손상을 일으킴','GHS05','Danger'],
    ['H315','피부에 자극을 일으킴','GHS07','Warning'],
    ['H317','알레르기성 피부 반응을 일으킬 수 있음','GHS07','Warning'],
    ['H318','눈에 심한 손상을 일으킴','GHS05','Danger'],
    ['H319','눈에 심한 자극을 일으킴','GHS07','Warning'],
    ['H320','눈에 자극을 일으킴',null,'Warning'],
    ['H330','흡입하면 치명적임','GHS06','Danger'],
    ['H331','흡입하면 유독함','GHS06','Danger'],
    ['H332','흡입하면 유해함','GHS07','Warning'],
    ['H334','흡입 시 알레르기성 반응, 천식 또는 호흡 곤란을 일으킬 수 있음','GHS08','Danger'],
    ['H335','호흡기계 자극을 일으킬 수 있음','GHS07','Warning'],
    ['H336','졸음 또는 현기증을 일으킬 수 있음','GHS07','Warning'],
    ['H340','유전적인 결함을 일으킬 수 있음','GHS08','Danger'],
    ['H341','유전적인 결함을 일으킬 것으로 의심됨','GHS08','Warning'],
    ['H350','암을 일으킬 수 있음','GHS08','Danger'],
    ['H351','암을 일으킬 것으로 의심됨','GHS08','Warning'],
    ['H360','태아 또는 생식능력에 손상을 일으킬 수 있음','GHS08','Danger'],
    ['H361','태아 또는 생식능력에 손상을 일으킬 것으로 의심됨','GHS08','Warning'],
    ['H362','모유를 먹는 아이에게 유해할 수 있음',null,'None'],
    ['H370','장기(영향을 받는 장기)에 손상을 일으킴','GHS08','Danger'],
    ['H371','장기(영향을 받는 장기)에 손상을 일으킬 수 있음','GHS08','Warning'],
    ['H372','장기간 또는 반복 노출되면 장기(영향을 받는 장기)에 손상을 일으킴','GHS08','Danger'],
    ['H373','장기간 또는 반복 노출되면 장기(영향을 받는 장기)에 손상을 일으킬 수 있음','GHS08','Warning'],
    ['H400','수생생물에 매우 유독함','GHS09','Warning'],
    ['H401','수생생물에 유독함',null,'None'],
    ['H402','수생생물에 유해함',null,'None'],
    ['H410','장기적 영향에 의해 수생생물에 매우 유독함','GHS09','Warning'],
    ['H411','장기적 영향에 의해 수생생물에 유독함','GHS09','None'],
    ['H412','장기적 영향에 의해 수생생물에 유해함',null,'None'],
    ['H413','장기적 영향에 의해 수생생물에 유해의 우려가 있음',null,'None'],
    ['H420','대기 상층부의 오존층을 파괴하여 공공의 건강 및 환경에 유해함','GHS07','Warning']
  ];
  const P_ROWS=[
    ['P101','의학적인 조언을 구하고자 할 때는 제품의 용기 또는 라벨을 소지하시오'],
    ['P102','어린이의 손이 닿지 않는 곳에 보관하시오'],
    ['P103','사용 전 라벨을 읽으시오'],
    ['P201','사용 전 취급 설명서를 확보하시오'],
    ['P202','모든 안전 예방조치 문구를 읽고 이해하기 전에는 취급하지 마시오'],
    ['P210','열·스파크·화염·고열로부터 멀리하시오 — 금연'],
    ['P211','화염 또는 다른 점화원에 분사하지 마시오'],
    ['P220','의류 및 가연성 물질로부터 멀리하시오'],
    ['P222','공기에 접촉하지 않도록 하시오'],
    ['P223','물과 접촉하지 않도록 하시오'],
    ['P230','(지정 물질)로 젖은 상태로 유지하시오'],
    ['P231','불활성 기체 하에서 취급하시오'],
    ['P232','습기를 방지하시오'],
    ['P233','용기를 단단히 밀폐하시오'],
    ['P234','원래의 용기에만 보관하시오'],
    ['P235','저온으로 유지하시오'],
    ['P240','용기와 수용설비를 접지 및 접합시키시오'],
    ['P241','폭발방지용 전기·환기·조명 장비를 사용하시오'],
    ['P242','스파크가 발생하지 않는 도구를 사용하시오'],
    ['P243','정전기 방지 조치를 취하시오'],
    ['P244','밸브 및 부속품에 그리스와 오일이 묻지 않도록 하시오'],
    ['P250','분쇄·충격·마찰 등을 가하지 마시오'],
    ['P251','사용 후에도 구멍을 뚫거나 태우지 마시오'],
    ['P260','분진·흄·가스·미스트·증기·스프레이를 흡입하지 마시오'],
    ['P261','분진·흄·가스·미스트·증기·스프레이의 흡입을 피하시오'],
    ['P262','눈, 피부, 의복에 묻지 않도록 하시오'],
    ['P263','임신·수유 기간에는 접촉하지 마시오'],
    ['P264','취급 후에는 손을 철저히 씻으시오'],
    ['P270','이 제품을 사용할 때에는 먹거나, 마시거나 흡연하지 마시오'],
    ['P271','옥외 또는 환기가 잘 되는 곳에서만 취급하시오'],
    ['P272','작업장 밖으로 오염된 의복을 반출하지 마시오'],
    ['P273','환경으로 배출하지 마시오'],
    ['P280','보호장갑·보호의·보안경·안면보호구를 착용하시오'],
    ['P282','방한 장갑·안면보호구·보안경을 착용하시오'],
    ['P283','방화복 또는 방염복을 착용하시오'],
    ['P284','호흡기 보호구를 착용하시오'],
    ['P301','삼켰다면'],
    ['P302','피부에 묻으면'],
    ['P303','피부(또는 머리카락)에 묻으면'],
    ['P304','흡입하면'],
    ['P305','눈에 묻으면'],
    ['P308','노출되거나 노출이 우려되면'],
    ['P310','즉시 의료기관(의사)의 진찰을 받으시오'],
    ['P311','의료기관(의사)의 진찰을 받으시오'],
    ['P312','불편함을 느끼면 의료기관(의사)의 진찰을 받으시오'],
    ['P313','의학적인 조치·조언을 구하시오'],
    ['P314','불편함을 느끼면 의학적인 조치·조언을 구하시오'],
    ['P315','즉시 의학적인 조치·조언을 구하시오'],
    ['P320','긴급히 (특정) 처치를 하시오'],
    ['P321','(특정) 처치를 하시오'],
    ['P330','입을 씻어내시오'],
    ['P331','토하게 하지 마시오'],
    ['P332','피부 자극이 생기면'],
    ['P333','피부자극성 또는 홍반이 나타나면'],
    ['P334','찬물에 담그시오 (또는 젖은 붕대로 감으시오)'],
    ['P335','피부에 묻은 물질을 털어내시오'],
    ['P336','동상 부위를 미지근한 물로 녹이시오. 손상 부위를 문지르지 마시오'],
    ['P337','눈에 자극이 지속되면'],
    ['P338','가능하면 콘택트렌즈를 제거하시오. 계속 씻으시오'],
    ['P340','신선한 공기가 있는 곳으로 옮기고 호흡하기 쉬운 자세로 안정을 취하시오'],
    ['P342','호흡기 증상이 나타나면'],
    ['P351','몇 분간 물로 조심해서 씻으시오'],
    ['P352','다량의 물로 씻으시오'],
    ['P353','피부를 물로 씻으시오/샤워하시오'],
    ['P360','의복을 벗기 전에 오염된 의복과 피부를 다량의 물로 즉시 씻어내시오'],
    ['P361','오염된 모든 의복은 즉시 벗으시오'],
    ['P362','오염된 의복은 벗으시오'],
    ['P363','다시 사용 전 오염된 의류는 세척하시오'],
    ['P364','다시 사용 전 세척하시오'],
    ['P370','화재 시'],
    ['P371','대형 화재 시 및 대량 존재 시'],
    ['P372','화재 시 폭발 위험'],
    ['P373','화염이 폭발물에 도달하면 불을 끄려 하지 마시오'],
    ['P375','폭발 위험이 있으므로 거리를 두고 불을 끄시오'],
    ['P376','안전하게 처리할 수 있다면 누출을 중단시키시오'],
    ['P377','누출 가스 화재 시: 누출을 안전하게 막을 수 없다면 불을 끄려 하지 마시오'],
    ['P378','불을 끄기 위해 (적절한 소화제)를 사용하시오'],
    ['P380','주변 지역의 사람을 대피시키시오'],
    ['P381','안전하게 처리할 수 있다면 모든 점화원을 제거하시오'],
    ['P390','물질 손상을 방지하기 위해 누출물을 흡수시키시오'],
    ['P391','누출물을 모으시오'],
    ['P401','(관련 규정)에 따라 보관하시오'],
    ['P402','건조한 장소에 보관하시오'],
    ['P403','환기가 잘 되는 곳에 보관하시오'],
    ['P404','밀폐된 용기에 보관하시오'],
    ['P405','잠금장치가 있는 저장장소에 저장하시오'],
    ['P406','내부식성 용기 또는 내부식성 라이너를 가진 용기에 보관하시오'],
    ['P407','적재 화물 사이에 간격을 두시오'],
    ['P410','직사광선을 피하시오'],
    ['P411','(지정 온도)℃ 이하의 온도에서 보관하시오'],
    ['P412','50℃ 이상의 온도에 노출시키지 마시오'],
    ['P413','(지정 중량)kg 이상의 대량 저장 시 (지정 온도)℃ 이하의 온도에서 보관하시오'],
    ['P420','서로 분리하여 보관하시오'],
    ['P422','(지정 조건) 하에 보관하시오'],
    ['P501','(관련 법규에 명시된 내용에 따라) 내용물·용기를 폐기하시오'],
    ['P502','재생 또는 재활용에 대한 정보는 제조자 또는 공급자에게 문의하시오']
  ];
  const H=new Map(H_ROWS.map(([code,ko,pictogram,signal])=>[code,{code,ko,pictogram,signal,group:code<'H300'?'물리적 위험성':code<'H400'?'건강 유해성':'환경 유해성'}]));
  const P=new Map(P_ROWS.map(([code,ko])=>[code,{code,ko,group:{1:'일반',2:'예방',3:'대응',4:'저장',5:'폐기'}[code[1]]||'기타'}]));
  const CODE_RE=/^[HP]\d{3}(?:\+[HP]\d{3})*$/;
  function normalizeCode(v){return String(v||'').toUpperCase().replace(/\s+/g,'').replace(/[＋]/g,'+');}
  // "H225, H319 / P210+P233" 같은 자유 입력을 코드 배열로 바꾼다. 알 수 없는 코드도 형식만 맞으면 허용(원문 참조).
  function parseCodes(text,kind){
    const out=[];for(const raw of String(text||'').split(/[\s,;/、]+/)){const c=normalizeCode(raw);if(!c)continue;if(!CODE_RE.test(c)||c[0]!==kind)continue;if(!out.includes(c))out.push(c);}return out;
  }
  function hText(code){const c=normalizeCode(code);if(H.has(c))return H.get(c).ko;const parts=c.split('+');if(parts.length>1&&parts.every(p=>H.has(p)))return parts.map(p=>H.get(p).ko).join(' + ');return '원문 참조';}
  function pText(code){const c=normalizeCode(code);if(P.has(c))return P.get(c).ko;const parts=c.split('+');if(parts.length>1&&parts.every(p=>P.has(p)))return parts.map(p=>P.get(p).ko).join(' + ');return '원문 참조';}
  // H코드 목록에서 그림문자와 신호어를 제안한다. 혼합물·구분에 따라 달라질 수 있으므로 제안일 뿐이다.
  function suggestFromH(codes){
    const pictos=[];let danger=false,warning=false;
    for(const raw of codes||[]){for(const c of normalizeCode(raw).split('+')){const row=H.get(c);if(!row)continue;if(row.pictogram&&!pictos.includes(row.pictogram))pictos.push(row.pictogram);if(row.signal==='Danger')danger=true;else if(row.signal==='Warning')warning=true;}}
    // GHS 우선순위: 해골(GHS06)이 있으면 느낌표(GHS07)는 생략, 부식성(GHS05)이 있으면 피부·눈 자극용 느낌표 생략 규칙은 자극 코드에만 해당하므로 단순화해 GHS06만 적용.
    const order=Object.keys(PICTOGRAMS);
    const filtered=pictos.filter(p=>!(p==='GHS07'&&pictos.includes('GHS06'))).sort((a,b)=>order.indexOf(a)-order.indexOf(b));
    return {pictograms:filtered,signalWord:danger?'Danger':warning?'Warning':(codes&&codes.length?'None':'')};
  }
  function normalizeGHS(v){
    if(!v||typeof v!=='object'||Array.isArray(v))return null;
    const order=Object.keys(PICTOGRAMS);
    const pictograms=(Array.isArray(v.pictograms)?v.pictograms:[]).map(normalizeCode).filter(c=>PICTOGRAMS[c]).filter((c,i,a)=>a.indexOf(c)===i).sort((a,b)=>order.indexOf(a)-order.indexOf(b));
    const signalWord=['Danger','Warning','None'].includes(v.signalWord)?v.signalWord:'';
    const text=(x,n)=>String(x??'').trim().slice(0,n);
    const date=x=>{const s=text(x,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';};
    const g={pictograms,signalWord,hCodes:parseCodes((Array.isArray(v.hCodes)?v.hCodes:[]).join(' '),'H').slice(0,40),pCodes:parseCodes((Array.isArray(v.pCodes)?v.pCodes:[]).join(' '),'P').slice(0,60),
      hazardClasses:text(v.hazardClasses,500),source:['supplier','kosha','catalog','other'].includes(v.source)?v.source:'',sourceNote:text(v.sourceNote,200),
      msdsIssuedAt:date(v.msdsIssuedAt),msdsRevision:text(v.msdsRevision,40),msdsReviewedAt:date(v.msdsReviewedAt),note:text(v.note,1000),updatedAt:text(v.updatedAt,40)};
    if(v.extractedFrom&&typeof v.extractedFrom==='object'&&/^[a-f0-9]{64}$/.test(String(v.extractedFrom.documentId||'')))g.extractedFrom={documentId:v.extractedFrom.documentId,at:text(v.extractedFrom.at,40)};
    const empty=!g.pictograms.length&&!g.signalWord&&!g.hCodes.length&&!g.pCodes.length&&!g.hazardClasses&&!g.source&&!g.msdsIssuedAt&&!g.msdsRevision&&!g.msdsReviewedAt&&!g.note;
    return empty?null:g;
  }
  function hasClassification(item){const g=item&&item.ghs;return !!g&&(g.pictograms?.length>0||!!g.signalWord||g.hCodes?.length>0);}
  function addMonths(iso,months){const d=new Date(iso+'T00:00:00');if(Number.isNaN(d.getTime()))return '';d.setMonth(d.getMonth()+months);const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;}
  // MSDS 비치·검토 상태. reviewMonths=0이면 검토 주기 관리를 끈다.
  function msdsStatus(item,reviewMonths,today){
    const attached=(item?.msdsDocuments||[]).length,g=item?.ghs||{},months=Number(reviewMonths)||0;
    const base=g.msdsReviewedAt||g.msdsIssuedAt||'';
    const result={attached,issuedAt:g.msdsIssuedAt||'',reviewedAt:g.msdsReviewedAt||'',nextReviewAt:'',state:'ok',label:'정상',days:null};
    if(!attached&&!hasClassification(item)){result.state='none';result.label='MSDS 미첨부';return result;}
    if(!attached){result.state='missing';result.label='MSDS 미첨부';}
    if(!months)return result;
    if(!base){if(result.state==='ok'){result.state='unset';result.label='검토일 미입력';}return result;}
    result.nextReviewAt=addMonths(base,months);
    const days=Math.round((new Date(result.nextReviewAt+'T00:00:00')-new Date(today+'T00:00:00'))/86400000);result.days=days;
    if(days<0){result.state='overdue';result.label=`검토기한 ${-days}일 경과`;}
    else if(days<=30&&result.state==='ok'){result.state='due-soon';result.label=`검토 D-${days}`;}
    return result;
  }
  function summaryText(item){const g=item?.ghs;if(!hasClassification(item))return '';return [g.signalWord?SIGNAL[g.signalWord]:'',g.pictograms.map(c=>PICTOGRAMS[c].label).join('·'),g.hCodes.join(' ')].filter(Boolean).join(' / ');}
  return {PICTOGRAMS,SIGNAL,H,P,H_ROWS,P_ROWS,parseCodes,normalizeCode,hText,pText,suggestFromH,normalizeGHS,hasClassification,msdsStatus,addMonths,summaryText};
});
