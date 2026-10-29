// Pages serves only the public transport boundary. Calendar logic stays in the
// bound Worker; no public Worker URL, token, or user settings enter logs here.
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const routes = new Set(['/api/subscriptions', '/healthz']);
const dynamicPath = path => routes.has(path) || path.startsWith('/api/') || path.startsWith('/calendar/');
const validRoute = path => routes.has(path) || /^\/api\/subscriptions\/[a-f0-9-]{36}$/.test(path) || /^\/calendar\/[A-Za-z0-9_-]{43}\.ics$/.test(path);
const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'}});

function protect(response, request, isAPI = false) {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  if (new URL(request.url).protocol === 'https:') headers.set('Strict-Transport-Security', 'max-age=31536000');
  if (isAPI) headers.set('Cache-Control', 'no-store');
  return new Response(request.method === 'HEAD' ? null : response.body, {status:response.status, headers});
}

async function readHealth(response) {
  const reader = response.body?.getReader();
  if (!reader || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Invalid health');
  let bytes = 0, text = ''; const decoder = new TextDecoder();
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4096) throw new Error('Oversize health');
      text += decoder.decode(value, {stream:true});
    }
    return JSON.parse(text + decoder.decode());
  } finally { await reader.cancel().catch(() => {}); }
}

export function createGateway(release) {
  return {async fetch(request, env) {
    const url = new URL(request.url), isAPI = url.pathname.startsWith('/api/');
    if (!dynamicPath(url.pathname)) return env.ASSETS.fetch(request);
    let result;
    try {
      const publicURL = new URL(env.PUBLIC_BASE_URL);
      const local = env.ALLOW_LOCAL_DEV === 'true' && LOOPBACK.has(url.hostname) && LOOPBACK.has(publicURL.hostname);
      if (publicURL.username || publicURL.password || publicURL.pathname !== '/' || publicURL.search || publicURL.hash ||
          (publicURL.protocol !== 'https:' && !(local && publicURL.protocol === 'http:'))) throw new Error('Invalid public origin');
      if (url.host !== publicURL.host) return protect(json({error:'此地址未启用订阅服务。'}, 404), request, isAPI);
      if (url.protocol !== 'https:' && !local) {
        result = ['GET','HEAD'].includes(request.method)
          ? new Response(null, {status:308, headers:{Location:publicURL.origin + url.pathname + url.search, 'Cache-Control':'no-store'}})
          : json({error:'请使用 HTTPS 地址保存日历设置。'}, 400);
        return protect(result, request, isAPI);
      }
      if (!validRoute(url.pathname)) return protect(json({error:'没有找到此页面。'}, 404), request, isAPI);
      if (!env.CALENDAR_SERVICE?.fetch) throw new Error('Missing binding');
      const health = url.pathname === '/healthz';
      if (health && !['GET','HEAD'].includes(request.method)) return protect(json({error:'不支持此操作。'},405),request);
      // No fetch to workers.dev. The original headers, body, client context and
      // conditional requests stay intact when crossing the Service Binding.
      result = await env.CALENDAR_SERVICE.fetch(health && request.method === 'HEAD' ? new Request(request, {method:'GET'}) : request);
      if (result.status >= 300 && result.status < 400 && result.status !== 304) {
        await result.body?.cancel(); throw new Error('Unexpected redirect');
      }
      if (health) {
        if (result.status !== 200) { await result.body?.cancel(); throw new Error('Backend unavailable'); }
        const backend = await readHealth(result);
        if (backend.status !== 'ok' || ['version','dataVersion','environment'].some(key => backend[key] !== release[key])) throw new Error('Version or environment mismatch');
        result = json({status:'ok', version:backend.version, dataVersion:backend.dataVersion, environment:backend.environment, gatewayVersion:release.version});
      } else if (result.status !== 204 && result.status !== 304) {
        // Preserve the body stream, but never forward a login/challenge/error
        // HTML document as a calendar or management response.
        const type = result.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase();
        const expected = !isAPI && result.ok ? 'text/calendar' : 'application/json';
        if (type !== expected) { await result.body?.cancel(); throw new Error('Unexpected response type'); }
      }
      return protect(result, request, isAPI);
    } catch {
      // Do not include exception text: runtime errors can contain capability URLs.
      return protect(json({error:'暂时无法连接订阅服务，请稍后重试。'},503),request,isAPI);
    }
  }};
}
