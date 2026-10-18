import { reasoningConfiguration, reasoningInfo, normalizeEfforts } from './reasoning.js';
import { DEFAULT_MODEL_ID, MODEL_CATALOG, THREAD_TYPES, isGeminiRoute, threadTypeFor } from './models.js';

export const PROVIDER_ID = 'notion-subscription';
export const PLUGIN_ID = 'dsh-notion-subscription';
// Notion serves the same API on parallel hosts that do not redirect into each
// other, and cookies are host-scoped. A session minted on app.notion.com is
// never sent to www.notion.so, so the host must match the user's own browser.
export const NOTION_HOSTS = Object.freeze(['app.notion.com', 'www.notion.so']);
// Keep the legacy host selectable; reachability depends on the current network.
export const DEFAULT_NOTION_HOST = 'app.notion.com';
export const NOTION_ENDPOINT_PATH = '/api/v3/runInferenceTranscript';
export const NOTION_TRANSACTIONS_PATH = '/api/v3/saveTransactions';
export const NOTION_LOAD_USER_CONTENT_PATH = '/api/v3/loadUserContent';

export function endpointFor(host, path) {
  return `https://${host}${path}`;
}

export const NOTION_ENDPOINT = endpointFor(DEFAULT_NOTION_HOST, NOTION_ENDPOINT_PATH);
export const NOTION_TRANSACTIONS_ENDPOINT = endpointFor(DEFAULT_NOTION_HOST, NOTION_TRANSACTIONS_PATH);
// Captured by pdxie/notion2api and observed working there. It is a client build
// string, not an API version, and it will age: override it from your own requests.
export const DEFAULT_CLIENT_VERSION = '23.13.20260228.0625';
export const DEFAULT_MODELS = MODEL_CATALOG;

export const COMPLETION_MODES = Object.freeze(['stream-end', 'final-record', 'verified-marker']);

export class NotionError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'NotionError';
    this.code = code;
  }
}

export function plainConfig(config) {
  return Object.fromEntries(Object.entries(config ?? {}).map(([key, value]) => [
    key, value && typeof value.get === 'function' ? value.get() : value,
  ]));
}

function positiveInteger(value, fallback, field, maximum = 2147483647) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0 || result > maximum) {
    throw new NotionError(`${field} 必须为正整数，且不超过 ${maximum}。`, 'INVALID_CONFIG');
  }
  return result;
}

function cleanString(value, field) {
  if (value !== undefined && typeof value !== 'string') {
    throw new NotionError(`${field} 必须为字符串。`, 'INVALID_CONFIG');
  }
  return (value ?? '').trim();
}

function uuid(value, field, required) {
  const result = cleanString(value, field);
  if (!result && !required) return '';
  if (!result && required) throw new NotionError(`缺少 ${field}；可开启「自动识别工作区」只填 Cookie，或手动填写。`, 'MISSING_IDENTITY');
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(result)) {
    throw new NotionError(`请填写有效的 ${field}（Notion 请求里的 UUID）。`, 'INVALID_CONFIG');
  }
  return result;
}

/**
 * Build the Cookie header for a session whose active user is not yet known.
 * Discovery runs before the user id is resolved, so the raw value must still be
 * turned into a valid header here — sending a bare token_v2 value as the whole
 * header makes Notion see no token at all and answer 401.
 */
export function cookieHeader(raw) {
  const value = cleanString(raw, 'cookie');
  if (!value) throw new NotionError('请在设置中填写自己的 token_v2 / Cookie，或设置 NOTION_COOKIE。', 'MISSING_CREDENTIAL');
  if (/[^\x20-\x7e]/.test(value)) {
    throw new NotionError('Cookie 含有不能进入 HTTP 请求头的字符；请勿粘贴多行 cURL 或引号。', 'INVALID_CREDENTIAL');
  }
  if (/(?:^|;\s*)token_v2=/.test(value)) {
    const tokens = value.split(';').map((part) => part.trim()).filter((part) => part.startsWith('token_v2='));
    if (tokens.length !== 1 || !tokens[0].slice('token_v2='.length).trim()) {
      throw new NotionError('Cookie 必须含一个非空 token_v2。', 'INVALID_CREDENTIAL');
    }
    return value.split(';').map((part) => part.trim()).filter(Boolean).join('; ');
  }
  if (/[\s;"']/.test(value)) throw new NotionError('请填写原始 token_v2，或含 token_v2 的单行 Cookie。', 'INVALID_CREDENTIAL');
  return `token_v2=${value}`;
}

// Bind the active user explicitly, so a stale notion_user_id from another
// workspace in the pasted cookie cannot win.
export function normalizeCookie(raw, userId) {
  const cookie = cookieHeader(raw)
    .split(';').map((part) => part.trim()).filter((part) => part && !part.startsWith('notion_user_id=')).join('; ');
  return `${cookie}; notion_user_id=${userId}`;
}

function effortSetting(value, field) {
  const effort = cleanString(value, field);
  if (!effort || effort === 'auto') return '';
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(effort)) throw new NotionError(field + ' 不是有效思考档位。', 'INVALID_CONFIG');
  return effort;
}

export function resolveOptions(raw = {}, environment = process.env, requireCredentials = false) {
  const config = plainConfig(raw);
  const cookieEnv = cleanString(config.cookieEnv ?? 'NOTION_COOKIE', 'cookieEnv');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(cookieEnv)) throw new NotionError('cookieEnv 必须为有效环境变量名。', 'INVALID_CONFIG');
  const sourceModels = config.models ?? DEFAULT_MODELS;
  if (!Array.isArray(sourceModels) || sourceModels.length === 0) throw new NotionError('至少配置一个模型。', 'INVALID_CONFIG');
  const ids = new Set();
  const models = sourceModels.map((model) => {
    if (model === null || typeof model !== 'object') throw new NotionError('模型项必须为对象。', 'INVALID_CONFIG');
    const id = cleanString(model.id, 'model.id');
    if (!id || ids.has(id)) throw new NotionError('模型 ID 不得为空或重复。', 'INVALID_CONFIG');
    ids.add(id);
    const contextWindow = model.contextWindow === undefined ? undefined : positiveInteger(model.contextWindow, undefined, 'contextWindow');
    const upstreamModel = cleanString(model.upstreamModel, 'upstreamModel');
    const declared = cleanString(model.threadType, 'threadType');
    const known = MODEL_CATALOG.find(entry => entry.upstreamModel === upstreamModel);
    if (model.supportedReasoningEfforts !== undefined && (!Array.isArray(model.supportedReasoningEfforts) || normalizeEfforts(model.supportedReasoningEfforts).length !== new Set(model.supportedReasoningEfforts).size)) throw new NotionError('模型思考档位必须是有效字符串数组。', 'INVALID_CONFIG');
    if (declared && !THREAD_TYPES.includes(declared)) throw new NotionError(`threadType 只能是 ${THREAD_TYPES.join(' / ')}。`, 'INVALID_CONFIG');
    return {
      id,
      name: cleanString(model.name, 'model.name') || id,
      upstreamModel,
      ...reasoningConfiguration(model.supportedReasoningEfforts === undefined ? known : model),
      reasoningEffort: effortSetting(model.reasoningEffort, 'model.reasoningEffort'),
      threadType: declared || threadTypeFor(id, upstreamModel),
      gemini: isGeminiRoute(id, upstreamModel),
      ...(contextWindow === undefined ? {} : { contextWindow }),
    };
  });
  const completionMode = config.completionMode ?? 'stream-end';
  if (!COMPLETION_MODES.includes(completionMode)) throw new NotionError('completionMode 不受支持。', 'INVALID_CONFIG');
  const autoDiscover = config.autoDiscover !== false;
  for (const key of ['enabled', 'toolBridge', 'createThread', 'precreateThread', 'autoDiscover', 'autoModels']) {
    if (config[key] !== undefined && typeof config[key] !== 'boolean') throw new NotionError(`${key} 必须为布尔值。`, 'INVALID_CONFIG');
  }
  const host = cleanString(config.notionHost || environment.NOTION_HOST, 'notionHost') || DEFAULT_NOTION_HOST;
  if (!NOTION_HOSTS.includes(host)) {
    throw new NotionError(`notionHost 只能是 ${NOTION_HOSTS.join(' 或 ')}；请选择与你自己浏览器地址栏一致的域名。`, 'INVALID_CONFIG');
  }
  const options = {
    enabled: config.enabled === true,
    host,
    endpoint: endpointFor(host, NOTION_ENDPOINT_PATH),
    transactionsEndpoint: endpointFor(host, NOTION_TRANSACTIONS_PATH),
    loadUserContentEndpoint: endpointFor(host, NOTION_LOAD_USER_CONTENT_PATH),
    // With autoDiscover the ids are resolved from the cookie at call time, so
    // they are only required here when discovery is switched off.
    spaceId: uuid(config.spaceId || environment.NOTION_SPACE_ID, 'spaceId', requireCredentials && !autoDiscover),
    userId: uuid(config.userId || environment.NOTION_USER_ID, 'userId', requireCredentials && !autoDiscover),
    autoDiscover,
    clientVersion: cleanString(config.clientVersion || environment.NOTION_CLIENT_VERSION, 'clientVersion') || DEFAULT_CLIENT_VERSION,
    models,
    defaultReasoningEffort: effortSetting(config.defaultReasoningEffort, 'defaultReasoningEffort'),
    cookieEnv,
    autoModels: config.autoModels !== false,
    toolBridge: config.toolBridge === true,
    completionMode,
    terminalType: cleanString(config.terminalType, 'terminalType'),
    terminalPath: cleanString(config.terminalPath, 'terminalPath'),
    terminalValue: cleanString(config.terminalValue, 'terminalValue'),
    createThread: config.createThread !== false,
    precreateThread: config.precreateThread !== false,
    // Opt-in protocol capture: an empty value keeps the plugin silent on disk.
    captureDir: cleanString(config.captureDir, 'captureDir'),
    timeoutMs: positiveInteger(config.timeoutMs, 120000, 'timeoutMs'),
    idleTimeoutMs: positiveInteger(config.idleTimeoutMs, 60000, 'idleTimeoutMs'),
    maxRequestBytes: positiveInteger(config.maxRequestBytes, 8 * 1024 * 1024, 'maxRequestBytes'),
    maxResponseBytes: positiveInteger(config.maxResponseBytes, 32 * 1024 * 1024, 'maxResponseBytes'),
  };
  if (/[^\x20-\x7e]/.test(options.clientVersion)) throw new NotionError('clientVersion 含有不能进入请求头的字符。', 'INVALID_CONFIG');
  if (options.terminalPath && (!options.terminalPath.startsWith('/') || /~(?![01])/.test(options.terminalPath))) {
    throw new NotionError('terminalPath 必须为有效 JSON Pointer，或留空。', 'INVALID_CONFIG');
  }
  if (Boolean(options.terminalPath) !== Boolean(options.terminalValue)) throw new NotionError('terminalPath 与 terminalValue 必须一起填写或一起留空。', 'INVALID_CONFIG');
  if (requireCredentials) {
    if (!options.enabled) throw new NotionError('Notion 订阅线路已停用；请阅读风险说明后在设置中启用。', 'PROVIDER_DISABLED');
    if (options.completionMode === 'verified-marker' && !options.terminalType) throw new NotionError('严格模式需要本人确认的正常结束帧 type；请填写 terminalType，或改用默认的 stream-end 模式。', 'PROTOCOL_UNVERIFIED');
    const rawCookie = config.cookie || environment[cookieEnv];
    if (options.autoDiscover) {
      // The active user id is only known after discovery; normalizing now would
      // bind a placeholder user into the cookie, so keep the raw value and
      // finish normalizeCookie once the identity is resolved.
      // A valid header even before the user id is known: a bare token value
      // sent verbatim would carry no token_v2= and Notion would answer 401.
      options.rawCookie = cookieHeader(rawCookie);
    } else {
      options.cookie = normalizeCookie(rawCookie, options.userId);
    }
  }
  return options;
}

export function modelInfo(provider, model, toolBridge = false, defaultReasoningEffort) {
  const reasoning = reasoningInfo(model, defaultReasoningEffort);
  return {
    provider, id: model.id, name: model.name,
    description: `非官方 Notion 网页 AI（${model.threadType} 线程）；${model.source === 'live' ? '账号实时目录' : model.source === 'offline' ? '离线快照，未实时确认可用性' : '手动配置'}。${toolBridge ? '实验性文本工具桥接，非原生函数调用。' : '纯文本对话，不执行 DSH 工具。'}`,
    inputModalities: ['text'],
    ...(reasoning ? { reasoning } : {}),
    ...(model.contextWindow === undefined ? {} : { context: { contextWindow: model.contextWindow } }),
  };
}

export { DEFAULT_MODEL_ID };
