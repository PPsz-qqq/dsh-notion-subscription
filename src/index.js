import { NotionQuotaReader, registerQuotaRoute } from './quota.js';
import z from '@deepseek-ai/schemastery';
import { LlmAdapter, LlmError, attributionHeaders, resolveRetryPolicy } from '@deepseek-ai/dsh-llm';
import { DEFAULT_MODELS, PLUGIN_ID, PROVIDER_ID, NotionError, modelInfo, normalizeCookie, resolveOptions } from './options.js';
import { parseToolReply } from './messages.js';
import { streamNotion } from './transport.js';
import { discoverIdentity } from './discovery.js';
import { CaptureSink } from './capture.js';
import { fetchAvailableModels, mergeCatalog, offlineCatalog } from './catalog.js';

export const name = PLUGIN_ID;
export const inject = ['llm'];
export const Config = z.object({
  enabled: z.boolean().default(false).description('阅读风险说明后启用 Notion 网页 AI 实验线路。').volatile(),
  cookie: z.string().role('secret').default('').description('自己的 token_v2 或单行完整 Cookie；只写不回显，profile 持久化不等于加密。').volatile(),
  cookieEnv: z.string().default('NOTION_COOKIE').description('Cookie 为空时使用的环境变量名。').volatile(),
  notionHost: z.union([z.const('app.notion.com'), z.const('www.notion.so')]).default('app.notion.com').description('Notion API 请求域名；浏览器 Cookie 的域规则不限制本插件显式发送的请求头，连通性取决于当前网络。').volatile(),
  autoDiscover: z.boolean().default(true).description('只填 Cookie 即自动识别工作区与用户 id；关闭后需手动填 spaceId 与 userId。').volatile(),
  spaceId: z.string().default('').description('本人有权限的 Notion 工作区 UUID；自动识别关闭时必填，可用 NOTION_SPACE_ID。').volatile(),
  userId: z.string().default('').description('x-notion-active-user-header；自动识别关闭时必填，可用 NOTION_USER_ID。').volatile(),
  clientVersion: z.string().default('').description('notion-client-version；留空使用随包的内置版本，过期后请从本人网页请求更新。').volatile(),
  autoModels: z.boolean().default(true).description('按账号自动刷新可用模型；失败时显示离线快照。关闭后仅使用手动列表。').volatile(),
  defaultReasoningEffort: z.string().default('').description('留空跟随模型；会话选择优先。统一默认值仅对支持该档位的模型生效。').volatile(),
  models: z.array(z.object({
    id: z.string().required(),
    name: z.string().default(''),
    upstreamModel: z.string().default(''),
    threadType: z.string().default('').description('留空默认 workflow；仅在确认兼容时显式覆盖。'),
    reasoningEffort: z.string().default(''),
    supportedReasoningEfforts: z.array(z.string()),
    defaultReasoningEffort: z.string(),
    contextWindow: z.number().min(1).step(1),
  })).default(DEFAULT_MODELS.map(({ id, name, upstreamModel }) => ({ id, name, upstreamModel }))).volatile(),
  toolBridge: z.boolean().default(false).description('实验性 JSON 文本工具桥接，非原生 Function Calling；默认纯聊天。').volatile(),
  createThread: z.boolean().default(true).description('workflow 由请求自带创建 Notion 聊天记录。').volatile(),
  precreateThread: z.boolean().default(true).description('markdown-chat 请求前先建线程；失败会自动改为由请求创建。').volatile(),
  captureDir: z.string().default('').description('本地诊断目录，留空停用；过滤认证字段，但文件仍可能含完整对话和工作区资料，不要直接上传。').volatile(),
  completionMode: z.union([z.const('stream-end'), z.const('final-record'), z.const('verified-marker')]).default('stream-end').description('默认按 notion2api 的做法以数据流结束判定完成；final-record 要求最终记录，verified-marker 要求本人确认的结束帧。').volatile(),
  terminalType: z.string().default('').description('严格模式必需的正常结束帧 type；默认留空，不猜测。').volatile(),
  terminalPath: z.string().default('').description('可选：结束状态的 JSON Pointer，如 /status，需本人确认。').volatile(),
  terminalValue: z.string().default('').description('可选：该路径必须等于的字符串，需本人确认。').volatile(),
  timeoutMs: z.number().min(1).max(2147483647).step(1).default(120000).volatile(),
  idleTimeoutMs: z.number().min(1).max(2147483647).step(1).default(60000).volatile(),
  maxRequestBytes: z.number().min(1).step(1).default(8388608).description('本地安全上限，不是上游公布限制。').volatile(),
  maxResponseBytes: z.number().min(1).step(1).default(33554432).volatile(),
});

const NO_AUTOMATIC_RETRY = resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, `${PLUGIN_ID}.retry`);

export class NotionSubscriptionAdapter extends LlmAdapter {
  constructor(config = {}, dependencies = {}) {
    super();
    this.readConfig = typeof config === 'function' ? config : () => config;
    this.environment = dependencies.environment ?? process.env;
    this.fetchFn = dependencies.fetchFn ?? globalThis.fetch;
    this.attribution = dependencies.attribution ?? attributionHeaders;
  }
  providerInfo(provider) { return { id: provider, name: 'Notion AI（商业版订阅 · 实验性）' }; }
  providerRetryPolicy() { return NO_AUTOMATIC_RETRY; }
  async listModels(provider = PROVIDER_ID) {
    let options = resolveOptions(this.readConfig(), this.environment);
    if (!options.enabled) return [];
    let models = options.autoModels ? offlineCatalog(options.models) : options.models;
    if (options.autoModels) {
      try {
        options = resolveOptions(this.readConfig(), this.environment, true);
        if (options.autoDiscover) await this.resolveIdentity(options);
        models = await this.resolveCatalog(options);
      } catch {}
    }
    return models.map((model) => modelInfo(provider, model, options.toolBridge, options.defaultReasoningEffort));
  }
  async resolveCatalog(options, signal) {
    if (!options.autoModels) return options.models;
    const key = JSON.stringify([options.host, options.cookie, options.spaceId, options.userId]);
    if (!this.catalog || this.catalog.key !== key || this.catalog.expiresAt <= Date.now()) {
      try {
        const value = await fetchAvailableModels(options, { fetchFn:this.fetchFn, attribution:this.attribution(), signal });
        this.catalog = {key,value,expiresAt:Date.now()+5*60*1000};
      } catch(error) {
        if (signal?.aborted) throw error;
        this.catalog = {key,value:null,expiresAt:Date.now()+30000};
      }
    }
    return this.catalog.value ? mergeCatalog(this.catalog.value,options.models) : offlineCatalog(options.models);
  }
  async resolveModel(provider, id) {
    const options = resolveOptions(this.readConfig(), this.environment);
    const entries = options.enabled ? await this.listModels(provider) : (options.autoModels ? offlineCatalog(options.models) : options.models).map((m)=>modelInfo(provider, m, options.toolBridge, options.defaultReasoningEffort));
    const model = entries.find((entry) => entry.id === id);
    if (!model) throw new LlmError('该 Notion 模型不在当前可用目录中；请刷新并重新选择。', 'UNSUPPORTED_MODEL');
    return model;
  }
  async prepareCall(provider, id, signal) {
    if (signal?.aborted) throw new LlmError('请求已取消。', 'ABORTED');
    try {
      const options = resolveOptions(this.readConfig(), this.environment, true);
      const deadline = Date.now()+options.timeoutMs;
      if (options.autoDiscover) await this.resolveIdentity(options,signal);
      options.timeoutMs=Math.max(1,deadline-Date.now());
      options.models=await this.resolveCatalog(options,signal);
      if(Date.now()>=deadline) throw new NotionError('Notion 请求超时。','TIMEOUT');
      options.timeoutMs=deadline-Date.now();
      const model = options.models.find((entry)=>entry.id===id);
      if (!model) throw new NotionError('该 Notion 模型不在当前可用目录中；请刷新并重新选择。','UNSUPPORTED_MODEL');
      return {model:modelInfo(provider, model, options.toolBridge, options.defaultReasoningEffort),stream:(request)=>this.streamWith(options,model,request)};
    } catch(error) { throw this.llmError(error); }
  }
  async resolveIdentity(options,signal) {
    const key=JSON.stringify([options.host,options.rawCookie,options.spaceId,options.userId]);
    if(this.identity?.key===key && this.identity.expiresAt>Date.now()) { Object.assign(options,this.identity.value); return; }
    if(options.spaceId && options.userId) {
      const value={spaceId:options.spaceId,userId:options.userId,cookie:normalizeCookie(options.rawCookie,options.userId)};
      this.identity={key,value,expiresAt:Date.now()+5*60*1000}; Object.assign(options,value); return;
    }
    const identity=await discoverIdentity({cookie:options.rawCookie,endpoint:options.loadUserContentEndpoint,host:options.host,clientVersion:options.clientVersion,
      fetchFn:this.fetchFn,attribution:this.attribution(),signal,timeoutMs:Math.min(options.timeoutMs,20000),
      preferredSpaceId:options.spaceId || undefined,preferredUserId:options.userId || undefined});
    const value={spaceId:identity.spaceId,userId:identity.userId,cookie:normalizeCookie(options.rawCookie,identity.userId)};
    this.identity={key,value,expiresAt:Date.now()+5*60*1000};
    Object.assign(options,value);
  }
  async *stream(request) {
    const call = await this.prepareCall(request.provider ?? PROVIDER_ID, request.model, request.signal);
    yield* call.stream(request);
  }
  capture(options) {
    if (!options.captureDir) return undefined;
    return new CaptureSink({ enabled: true, directory: options.captureDir, cookie: options.cookie, maxBytes: options.maxRequestBytes + options.maxResponseBytes });
  }
  llmError(error) {
    if (error?.code === 'AUTH') { this.identity = undefined; this.catalog = undefined; }
    if (error instanceof LlmError) return error;
    return new LlmError(error instanceof NotionError ? error.message : 'Notion 插件发生内部错误。', error instanceof NotionError ? error.code : 'PROVIDER_ERROR');
  }
  async *streamWith(options, model, request) {
    const buffered = options.toolBridge && (request.tools?.length ?? 0) > 0;
    let text = '', opened = false;
    try {
      for await (const delta of streamNotion(options, request, model, {
        fetchFn: this.fetchFn,
        attribution: this.attribution(),
        capture: this.capture(options),
      })) {
        text += delta;
        if (buffered) continue;
        if (!opened) { opened = true; yield { type: 'block-start', index: 0, blockType: 'text' }; }
        yield { type: 'text-delta', index: 0, text: delta };
      }
      const tool = buffered ? parseToolReply(text, request.tools) : null;
      if (tool) {
        yield { type: 'block-start', index: 0, blockType: 'tool-call' };
        yield { type: 'tool-call-delta', index: 0, id: tool.id, name: tool.name, argumentsDelta: tool.arguments };
        yield { type: 'block-end', index: 0, block: tool };
        yield { type: 'finish', reason: { kind: 'tool-calls' } };
      } else {
        if (!opened) {
          yield { type: 'block-start', index: 0, blockType: 'text' };
          yield { type: 'text-delta', index: 0, text };
        }
        yield { type: 'block-end', index: 0, block: { type: 'text', text } };
        // Usage and model identities are not invented when Notion reports none.
        yield { type: 'finish', reason: { kind: 'stop' } };
      }
    } catch (error) { throw this.llmError(error); }
  }
}

export function apply(ctx, config) {
  const adapter = new NotionSubscriptionAdapter(() => config);
  const quota = new NotionQuotaReader({
    readOptions: () => resolveOptions(adapter.readConfig(), adapter.environment, false),
    resolveIdentity: (options, signal) => adapter.resolveIdentity(options, signal),
    fetchFn: adapter.fetchFn,
    onAuthFailure: () => { adapter.identity = undefined; adapter.catalog = undefined; },
  });
  ctx.inject(['webServer'], (child) => {
    child.effect(() => registerQuotaRoute(child, quota), `${PLUGIN_ID}: quota HTTP route`);
  });
  ctx.llm.registerConfigurableProviders([{
    provider: PROVIDER_ID,
    displayName: 'Notion AI（商业版订阅 · 实验性）',
    settingsNs: ctx.fiber.entry?.options.id ?? PLUGIN_ID,
    settingsPath: [],
  }]);
  const registration = ctx.llm.registerAdapter([PROVIDER_ID], adapter);
  // Configuration is resolved per prepared request, not cached across accounts.
  ctx.on('loader/volatile-update', () => { quota.invalidate(); registration.replace([PROVIDER_ID]); });
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber), `${PLUGIN_ID}: custom settings page`);
  });
}

export { PROVIDER_ID };
