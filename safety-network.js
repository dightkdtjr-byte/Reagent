'use strict';
// Electron's Chromium network stack respects system proxy/PAC settings and TLS validation.
// No renderer-controlled URLs, automatic authentication, insecure TLS flags or shell commands.
const { failure, errorInfo } = require('./safety-errors');
function safeURL(raw, hosts) {
  let u;
  try { u = new URL(raw); } catch { throw failure('URL_NOT_ALLOWED', '자료 주소 형식이 올바르지 않습니다.', {stage:'주소 검사'}); }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || !(hosts instanceof Set) || !hosts.has(u.hostname))
    throw failure('URL_NOT_ALLOWED', '허용되지 않은 제조사 자료 주소입니다.', {stage:'주소 검사'});
  return u;
}
function createDownloader(netProvider) {
  return function download(raw, {hosts, maxBytes = 25 * 1024 * 1024, timeout = 30000} = {}) {
    return new Promise((resolve, reject) => {
      let req, timer, settled = false, ended = false, redirects = 0;
      const start = Date.now();
      const detail = {url:raw, stage:'서버 연결', transport:'Electron Chromium / system proxy', receivedBytes:0};
      function finish(error, result) {
        if (settled) return;
        settled = true; clearTimeout(timer);
        detail.elapsedMs = Date.now() - start;
        if (error) {
          error.diagnostic = errorInfo(error, detail);
          reject(error);
          try { req?.abort(); } catch {}
        } else { result.downloadInfo = {...detail}; resolve(result); }
      }
      function fail(code, message) { finish(failure(code, message, {...detail, elapsedMs:Date.now()-start})); }
      try {
        const u = safeURL(raw, hosts); detail.url = u.href;
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 25*1024*1024 || !Number.isFinite(timeout) || timeout < 1 || timeout > 120000)
          throw failure('INVALID_OPTIONS', '파일 수신 제한값이 잘못되었습니다.', {stage:'요청 준비'});
        const net = typeof netProvider === 'function' ? netProvider() : netProvider;
        if (!net?.request) throw failure('NETWORK_UNAVAILABLE', '앱의 다운로드 모듈을 사용할 수 없습니다.', {stage:'요청 준비'});
        req = net.request({method:'GET', url:u.href, redirect:'manual', credentials:'omit', useSessionCookies:false});
        req.setHeader('User-Agent', 'ReagentInventory/3.10.1 (MSDS download)');
        req.setHeader('Accept', 'application/pdf,image/svg+xml,*/*;q=0.1');
        timer = setTimeout(() => fail('ETIMEDOUT', '파일 다운로드 시간이 초과되었습니다.'), timeout);
        req.on('error', e => finish(e));
        req.on('abort', () => { if (!settled) fail('DOWNLOAD_ABORTED', '다운로드 요청이 중단되었습니다.'); });
        // Electron ClientRequest may emit 'close' after the request body is finished,
        // before the response stream has ended. That is not a download failure.
        // Completion is determined only from the response stream (end/aborted/error)
        // plus Content-Length verification below.
        req.on('login', (authInfo, callback) => {
          // Never ask for or log passwords here; an explicit failure is actionable and safer.
          fail(authInfo?.isProxy ? 'PROXY_AUTH_REQUIRED' : 'AUTH_REQUIRED', '다운로드에 인증이 필요합니다.');
          try { callback(); } catch {}
        });
        req.on('redirect', (status, method, target) => {
          if (settled) return;
          try {
            if (++redirects > 4) return fail('REDIRECT_LIMIT', '자료 주소 이동 횟수가 초과되었습니다.');
            detail.stage = '이동 주소 검사';
            const next = safeURL(new URL(target, detail.url).href, hosts);
            detail.url = next.href; detail.stage = '서버 연결';
            req.followRedirect();
          } catch (e) { finish(e); }
        });
        req.on('response', res => {
          if (settled) return;
          const header = key => {
            const val = res.headers?.[key] ?? res.headers?.[Object.keys(res.headers || {}).find(k=>k.toLowerCase()===key)];
            return Array.isArray(val) ? val[0] : val;
          };
          detail.httpStatus = Number(res.statusCode); detail.contentType = String(header('content-type') || '');
          detail.stage = '서버 응답';
          if (detail.httpStatus !== 200) return fail('HTTP_' + detail.httpStatus, `제조사 서버 응답 ${detail.httpStatus}`);
          const length = Number(header('content-length'));
          if (length > maxBytes) return fail('FILE_TOO_LARGE', '허용된 파일 크기를 초과했습니다.');
          const chunks = []; detail.stage = '파일 수신';
          res.on('error', e => finish(e));
          res.on('aborted', () => fail('DOWNLOAD_ABORTED', '다운로드가 중단되었습니다.'));
          res.on('close', () => { if (!ended && !settled) fail('INCOMPLETE_DOWNLOAD','파일을 끝까지 받지 못했습니다.'); });
          res.on('data', data => {
            if (settled) return;
            try {
              const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
              detail.receivedBytes += chunk.length;
              if (detail.receivedBytes > maxBytes) return fail('FILE_TOO_LARGE', '허용된 파일 크기를 초과했습니다.');
              chunks.push(chunk);
            } catch (e) { finish(e); }
          });
          res.on('end', () => {
            ended = true; if (settled) return;
            if (Number.isFinite(length) && length > 0 && !header('content-encoding') && length !== detail.receivedBytes)
              return fail('INCOMPLETE_DOWNLOAD', '서버가 표시한 파일 크기와 실제 수신 크기가 다릅니다.');
            finish(null, Buffer.concat(chunks));
          });
        });
        req.end();
      } catch (e) { finish(e); }
    });
  };
}
function download(raw, options) { return createDownloader(() => require('electron').net)(raw, options); }
module.exports = {createDownloader, download, safeURL};
