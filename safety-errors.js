'use strict';
// Local diagnostic data only. Never include HTTP headers, cookies or proxy credentials.
const TEXT_LIMIT = 1800;
function publicURL(raw) {
  try { const u = new URL(raw); return u.protocol === 'https:' ? u.origin + u.pathname : ''; } catch { return ''; }
}
function text(value, limit = TEXT_LIMIT) {
  return String(value ?? '').replace(/https?:\/\/[^\s"'<>]+/g, publicURL).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').slice(0, limit);
}
function errorInfo(error, context = {}) {
  const old = error?.diagnostic || {};
  const raw = String(error?.message || error || '알 수 없는 오류');
  const code = String(old.code || error?.code || (raw.match(/\bERR_[A-Z0-9_]+\b/) || [])[0] || context.code || 'UNKNOWN');
  const status = Number(old.httpStatus || error?.httpStatus || context.httpStatus) || null;
  let message = raw, hint = '아래 오류 코드와 내용을 복사해 확인하세요. 이 오류만으로 PC나 서버 중 어느 쪽 문제인지 단정할 수 없습니다.';
  if (/NAME_NOT_RESOLVED|EAI_AGAIN|ENOTFOUND|DNS/.test(code)) {
    message = '제조사 서버의 인터넷 주소를 찾지 못했습니다.';
    hint = 'DNS 또는 네트워크 연결 단계의 오류입니다. 원문 주소 열기에서도 같은 현상이 있는지 비교할 수 있습니다.';
  } else if (/PROXY|TUNNEL/.test(code) || status === 407) {
    message = '인터넷 중계 서버(프록시)에 연결하거나 인증하지 못했습니다.';
    hint = '앱은 운영체제의 프록시 설정을 사용합니다. 조직의 연결·인증 정책 확인이 필요한 상태이며, 보안 설정은 우회하지 않았습니다.';
  } else if (/CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) {
    message = '보안 인증서를 확인하지 못해 다운로드를 중단했습니다.';
    hint = 'PC 날짜·인증서·조직의 HTTPS 검사 환경과 관련될 수 있습니다. 인증서 검증을 끄거나 무시하지 마세요.';
  } else if (/TIMED_OUT|TIMEOUT|ETIMEDOUT/.test(code)) {
    message = '정해진 시간 안에 파일 수신이 끝나지 않았습니다.';
    hint = '서버 응답 지연 또는 연결 문제일 수 있습니다. 잠시 후 해당 자료만 다시 시도할 수 있습니다.';
  } else if (status === 403) {
    message = '제조사 서버가 다운로드 요청을 거부했습니다. (HTTP 403)';
    hint = '접근 정책·네트워크 제한 등으로 거부된 응답입니다. 원문 주소 열기로 서버 안내를 확인할 수 있습니다. 재고 연결은 변경하지 않았습니다.';
  } else if (status === 404 || status === 410) {
    message = `제조사 서버에서 원문 파일을 찾을 수 없습니다. (HTTP ${status})`;
    hint = '원문 주소가 변경되었거나 파일이 내려갔을 수 있습니다. 이 자료의 주소를 재검토해야 합니다.';
  } else if (status === 401) {
    message = '제조사 서버가 로그인을 요구했습니다. (HTTP 401)';
    hint = '공개 PDF 대신 인증이 필요한 응답이 왔습니다. 앱은 로그인 정보나 저장된 쿠키를 임의로 전송하지 않습니다.';
  } else if (status === 429) {
    message = '제조사 서버의 요청 횟수 제한에 걸렸습니다. (HTTP 429)';
    hint = '반복해서 누르지 말고 서버 제한이 풀린 뒤 다시 시도하세요. 다른 품목이 같은 문서를 쓰면 이번 실행에서는 중복 요청하지 않습니다.';
  } else if (status >= 500) {
    message = `제조사 서버에서 오류 응답을 보냈습니다. (HTTP ${status})`;
    hint = '서버 또는 중계 구간의 일시적 오류일 수 있습니다. 나중에 해당 자료만 다시 받을 수 있습니다.';
  } else if (code === 'INVALID_PDF') {
    message = 'PDF 대신 다른 형식의 응답을 받았습니다. 문서를 연결하지 않았습니다.';
    hint = '로그인·안내·오류 웹페이지일 수 있습니다. 확장자가 PDF여도 실제 내용이 PDF가 아니면 저장하지 않습니다.';
  } else if (code === 'FILE_TOO_LARGE') {
    message = '다운로드 파일이 허용된 크기를 초과했습니다.';
    hint = 'MSDS PDF는 25 MB, GHS 그림문자는 150 KB까지만 받습니다. 기존 첨부는 유지됩니다.';
  } else if (/EACCES|EPERM|FILE_ACCESS_DENIED|ACCESS_DENIED/.test(code)) {
    message = '파일을 저장하거나 읽을 권한이 없어 처리하지 못했습니다.';
    hint = '사용자 데이터 폴더 접근 또는 파일 잠금 상태를 확인해야 합니다. 기존 재고와 첨부를 삭제하지 마세요.';
  } else if (/ENOSPC|DISK_FULL/.test(code)) {
    message = '저장 공간이 부족해 파일을 보관하지 못했습니다.';
    hint = '데이터가 저장되는 드라이브의 여유 공간이 필요합니다. 기존 백업을 일괄 삭제하지 마세요.';
  } else if (/CONNECTION|ECONN|INTERNET_DISCONNECTED|NETWORK|ABORTED|INCOMPLETE/.test(code)) {
    message = '다운로드 연결이 끊기거나 파일이 끝까지 수신되지 않았습니다.';
    hint = '네트워크·프록시·서버 상태 중 어느 구간에서 중단됐는지 확인이 필요합니다. 불완전한 파일은 연결하지 않았습니다.';
  } else if (code === 'URL_NOT_ALLOWED' || code === 'REDIRECT_LIMIT') {
    message = code === 'URL_NOT_ALLOWED' ? '허용된 제조사 주소 밖으로 이동하려는 요청을 중단했습니다.' : '제조사 주소 이동 횟수가 한도를 초과했습니다.';
    hint = '다운로드 주소 변경 여부를 검토해야 합니다. 다른 서버로 자동 우회하지 않았습니다.';
  }
  return {
    at: old.at || new Date().toISOString(), code: text(code, 100),
    message: text(message), hint: text(old.hint || hint), nativeMessage: text(old.nativeMessage || raw),
    stage: text(old.stage || context.stage || '자료 연결', 100),
    url: publicURL(old.url || context.url), httpStatus: status,
    transport: text(old.transport || context.transport || '', 100),
    receivedBytes: Number(old.receivedBytes ?? context.receivedBytes) || 0,
    elapsedMs: Number(old.elapsedMs ?? context.elapsedMs) || 0,
    contentType: text(old.contentType || context.contentType || '', 160)
  };
}
function failure(code, message, context = {}) {
  const e = new Error(message); e.code = code;
  e.diagnostic = errorInfo(e, context); return e;
}
module.exports = { errorInfo, failure, publicURL };
