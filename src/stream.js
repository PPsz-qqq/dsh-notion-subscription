import { NotionError } from './options.js';

// Segment roles follow pdxjie/notion2api app/stream_parser.py. Native tool and
// search segments are SKIPPED, never fatal: Notion AI performs web search as a
// normal built-in capability, so failing the whole call on it would reject
// ordinary answers. Titles and reasoning are dropped; everything else is answer
// text. agent-inference counts as CONTENT on purpose — it is where Notion's
// Opus/GPT drafts land, and notion2api's final-content pass treats it as a body
// candidate rather than as hidden reasoning.
const TOOL_TYPES = ['agent-tool-result', 'tool_use', 'tool', 'search', 'web', 'citation', 'connector'];
const TOOL_PATTERN = new RegExp(TOOL_TYPES.join('|'));
const THINKING_PATTERN = /reasoning|thinking/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const lower = (value) => String(value ?? '').trim().toLowerCase();

function roleOf(step) {
  const type = lower(step?.type);
  if (['title', 'config', 'context', 'user', 'agent-instruction-state', 'agent-turn-full-record-map', 'agent-turn-start'].includes(type)) return 'meta';
  if (type === 'markdown-chat' || type === 'agent-inference') return 'content';
  if (type && TOOL_PATTERN.test(type)) return 'tool';
  if (type && THINKING_PATTERN.test(type)) return 'thinking';
  return 'content';
}

// --- Notion markup leakage ---------------------------------------------------
// Notion copies stray <lang primary="zh-CN"> wrappers into answer text and the
// chunks split them anywhere. Cleaning re-runs over the whole snapshot on every
// frame, so a half-arrived tag is held back instead of emitted: emitting it
// would break the append-only prefix invariant the moment the tag completes.
const LANGS = ['<lang', '</lang>'];
const PARTIAL_TAGS = new Set(LANGS.flatMap((tag) => Array.from({ length: tag.length }, (_, i) => tag.slice(0, i + 1))));
const RE_LANG_OPEN = /<lang\b[^>]*>/g;
const RE_LANG_CLOSE = /<\/lang>/g;
const RE_PRIMARY_ATTR = /\bprimary="[A-Za-z-]{1,15}"\s*/g;
const RE_PRIMARY_DANGLING = /\bprimary="/;
const RE_ATTR_TAIL = /^-?[A-Za-z]{0,4}"\s*>\s*/;

function splitUnstableTail(raw) {
  const at = raw.lastIndexOf('<');
  if (at === -1) return { stable: raw, tail: '' };
  const rest = raw.slice(at);
  const incomplete = PARTIAL_TAGS.has(rest) || /^<lang(?:\s|$)[^>]*$/.test(rest);
  return incomplete ? { stable: raw.slice(0, at), tail: rest } : { stable: raw, tail: '' };
}

export function cleanNotionText(raw) {
  const { stable } = splitUnstableTail(typeof raw === 'string' ? raw : '');
  let text = stable.replace(RE_LANG_OPEN, '').replace(RE_LANG_CLOSE, '').replace(RE_PRIMARY_ATTR, '');
  // A cut-off primary="... attribute can leak without its surrounding tag.
  const dangling = RE_PRIMARY_DANGLING.exec(text);
  if (dangling) text = text.slice(0, dangling.index);
  return text.replace(RE_ATTR_TAIL, '');
}

// --- Snapshot extraction -----------------------------------------------------
function valueItems(value) {
  if (!Array.isArray(value)) return '';
  const parts = [];
  for (const item of value) {
    if (typeof item === 'string') { parts.push(item); continue; }
    if (!isRecord(item) || lower(item.type) !== 'text') continue;
    if (typeof item.content === 'string') parts.push(item.content);
    else if (typeof item.text === 'string') parts.push(item.text);
  }
  return parts.join('');
}

function markdownChatText(value, depth = 0) {
  if (depth > 24) throw new NotionError('响应内容嵌套过深。', 'PROTOCOL_ERROR');
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((item) => {
    if (typeof item === 'string') return item;
    if (Array.isArray(item)) return typeof item[0] === 'string' ? item[0] : '';
    if (!isRecord(item) || roleOf(item) !== 'content') return '';
    if (lower(item.type) === 'text' && typeof item.content === 'string') return item.content;
    return item.value === undefined ? '' : markdownChatText(item.value, depth + 1);
  }).join('');
  if (isRecord(value)) {
    if (roleOf(value) !== 'content') return '';
    for (const key of ['value', 'content', 'text']) {
      if (key in value) {
        const nested = markdownChatText(value[key], depth + 1);
        if (nested) return nested;
      }
    }
  }
  return '';
}

function segmentText(step, depth = 0) {
  if (depth > 24) throw new NotionError('响应内容嵌套过深。', 'PROTOCOL_ERROR');
  const value = step.value ?? step.content;
  if (lower(step.type) === 'markdown-chat') return markdownChatText(value);
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return valueItems(value);
  if (isRecord(value)) {
    if (roleOf(value) !== 'content') return '';
    for (const key of ['value', 'content', 'text']) {
      if (key in value) {
        const nested = segmentText({ ...step, value: value[key] }, depth + 1);
        if (nested) return nested;
      }
    }
  }
  return '';
}

// Only segments the stream generated are answer text. The seeded transcript is
// part of the same patch root, so history turns must be sliced off first or a
// previous assistant reply would be re-emitted as this reply.
function outputOf(segments, base = 0) {
  const parts = [];
  for (const step of segments.slice(base)) {
    if (!isRecord(step)) continue;
    // Skip tool/search/meta segments; only content types contribute text.
    if (roleOf(step) !== 'content') continue;
    const text = segmentText(step);
    if (text) parts.push(text);
  }
  return cleanNotionText(parts.join('\n\n'));
}

// --- Final record map (notion2api _extract_final_content_from_record_map) -----
// Priorities decide which step is the answer when several exist: a body
// (markdown-chat/text) always beats an agent-inference draft, and a title is
// never returned as an answer.
const STEP_PRIORITY = { 'markdown-chat': 400, text: 350, 'agent-inference': 300, title: 50 };
const HIGH_PRIORITY_TYPES = new Set(['text', 'markdown-chat']);

export function recordMapPick(frame, threadId) {
  const messages = frame?.recordMap?.thread_message;
  if (!isRecord(messages)) return null;
  const candidates = [];
  for (const [messageId, message] of Object.entries(messages)) {
    if (!isRecord(message) || !isRecord(message.value)) continue;
    const outer = message.value;
    const inner = outer.value;
    if (!isRecord(inner) || !isRecord(inner.step) || inner.step.type === undefined) continue;
    if (roleOf(inner.step) !== 'content') continue;
    const text = cleanNotionText(segmentText(inner.step)).trim();
    if (!text) continue;
    const owner = inner.thread_id ?? outer.thread_id;
    candidates.push({
      messageId,
      stepType: lower(inner.step.type),
      text,
      sameThread: !owner || !threadId || owner === threadId,
      priority: STEP_PRIORITY[lower(inner.step.type)] ?? 100,
      createdAt: Number(outer.created_time ?? 0) || 0,
      editedAt: Number(outer.last_edited_time ?? 0) || 0,
    });
  }
  if (!candidates.length) return null;
  // Prefer this request's own thread, but never come back empty when Notion
  // tagged the record with a different or missing thread id.
  const inThread = candidates.filter((candidate) => candidate.sameThread);
  let pool = inThread.length ? inThread : candidates;
  if (pool.some((candidate) => HIGH_PRIORITY_TYPES.has(candidate.stepType))) {
    pool = pool.filter((candidate) => HIGH_PRIORITY_TYPES.has(candidate.stepType));
  }
  pool.sort((a, b) => b.priority - a.priority || b.editedAt - a.editedAt || b.createdAt - a.createdAt || b.text.length - a.text.length);
  return pool[0];
}

export function recordMapText(frame, threadId) {
  return recordMapPick(frame, threadId)?.text ?? '';
}

// --- Patch application -------------------------------------------------------
const INDEX = /^(0|[1-9]\d*)$/;
const DIAGNOSTIC_KEYS = new Set(['s', 'value', 'content', 'text', 'type']);
const valueType = (value) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;

function patchPath(patch) {
  const field = ['path', 'p', 'pointer', 'at'].find((key) => Object.hasOwn(patch, key));
  const raw = field === undefined ? undefined : patch[field];
  let path;
  if (Array.isArray(raw)) {
    if (raw.some((part) => typeof part !== 'string' && !(Number.isSafeInteger(part) && part >= 0))) {
      throw new NotionError('Notion patch 路径元素无效。', 'PROTOCOL_ERROR');
    }
    path = raw.map(String);
  } else if (typeof raw === 'string') {
    const parts = raw.replace(/^\//, '').split('/');
    if (parts.some((part) => /~(?![01])/.test(part))) throw new NotionError('Notion patch 路径转义无效。', 'PROTOCOL_ERROR');
    path = parts.map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  }
  if (!path?.length || path.length > 32 || path[0] === '' || path.some((key) => FORBIDDEN_KEYS.has(key))) {
    throw new NotionError('Notion 返回了不受支持的 patch 路径。', 'PROTOCOL_ERROR');
  }
  return path;
}

function arrayIndex(parent, key, allowEnd = false, path = []) {
  const index = key === '-' && allowEnd ? parent.length : INDEX.test(key) ? Number(key) : NaN;
  if (!Number.isSafeInteger(index) || index < 0 || index >= 0xffffffff || index > parent.length || (!allowEnd && index === parent.length)) {
    const safePath = '/' + path.map((part) => DIAGNOSTIC_KEYS.has(part) || /^(0|[1-9]\d{0,5})$/.test(part) ? part : '*').join('/');
    const safeIndex = /^(?:[0-9]{1,6}|-)$/.test(key) ? key : '*';
    throw new NotionError('Notion patch 数组下标无效（path=' + safePath + '; index=' + safeIndex + '; length=' + parent.length + '）。', 'PROTOCOL_ERROR');
  }
  return index;
}

function appendError(path, target, value) {
  // Keep diagnostics useful without exposing text, IDs or provider-owned keys.
  const safePath = '/' + path.map((part) => DIAGNOSTIC_KEYS.has(part) || /^(0|[1-9]\d{0,5})$/.test(part) ? part : '*').join('/');
  return new NotionError(`Notion 追加文本 patch 无效（op=x; path=${safePath}; target=${valueType(target)}; value=${valueType(value)}）。`, 'PROTOCOL_ERROR');
}

function applyPatch(root, patch) {
  const path = patchPath(patch);
  if (!['a', 'p', 'x', 'r'].includes(patch.o)) throw new NotionError('Notion patch 操作已变化；请检查脱敏后的网页响应样例。', 'PROTOCOL_ERROR');
  let parent = root;
  for (const key of path.slice(0, -1)) {
    if (parent === null || typeof parent !== 'object' || !Object.hasOwn(parent, key)) throw new NotionError('Notion patch 引用了未知段落。', 'PROTOCOL_ERROR');
    if (Array.isArray(parent)) arrayIndex(parent, key, false, path);
    parent = parent[key];
  }
  const key = path.at(-1);
  if (parent === null || typeof parent !== 'object') throw new NotionError('Notion patch 容器无效。', 'PROTOCOL_ERROR');
  if (patch.o === 'r') {
    if (!Object.hasOwn(parent, key)) throw new NotionError('Notion 删除 patch 引用了未知字段。', 'PROTOCOL_ERROR');
    const index = Array.isArray(parent) ? arrayIndex(parent, key, false, path) : undefined;
    if (index !== undefined) parent.splice(index, 1);
    else delete parent[key];
    return { path, index };
  }
  if (patch.o === 'x') {
    if (Array.isArray(parent)) arrayIndex(parent, key, false, path);
    const current = Object.hasOwn(parent, key) ? parent[key] : undefined;
    const textLeaf = !Array.isArray(parent) && (key === 'content' || key === 'text' || (key === 'value' && typeof parent.type === 'string'));
    // Some streams introduce a typed block before sending its first text field.
    const previous = current == null && textLeaf ? '' : current;
    if (typeof previous !== 'string' || typeof patch.v !== 'string') throw appendError(path, current, patch.v);
    parent[key] = previous + patch.v;
    return;
  }
  let value = structuredClone(patch.v);
  const segment = path[0] === 's' && (path.length === 2 || (path.length === 4 && path[2] === 'value'));
  if (segment && isRecord(value) && typeof patch.type === 'string' && patch.type) value.type = patch.type;
  if (Array.isArray(parent)) {
    const index = arrayIndex(parent, key, patch.o === 'a', path);
    if (patch.o === 'a') parent.splice(index, 0, value);
    else parent[index] = value;
    return { path, index };
  } else parent[key] = value;
}

function errorCode(frame) {
  const error = frame.error ?? frame;
  const detail = `${error.code ?? error.errorCode ?? ''} ${error.message ?? ''}`.toLowerCase();
  if (/quota|credit|allowance|usage.limit|balance/.test(detail)) return 'QUOTA';
  if (/rate.limit|too.many/.test(detail)) return 'RATE_LIMIT';
  if (/unauth|token|login/.test(detail)) return 'AUTH';
  if (/permission|forbidden/.test(detail)) return 'PERMISSION';
  if (/context.*(exceed|limit|long)/.test(detail)) return 'CONTEXT_WINDOW_EXCEEDED';
  return 'PROVIDER_ERROR';
}

export class NotionStreamState {
  constructor({ transcript = [], threadId, completionMode = 'stream-end', terminalType = '', terminalPath = '', terminalValue = '' } = {}) {
    this.root = { s: structuredClone(transcript) };
    this.base = Array.isArray(transcript) ? transcript.length : 0;
    this.threadId = threadId;
    this.completionMode = completionMode;
    this.terminalType = terminalType;
    this.terminalPath = terminalPath;
    this.terminalValue = terminalValue;
    this.text = '';
    this.finalSeen = false;
    this.terminalSeen = false;
    this.patchStarted = false;
    this.patched = false;
  }
  adopt(cleaned) {
    if (!cleaned && !this.text) return '';
    if (!cleaned.startsWith(this.text)) throw new NotionError('Notion 重写了已经输出的文本；为避免重复或误导，当前响应被标为失败。', 'PROTOCOL_ERROR');
    const delta = cleaned.slice(this.text.length);
    this.text = cleaned;
    return delta;
  }
  // The record map is authoritative. A truncation of what already streamed is
  // accepted as confirmation only; a rewrite cannot be retracted from the
  // user's transcript, so it fails closed instead of editing history.
  adoptAuthoritative(cleaned) {
    if (!cleaned || this.text.startsWith(cleaned)) return '';
    return this.adopt(cleaned);
  }
  consume(frame) {
    if (!isRecord(frame)) throw new NotionError('Notion 流帧不是 JSON 对象。', 'PROTOCOL_ERROR');
    if (frame.error || frame.type === 'error' || frame.type === 'failure') {
      throw new NotionError('Notion 在流中报告错误；请检查登录状态、模型权限或额度。', errorCode(frame));
    }
    if (frame.type === 'patch-start') {
      if (this.patchStarted || this.patched || this.text || !isRecord(frame.data) || !Array.isArray(frame.data.s) || frame.data.s.some((step) => !isRecord(step))) {
        throw new NotionError('Notion patch-start 初始化状态无效或顺序异常。', 'PROTOCOL_ERROR');
      }
      if (frame.version !== undefined && frame.version !== 1) throw new NotionError('Notion patch 协议版本不受支持。', 'PROTOCOL_ERROR');
      // Server state is independent of the outgoing config/context/history array.
      this.root = structuredClone(frame.data);
      this.base = this.root.s.length;
      this.patchStarted = true;
      return '';
    }
    if (this.terminalType && frame.type === this.terminalType) {
      let status = frame;
      if (this.terminalPath) {
        for (const key of this.terminalPath.slice(1).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))) {
          status = status !== null && typeof status === 'object' && Object.hasOwn(status, key) ? status[key] : undefined;
        }
      }
      if (!this.terminalPath || status === this.terminalValue) this.terminalSeen = true;
    }
    if (frame.type === 'patch') {
      this.patched = true;
      if (!Array.isArray(frame.v)) throw new NotionError('Notion patch 帧无效。', 'PROTOCOL_ERROR');
      let completeSegment = false;
      for (const patch of frame.v) {
        if (!isRecord(patch)) throw new NotionError('Notion patch 项无效。', 'PROTOCOL_ERROR');
        // A whole markdown-chat segment arrives as a single append, not as deltas.
        const mutation = applyPatch(this.root, patch);
        if (patch.o === 'a' && mutation?.path.length === 2 && mutation.path[0] === 's' && lower(patch.type ?? patch.v?.type) === 'markdown-chat') completeSegment = true;
        if (mutation?.path.length === 2 && mutation.path[0] === 's' && mutation.index < this.base) {
          if (patch.o === 'a') this.base++;
          if (patch.o === 'r') this.base--;
        }
      }
      if (!Array.isArray(this.root.s)) throw new NotionError('Notion patch 段落列表无效。', 'PROTOCOL_ERROR');
      const delta = this.adopt(outputOf(this.root.s, this.base));
      if (completeSegment) this.finalSeen = true;
      return delta;
    }
    if (frame.type === 'record-map') {
      const picked = recordMapPick(frame, this.threadId);
      if (picked) this.finalSeen = true;
      return this.adoptAuthoritative(picked?.text ?? '');
    }
    if (frame.type === 'markdown-chat') {
      const text = cleanNotionText(markdownChatText(frame.value));
      if (text) this.finalSeen = true;
      return this.adoptAuthoritative(text);
    }
    // Known source variants use rich-text snapshots without a type.
    if (frame.type === undefined && Array.isArray(frame.value)) return this.adopt(cleanNotionText(valueItems(frame.value)));
    // Metadata and unknown frames are never promoted to answer text or completion.
    return '';
  }
  finish() {
    if (!this.text.trim()) throw new NotionError('Notion 没有返回可见正文；请核对网页协议、模型 ID 和客户端版本。', 'EMPTY_RESPONSE');
    // stream-end mirrors notion2api: a closed stream with visible text is a
    // complete answer, and a short or absent final record never truncates it.
    if (this.completionMode === 'verified-marker' && !this.terminalSeen) throw new NotionError('响应结束但未匹配已确认的正常结束帧；可能断流或协议变化。', 'PROTOCOL_ERROR');
    if (this.completionMode === 'final-record' && !this.finalSeen) throw new NotionError('响应在收到最终记录前结束；可能断流或协议变化。', 'PROTOCOL_ERROR');
  }
}

function abortError(signal, bytes) {
  const timedOut = signal?.reason?.code === 'TIMEOUT';
  const message = timedOut
    ? bytes === 0 ? 'Notion 等待首段响应数据已到请求总时限。' : 'Notion 请求已到总时限（已接收 ' + bytes + ' 字节）。'
    : 'Notion 请求已取消。';
  return new NotionError(message, timedOut ? 'TIMEOUT' : 'ABORTED');
}

export async function* readNotionStream(body, { signal, idleTimeoutMs = 60000, firstByteTimeoutMs = idleTimeoutMs, maxResponseBytes = 32 * 1024 * 1024, onFrame, ...stateOptions } = {}) {
  if (!body?.getReader) throw new NotionError('Notion 响应没有可读流。', 'PROTOCOL_ERROR');
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const state = new NotionStreamState(stateOptions);
  let buffer = '', bytes = 0, reachedEnd = false;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  const consumeLine = (line) => {
    if (!line.trim()) return '';
    let frame;
    try { frame = JSON.parse(line); } catch { throw new NotionError('Notion 返回了无效 NDJSON；请检查是否为登录页或验证页。', 'PROTOCOL_ERROR'); }
    // Frames are collected only when a capture sink asked for them.
    if (onFrame) onFrame(frame);
    return state.consume(frame);
  };
  try {
    for (;;) {
      if (signal?.aborted) throw abortError(signal, bytes);
      let timer;
      const waitMs = bytes === 0 ? firstByteTimeoutMs : idleTimeoutMs;
      const idle = new Promise((_, reject) => {
        timer = setTimeout(() => {
          const message = bytes === 0 ? 'Notion 等待首段响应数据超时。' : 'Notion 响应流长时间没有数据（已接收 ' + bytes + ' 字节）。';
          reject(new NotionError(message, 'TIMEOUT'));
          cancel();
        }, waitMs);
      });
      let item;
      try { item = await Promise.race([reader.read(), idle]); } finally { clearTimeout(timer); }
      if (signal?.aborted) throw abortError(signal, bytes);
      if (item.done) {
        reachedEnd = true;
        buffer += decoder.decode();
        if (buffer.trim()) { const delta = consumeLine(buffer); if (delta) yield delta; }
        break;
      }
      bytes += item.value.byteLength;
      if (bytes > maxResponseBytes) throw new NotionError('Notion 响应超过本地安全大小上限。', 'RESPONSE_TOO_LARGE');
      buffer += decoder.decode(item.value, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end).replace(/\r$/, '');
        buffer = buffer.slice(end + 1);
        const delta = consumeLine(line);
        if (delta) yield delta;
      }
    }
    state.finish();
  } catch (error) {
    if (signal?.aborted) throw abortError(signal, bytes);
    if (error instanceof NotionError) throw error;
    throw new NotionError('Notion 响应中断或编码无效。', 'TRANSPORT');
  } finally {
    signal?.removeEventListener('abort', cancel);
    if (!reachedEnd) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
