'use strict';
// MSDS/SDS 본문 텍스트에서 GHS 정보를 읽어낸다. 영문·한글 서식을 모두 다루며, 결과는 사용자가 확인한 뒤 저장한다.
(function(root,factory){const api=factory(typeof require==='function'?require('./ghs-data'):root.GHSData);if(typeof module==='object'&&module.exports)module.exports=api;else root.GHSExtract=api;})(typeof window==='object'?window:globalThis,function(D){
  const SEC2=/(?:^|\n)[ \t]*(?:section|sec\.?|제)?[ \t]*2[ \t]*[.:：)\]]?[ \t]*(?:[.:：-]\s*)?(?:hazards?\s+identification|hazard\(s\)\s+identification|유해성\s*[·ㆍ・,]?\s*위험성|유해\s*위험성|위험\s*유해성)/i;
  const SEC3=/(?:^|\n)[ \t]*(?:section|sec\.?|제)?[ \t]*3[ \t]*[.:：)\]]?[ \t]*(?:[.:：-]\s*)?(?:composition|information\s+on\s+ingredients|구성\s*성분|성분의?\s*명칭)/i;
  const PICTO_WORDS=[
    ['GHS03',/flame\s*over\s*circle|원\s*위의?\s*화염|원형\s*화염|산화성\s*(?:물질)?\s*그림/i],
    ['GHS01',/exploding\s*bomb|폭발하는\s*폭탄|폭탄/i],
    ['GHS02',/\bflame\b|화염|불꽃/i],
    ['GHS04',/gas\s*cylinder|가스\s*실린더|고압\s*가스/i],
    ['GHS05',/\bcorrosion\b|corrosive|부식성?/i],
    ['GHS06',/skull\s*(?:and|&)?\s*crossbones|해골/i],
    ['GHS07',/exclamation\s*mark|느낌표|감탄\s*부호/i],
    ['GHS08',/health\s*hazard|건강\s*유해성?/i],
    ['GHS09',/\benvironment(?:al)?\b|환경\s*(?:유해성?)?/i]
  ];
  const MONTHS={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12};
  const p2=n=>String(n).padStart(2,'0');
  function toISO(y,m,d){y=Number(y);m=Number(m);d=Number(d);if(y<100)y+=2000;if(!(y>=1990&&y<=2100&&m>=1&&m<=12&&d>=1&&d<=31))return '';return `${y}-${p2(m)}-${p2(d)}`;}
  function parseDate(s){
    s=String(s||'').trim();let m;
    if((m=s.match(/(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/)))return toISO(m[1],m[2],m[3]);
    if((m=s.match(/(\d{1,2})[-\s/]([A-Za-z]{3,9})\.?[-\s/,]+(\d{4})/)))return toISO(m[3],MONTHS[m[2].slice(0,3).toLowerCase()]||0,m[1]);
    if((m=s.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/)))return toISO(m[3],MONTHS[m[1].slice(0,3).toLowerCase()]||0,m[2]);
    // 점(.)으로 나눈 날짜는 유럽식 일.월.년(Sigma, Merck 등), 빗금(/)은 미국식 월/일/년으로 본다. 둘 중 하나만 가능하면 그쪽을 따른다.
    if((m=s.match(/(\d{1,2})([./-])(\d{1,2})[./-](\d{4})/))){const a=Number(m[1]),b=Number(m[3]);if(a>12)return toISO(m[4],b,a);if(b>12)return toISO(m[4],a,b);return m[2]==='/'?toISO(m[4],a,b):toISO(m[4],b,a);}
    return '';
  }
  const DATE_TOKEN='((?:\\d{4}\\s*[-./년]\\s*\\d{1,2}\\s*[-./월]\\s*\\d{1,2})|(?:\\d{1,2}[-\\s/][A-Za-z]{3,9}\\.?[-\\s/,]+\\d{4})|(?:[A-Za-z]{3,9}\\.?\\s+\\d{1,2},?\\s+\\d{4})|(?:\\d{1,2}[./-]\\d{1,2}[./-]\\d{4}))';
  function findDate(text,labels){
    const re=new RegExp('(?:'+labels+')\\s*[:：]?\\s*\\n?\\s*'+DATE_TOKEN,'i');const m=text.match(re);return m?parseDate(m[1]):'';
  }
  function codes(text,kind){
    const re=kind==='H'?/\b(?:EU)?H\s?(\d{3}[FDfd]{0,2}|\d{3}A)((?:\s*\+\s*(?:EU)?H\s?\d{3}[FDfd]{0,2})*)/g:/\bP\s?(\d{3})((?:\s*\+\s*P\s?\d{3})*)/g;
    const map=kind==='H'?D.H:D.P,out=[];
    for(const m of text.matchAll(re)){
      const raw=D.normalizeCode(m[0]);
      const parts=raw.split('+');
      if(!parts.every(p=>map.has(p)))continue; // 사전에 없는 번호는 오인식으로 본다 (예: 제품코드)
      if(!out.includes(raw))out.push(raw);
    }
    return out;
  }
  function signalWord(text){
    let m=text.match(/signal\s*words?\s*[^\n:：]{0,20}[:：]?\s*\n?\s*(danger|warning|no\s+signal\s+word|none|not\s+applicable)/i);
    if(m){const v=m[1].toLowerCase();return v.startsWith('danger')?'Danger':v.startsWith('warning')?'Warning':'None';}
    m=text.match(/신호어\s*[^\n:：]{0,12}[:：]?\s*\n?\s*(위험|경고|해당\s*없음|없음)/);
    if(m)return m[1]==='위험'?'Danger':m[1]==='경고'?'Warning':'None';
    return '';
  }
  function pictograms(section){
    const found=[];
    // 'GHS02' 같은 코드가 글자로 적힌 경우만 확정으로 본다.
    for(const m of section.matchAll(/\bGHS\s?0([1-9])\b/gi)){const c='GHS0'+m[1];if(!found.includes(c))found.push(c);}
    if(found.length)return {codes:found,how:'explicit'};
    // 이름(화염·해골 등)은 '그림문자' 항목 바로 다음 짧은 줄에서만 찾는다. 뒤따르는 문장의 '환경', '부식' 같은 일반 단어는 보지 않는다.
    const m=section.match(/(?:pictograms?|그림\s*문자|심벌|symbols?)\s*[:：]?([\s\S]{0,300})/i);
    if(m){
      const lines=m[1].split(/\n/).map(l=>l.trim()).filter(Boolean).slice(0,3).filter(l=>l.length<=60&&!/^(?:신호어|signal|유해|hazard|H\d{3})/i.test(l));
      const near=lines.join('\n');
      for(const [code,re] of PICTO_WORDS){if(re.test(near)&&!found.includes(code))found.push(code);}
    }
    return {codes:found,how:found.length?'named':'none'};
  }
  function hazardClasses(section){
    const start=section.search(/classification\s+of\s+the\s+substance|GHS\s*classification|유해성\s*[·ㆍ・]?\s*위험성\s*분류|혼합물의\s*분류|물질의\s*분류|분류\s*[:：]|classification/i);
    if(start<0)return '';
    const body=section.slice(start,start+2500).split(/\n/).slice(1);
    const lines=[];
    for(const raw of body){
      const line=raw.replace(/\s+/g,' ').trim();if(!line)continue;
      if(/^(?:label\s+elements|pictogram|signal\s*word|hazard\s+statements?|precautionary|경고\s*표지|그림\s*문자|신호어|유해\s*[·ㆍ・]?\s*위험\s*문구|예방\s*조치)/i.test(line))break;
      if(/category|cat\.?\s*\d|구분\s*\d|class\s*\d|분류\s*\d|type\s+[a-g]\b/i.test(line)&&line.length<=120)lines.push(line);
      if(lines.length>=12)break;
    }
    // "Category 3   Respiratory irritation" 같은 세부 줄은 앞 줄에 붙은 설명이므로 제외
    return lines.filter(l=>!/^category\s*\d/i.test(l)).join('; ').slice(0,500);
  }
  function extract(text){
    const t=String(text||'').replace(/\r/g,'').replace(/[\u00a0\t]+/g,' ');
    const s2=t.search(SEC2);let section='',sectioned=false;
    if(s2>=0){const rest=t.slice(s2+1);const s3=rest.search(SEC3);section=s3>0?rest.slice(0,s3):rest.slice(0,15000);sectioned=true;}
    else section=t.slice(0,20000);
    const hCodes=codes(section,'H'),pCodes=codes(section,'P');
    let signal=signalWord(section)||signalWord(t);
    const picto=pictograms(section);
    const suggested=D.suggestFromH(hCodes);
    // 우선순위: 글자로 적힌 GHS 코드 > H코드에서 유도 > 이름 단어. H코드가 있으면 이름 단어는 쓰지 않는다 (오인식이 잦다).
    let pictos=picto.codes,pictoHow=picto.how;
    if(pictoHow!=='explicit'&&hCodes.length){pictos=suggested.pictograms;pictoHow='from-h';}
    if(!signal&&hCodes.length){signal=suggested.signalWord;}
    const issuedAt=findDate(t,'revision\\s*date|date\\s*of\\s*(?:last\\s*)?revision|last\\s*revised|revised\\s*(?:on|date)?|개정\\s*일자?|최종\\s*개정일?|수정일')||findDate(t,'issue\\s*date|date\\s*of\\s*issue|issued|date\\s*prepared|preparation\\s*date|version\\s*date|작성\\s*일자?|제정일|발행일');
    const revM=t.match(/(?:revision\s*(?:number|no\.?|#)|version(?:\s*(?:number|no\.?))?|개정\s*(?:번호|차수|횟수)|버전)\s*[:：]?\s*(?:ver\.?|v\.?|rev\.?)?\s*([0-9]+(?:\.[0-9]+)*)/i);
    const revision=revM?revM[1].slice(0,20):'';
    const classes=hazardClasses(section);
    const found=hCodes.length>0||!!signal||pictos.length>0;
    return {ok:true,found,sectioned,textLength:t.length,hCodes,pCodes,signalWord:signal,pictograms:pictos,pictogramSource:pictoHow,hazardClasses:classes,issuedAt,revision,
      summary:[`H코드 ${hCodes.length}개`,`P코드 ${pCodes.length}개`,`신호어 ${signal?D.SIGNAL[signal]:'미확인'}`,`그림문자 ${pictos.length?pictos.join('·')+(pictoHow==='from-h'?' (H코드 기준)':pictoHow==='named'?' (이름으로 추정)':''):'미확인'}`,issuedAt?`작성·개정일 ${issuedAt}`:'작성·개정일 미확인',sectioned?'2절 범위에서 추출':'절 구분을 찾지 못해 문서 앞부분에서 추출'].join(' · ')};
  }
  return {extract,parseDate};
});
