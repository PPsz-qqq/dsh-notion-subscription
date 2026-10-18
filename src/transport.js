import { NotionError } from './options.js';
import { buildRequest, buildThreadCreationPayload } from './messages.js';
import { readNotionStream } from './stream.js';
import { notionHeaders } from './http.js';

export function requestHeaders(options, attribution = {}) {
  return {...notionHeaders({...options,attribution,accept:'application/x-ndjson'}),
    'x-notion-space-id':options.spaceId,'x-notion-active-user-header':options.userId,'notion-audit-log-platform':'web'};
}

function httpError(response) {
  const status = response.status;
  if (status === 401) return new NotionError('Notion 登录态失效；请在自己的浏览器重新登录后更新 Cookie。', 'AUTH');
  if (status === 403) return new NotionError('Notion 拒绝请求：可能是工作区/模型权限不足或验证挑战。本插件不会绕过验证，请回 Notion 网页检查。', 'PERMISSION');
  if (status === 429) return new NotionError('Notion 限流或 AI 额度不足；请在 Notion 检查使用额度后再试。', 'RATE_LIMIT');
  if (status >= 500) return new NotionError(`Notion 服务暂不可用（HTTP ${status}）。`, 'SERVER');
  return new NotionError(`Notion 拒绝请求（HTTP ${status}）；请核对模型 ID、客户端版本和网页请求格式。`, 'PROVIDER_ERROR');
}

// markdown-chat threads must exist before runInferenceTranscript is called with
// createThread:false; notion2api pre-creates them in saveTransactions and falls
// back to letting the request create one when pre-creation fails.
export async function precreateThread(options, threadId, threadType, { fetchFn = globalThis.fetch, attribution = {}, signal, uuid } = {}) {
  const body = JSON.stringify(buildThreadCreationPayload(options, threadId, threadType, uuid));
  try {
    const response = await fetchFn(options.transactionsEndpoint, {
      method: 'POST', headers: requestHeaders(options, attribution), body, signal, redirect: 'error',
    });
    return response.ok;
  } catch {
    // Credential-independent failure: the caller degrades to createThread:true.
    return false;
  }
}

export async function* streamNotion(options, request, model, { fetchFn = globalThis.fetch, attribution = {}, uuid, capture } = {}) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new NotionError('请求超时。', 'TIMEOUT')), options.timeoutMs);
  const signal = request.signal ? AbortSignal.any([request.signal, timeout.signal]) : timeout.signal;
  let response;
  try {
    if (signal.aborted) throw new NotionError('Notion 请求已取消。', 'ABORTED');
    const payload = buildRequest(options, request, model, uuid);
    if (payload.threadType === 'markdown-chat' && options.precreateThread) {
      const created = await precreateThread(options, payload.threadId, payload.threadType, { fetchFn, attribution, signal, uuid });
      if (!created) {
        payload.createThread = true;
        payload.isPartialTranscript = false;
      }
    }
    const body = JSON.stringify(payload);
    if (Buffer.byteLength(body, 'utf8') > options.maxRequestBytes) throw new NotionError('请求超过本地安全大小上限；请压缩对话或调高 maxRequestBytes。此上限不是 Notion 公布的上下文限制。', 'REQUEST_TOO_LARGE');
    response = await fetchFn(options.endpoint, {
      method: 'POST', headers: requestHeaders(options, attribution), body, signal,
      // Never forward session cookies to a redirect target, including a login URL.
      redirect: 'error',
    });
    if (!response.ok) throw httpError(response);
    const contentType = response.headers.get('content-type') ?? '';
    if (/text\/html/i.test(contentType)) throw new NotionError('Notion 返回了网页而不是 AI 数据流；可能需要重新登录或完成网页验证。', 'PROTOCOL_ERROR');
    const frames = [];
    const headers = requestHeaders(options, attribution);
    const source = readNotionStream(response.body, {
      signal, transcript: payload.transcript, threadId: payload.threadId,
      completionMode: options.completionMode,
      terminalType: options.terminalType, terminalPath: options.terminalPath, terminalValue: options.terminalValue,
      idleTimeoutMs: options.idleTimeoutMs, firstByteTimeoutMs: options.timeoutMs, maxResponseBytes: options.maxResponseBytes,
      onFrame: capture ? (frame) => frames.push(frame) : undefined,
    });
    try {
      yield* source;
    } finally {
      // Recorded after the stream settles so a failure still leaves evidence.
      if (capture) await capture.record('inference', { requestBody: payload, headers, frames });
    }
  } catch (error) {
    if (signal.aborted) {
      if (timeout.signal.aborted && error instanceof NotionError && error.code === 'TIMEOUT') throw error;
      throw new NotionError(timeout.signal.aborted ? 'Notion 等待服务器响应已到请求总时限。' : 'Notion 请求已取消。', timeout.signal.aborted ? 'TIMEOUT' : 'ABORTED');
    }
    if (error instanceof NotionError) throw error;
    // No raw response, URL, cookie, or cause chain is put into logs or chat.
    throw new NotionError('无法连接 Notion；请检查网络和网页服务状态。', 'TRANSPORT');
  } finally {
    clearTimeout(timer);
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
  }
}
