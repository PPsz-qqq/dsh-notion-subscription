import { NOTION_HOSTS, NotionError } from './options.js';
export function notionHeaders({ cookie, host, clientVersion = '', attribution = {}, accept = 'application/json' }) {
  const safe = Object.fromEntries(Object.entries(attribution).filter(([key]) => !['cookie','authorization','proxy-authorization','origin','referer','content-type'].includes(key.toLowerCase())));
  return { 'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36', ...safe,
    'content-type':'application/json', accept, cookie, origin:'https://' + host, referer:'https://' + host + '/ai',
    ...(clientVersion ? {'notion-client-version':clientVersion} : {}) };
}
function abortError(signal, timeout) { return new NotionError(timeout.aborted && !signal?.aborted ? 'Notion 请求超时。' : 'Notion 请求已取消。', timeout.aborted && !signal?.aborted ? 'TIMEOUT' : 'ABORTED'); }
export async function fetchNotionJson(endpoint, { cookie, host, clientVersion, attribution, body = {}, fetchFn = globalThis.fetch, signal, timeoutMs = 20000, maxResponseBytes = 8 * 1024 * 1024 } = {}) {
  let url;
  try { url = new URL(endpoint); } catch { throw new NotionError('Notion 请求地址无效。','INVALID_CONFIG'); }
  host ??= url.hostname;
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !NOTION_HOSTS.includes(url.hostname) || url.hostname !== host) throw new NotionError('Notion 请求地址不在允许范围内。','INVALID_CONFIG');
  const timeout = new AbortController();
  const combined = signal ? AbortSignal.any([signal,timeout.signal]) : timeout.signal;
  const timer = setTimeout(()=>timeout.abort(),timeoutMs);
  let reader, cancel;
  try {
    if (combined.aborted) throw abortError(signal,timeout.signal);
    const response = await fetchFn(endpoint,{method:'POST',headers:notionHeaders({cookie,host,clientVersion,attribution}),body:JSON.stringify(body),signal:combined,redirect:'error'});
    if (!response.ok) {
      await response.body?.cancel().catch(()=>{});
      const code = response.status === 401 ? 'AUTH' : response.status === 403 ? 'PERMISSION' : response.status === 429 ? 'RATE_LIMIT' : 'PROVIDER_ERROR';
      throw new NotionError('Notion 请求失败（HTTP ' + response.status + '）；请检查登录状态、权限或额度。',code);
    }
    if (!response.body?.getReader) throw new NotionError('Notion 返回了无效 JSON 响应。','PROTOCOL_ERROR');
    reader=response.body.getReader(); cancel=()=>{ void reader.cancel().catch(()=>{}); };
    combined.addEventListener('abort',cancel,{once:true});
    const decoder=new TextDecoder(); let text='',bytes=0;
    for (;;) {
      if(combined.aborted) throw abortError(signal,timeout.signal);
      const item=await reader.read();
      if(combined.aborted) throw abortError(signal,timeout.signal);
      if(item.done) break;
      bytes+=item.value.byteLength;
      if(bytes>maxResponseBytes) throw new NotionError('Notion JSON 响应超过本地大小上限。','RESPONSE_TOO_LARGE');
      text+=decoder.decode(item.value,{stream:true});
    }
    text+=decoder.decode();
    try { return JSON.parse(text); } catch { throw new NotionError('Notion 返回了非 JSON 响应；请在网页检查登录或验证状态。','PROTOCOL_ERROR'); }
  } catch(error) {
    if(combined.aborted) throw abortError(signal,timeout.signal);
    if(error instanceof NotionError) throw error;
    const code=['ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOTFOUND'].includes(error?.cause?.code) ? '（' + error.cause.code + '）' : '';
    throw new NotionError('无法连接 ' + host + code + '；请检查网络或代理后重试。','TRANSPORT');
  } finally {
    clearTimeout(timer);
    if(cancel) combined.removeEventListener('abort',cancel);
    if(reader) { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
  }
}
