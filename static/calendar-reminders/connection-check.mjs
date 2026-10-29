// A browser-side reachability check, never proof that a calendar subscribed or
// delivered a notification. No management credentials or cookies are sent.
export async function checkSubscriptionConnection({apiBaseUrl, feedUrl, fetchImpl = globalThis.fetch,
  timeoutMs = 10000, signal, now = () => new Date()} = {}) {
  let base, feed;
  const result = (state, code, message) => ({state, code, message, checkedAt: now().toISOString()});
  try {
    base = new URL(apiBaseUrl); feed = new URL(feedUrl);
    const local = base.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(base.hostname);
    if ((!local && base.protocol !== 'https:') || base.username || base.password ||
      base.pathname !== '/' || base.search || base.hash || feed.origin !== base.origin ||
      feed.username || feed.password || feed.search || feed.hash ||
      !/^\/calendar\/[A-Za-z0-9_-]{43}\.ics$/.test(feed.pathname)) throw new Error();
  } catch { return result('error', 'address', '订阅地址与当前服务不一致。请重新打开本网站的管理链接后检查。'); }
  const controller = new AbortController();
  let expired = false;
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, {once:true});
  if (signal?.aborted) cancel();
  const timer = setTimeout(() => { expired = true; cancel(); }, timeoutMs);
  const options = {signal:controller.signal, credentials:'omit', cache:'no-store', redirect:'error', referrerPolicy:'no-referrer'};
  async function readBounded(response, limit) {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('invalid');
    const decoder = new TextDecoder(); let length = 0, text = '';
    const abortReader = () => { void reader.cancel().catch(() => {}); };
    controller.signal.addEventListener('abort', abortReader, {once:true});
    try {
      while (true) {
        if(controller.signal.aborted) throw new Error('aborted');
        const {done, value} = await reader.read();
        if(controller.signal.aborted) throw new Error('aborted');
        if (done) break;
        length += value.byteLength;
        if (length > limit) { await reader.cancel(); throw new Error('invalid'); }
        text += decoder.decode(value, {stream:true});
      }
      return text + decoder.decode();
    } finally { controller.signal.removeEventListener('abort',abortReader); reader.releaseLock(); }
  }
  try {
    if(controller.signal.aborted) throw new Error('aborted');
    const health = await fetchImpl(new URL('/healthz', base).href, {...options, headers:{Accept:'application/json'}});
    if (!health.ok) return result('error', 'service', '订阅服务暂时不可用。请稍后重试检查。');
    let status;
    try { status = JSON.parse(await readBounded(health, 16384)); }
    catch (error) { if (controller.signal.aborted) throw error; return result('error', 'format', '服务返回的信息不完整。请稍后重试检查。'); }
    if (status.status !== 'ok') return result('error', 'service', '订阅服务尚未就绪。请稍后重试检查。');
    const response = await fetchImpl(feed.href, {...options, headers:{Accept:'text/calendar'}});
    if (!response.ok) return result('error', 'feed', response.status === 404 ? '未找到这份日历。请检查管理链接，或稍后重试。' : '服务可连接，但日历暂时无法读取。请稍后重试检查。');
    if (!/^text\/calendar(?:\s*;|$)/i.test(response.headers.get('Content-Type') || '')) {
      return result('error', 'format', '返回内容不是日历文件。请稍后重试，或使用文件导入。');
    }
    let body;
    try { body = (await readBounded(response, 2 * 1024 * 1024)).trim(); }
    catch(error) { if(controller.signal.aborted) throw error; return result('error','format','日历文件无法完整读取。请重试检查，或使用文件导入。'); }
    if (!/^BEGIN:VCALENDAR\r?\n/.test(body) || !/\r?\nEND:VCALENDAR$/.test(body) || !/(?:^|\n)VERSION:2\.0\r?(?:\n|$)/.test(body)) {
      return result('error', 'format', '日历文件内容不完整。请重试检查，或使用文件导入。');
    }
    return result('ok', 'connected', '本网页已读取到日历内容；请继续在日历应用中添加并确认日程。');
  } catch {
    if (signal?.aborted) return result('cancelled', 'cancelled', '');
    return result('error', expired ? 'timeout' : 'network', expired
      ? '本次连接检查超时。可切换 Wi-Fi 或移动网络后重试；订阅地址已保留。'
      : '本次未能连接日历服务。请检查网络后重试；也可以复制地址或使用文件导入。');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
