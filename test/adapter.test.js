import test from 'node:test';
import assert from 'node:assert/strict';
import { BlockAssembler } from '@deepseek-ai/dsh-llm';
import { NotionSubscriptionAdapter, apply } from '../src/index.js';
import { NOTION_ENDPOINT, NOTION_TRANSACTIONS_ENDPOINT } from '../src/options.js';
import { config, request, responseOf, collect, finalRecord, terminal } from './helpers.js';

function adapterWith(fetchFn, raw = config) { return new NotionSubscriptionAdapter(raw, { fetchFn, environment: {}, attribution: () => ({ 'x-dsh-test': 'attribution', 'user-agent': 'dsh/synthetic' }) }); }
const code = (expected) => (error) => error.code === expected;

test('wire request has attribution, credentials, fixed host and no redirect/retry', async () => {
  let calls = 0;
  const adapter = adapterWith(async (url, options) => {
    calls++;
    assert.equal(url, NOTION_ENDPOINT);
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['x-dsh-test'], 'attribution');
    assert.equal(options.headers['x-notion-space-id'], config.spaceId);
    assert.equal(options.headers['x-notion-active-user-header'], config.userId);
    assert.ok(options.headers['notion-client-version']);
    assert.ok(options.headers.cookie.startsWith('token_v2='));
    const body = JSON.parse(options.body);
    assert.equal(body.threadType, 'workflow');
    assert.equal(body.transcript[0].value.model, 'almond-croissant-low');
    return responseOf([finalRecord('你好', body.threadId), terminal]);
  });
  const chunks = await collect(adapter.stream(request));
  assert.equal(calls, 1);
  assert.equal(chunks.at(-1).reason.kind, 'stop');
  assert.equal(chunks.filter((chunk) => chunk.type === 'finish').length, 1);
  assert.ok(!chunks.some((chunk) => chunk.type === 'usage'));
  const assembler = new BlockAssembler();
  for (const chunk of chunks) assembler.push(chunk);
  assert.deepEqual(assembler.blocks(), [{ type: 'text', text: '你好' }]);
});
test('default stream-end route completes without a record map or terminal frame', async () => {
  const adapter = adapterWith(async () => responseOf([{ type: 'patch', v: [{ o: 'a', p: '/s/-', v: { type: 'text', value: [{ type: 'text', content: 'plain answer' }] } }] }]), { ...config, completionMode: 'stream-end', terminalType: '' });
  const chunks = await collect(adapter.stream(request));
  assert.equal(chunks.at(-1).reason.kind, 'stop');
});
test('disabled route advertises no models; active route advertises text-only metadata', async () => {
  assert.deepEqual(await adapterWith(() => {}, { ...config, enabled: false }).listModels(), []);
  const models = await adapterWith(() => {}).listModels();
  assert.equal(models.length, 36);
  assert.equal(models[0].provider, 'notion-subscription');
  assert.deepEqual(models[0].inputModalities, ['text']);
  assert.equal(models[0].context, undefined);
  assert.match(models.find((model) => model.id === 'gemini-3.1pro').description, /workflow/);
});
test('unknown model and unverified protocol fail before network IO', async () => {
  const fetchFn = () => { throw new Error('must not call'); };
  await assert.rejects(collect(adapterWith(fetchFn).stream({ ...request, model: 'invented' })), code('UNSUPPORTED_MODEL'));
  await assert.rejects(collect(adapterWith(fetchFn, { ...config, terminalType: '', completionMode: 'verified-marker' }).stream(request)), code('PROTOCOL_UNVERIFIED'));
});
test('markdown-chat model pre-creates its thread before streaming', async () => {
  const seen = [];
  const adapter = adapterWith(async (url, options) => {
    seen.push(url);
    if (url === NOTION_TRANSACTIONS_ENDPOINT) return new Response('{}', { status: 200 });
    assert.equal(JSON.parse(options.body).createThread, false);
    const body = JSON.parse(options.body);
    return responseOf([finalRecord('gemini answer', body.threadId, 'markdown-chat'), terminal]);
  }, { ...config, models: [{ id: 'gemini-3.1pro', upstreamModel: 'galette-medium-thinking', threadType: 'markdown-chat' }] });
  const text = (await collect(adapter.stream({ ...request, model: 'gemini-3.1pro' }))).filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text).join('');
  assert.equal(text, 'gemini answer');
  assert.deepEqual(seen, [NOTION_TRANSACTIONS_ENDPOINT, NOTION_ENDPOINT]);
});
test('failed thread pre-creation falls back to letting the request create it', async () => {
  let inferenceBody;
  const adapter = adapterWith(async (url, options) => {
    if (url === NOTION_TRANSACTIONS_ENDPOINT) return new Response('nope', { status: 500 });
    inferenceBody = JSON.parse(options.body);
    return responseOf([finalRecord('fallback', inferenceBody.threadId), terminal]);
  }, { ...config, models: [{ id: 'gemini-3.1pro', upstreamModel: 'galette-medium-thinking', threadType: 'markdown-chat' }] });
  await collect(adapter.stream({ ...request, model: 'gemini-3.1pro' }));
  assert.equal(inferenceBody.createThread, true);
  assert.equal(inferenceBody.isPartialTranscript, false);
});
test('prepared calls capture credential/model generation across live config changes', async () => {
  let active = { ...config, models: [{ id: 'test', name: 'Test', upstreamModel: 'old-model', threadType: 'workflow' }] };
  const adapter = adapterWith(async (_, options) => {
    assert.ok(options.headers.cookie.includes('synthetic-test-token'));
    assert.equal(JSON.parse(options.body).transcript[0].value.model, 'old-model');
    return responseOf([finalRecord('captured'), terminal]);
  }, () => active);
  const prepared = await adapter.prepareCall('notion-subscription', 'test');
  active = { ...active, cookie: 'new-test-token', models: [{ id: 'test', upstreamModel: 'new-model', threadType: 'workflow' }] };
  assert.equal((await collect(prepared.stream({ ...request, model: 'test' }))).at(-1).reason.kind, 'stop');
});
test('HTTP authentication, challenge/permission, limit and server failures are classified', async () => {
  for (const [status, expected] of [[401, 'AUTH'], [403, 'PERMISSION'], [429, 'RATE_LIMIT'], [503, 'SERVER'], [400, 'PROVIDER_ERROR']]) {
    let calls = 0;
    const adapter = adapterWith(async () => { calls++; return new Response('cookie=should-not-leak', { status }); });
    await assert.rejects(collect(adapter.stream(request)), (error) => error.code === expected && !error.message.includes('should-not-leak'));
    assert.equal(calls, 1);
  }
});
test('HTML and incomplete responses do not yield a successful finish', async () => {
  for (const response of [new Response('<html>verify</html>', { headers: { 'content-type': 'text/html' } }), responseOf([terminal])]) {
    const chunks = [];
    await assert.rejects(async () => { for await (const chunk of adapterWith(async () => response).stream(request)) chunks.push(chunk); }, (error) => ['PROTOCOL_ERROR', 'EMPTY_RESPONSE'].includes(error.code));
    assert.ok(!chunks.some((chunk) => chunk.type === 'finish'));
  }
});
test('preaborted request and body guard do not call fetch', async () => {
  const controller = new AbortController(); controller.abort();
  let called = false;
  const fetchFn = async () => { called = true; throw new Error('must not call'); };
  await assert.rejects(collect(adapterWith(fetchFn).stream({ ...request, signal: controller.signal })), code('ABORTED'));
  await assert.rejects(collect(adapterWith(fetchFn, { ...config, maxRequestBytes: 5 }).stream(request)), code('REQUEST_TOO_LARGE'));
  assert.equal(called, false);
});
test('total timeout aborts fetch and does not disclose transport errors', async () => {
  const fetchFn = (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('private transport detail')), { once: true }));
  await assert.rejects(collect(adapterWith(fetchFn, { ...config, timeoutMs: 10 }).stream(request)), code('TIMEOUT'));
  await assert.rejects(collect(adapterWith(async () => { throw new Error('secret detail'); }).stream(request)), (error) => error.code === 'TRANSPORT' && !error.message.includes('secret detail'));
});
test('tool bridge emits a declared tool call, never executes it', async () => {
  const reply = '```dsh-tool-call\n{"name":"read","arguments":{"file_path":"a"}}\n```';
  const adapter = adapterWith(async () => responseOf([finalRecord(reply), terminal]), { ...config, toolBridge: true });
  const chunks = await collect(adapter.stream({ ...request, tools: [{ name: 'read', parameters: { type: 'object' } }] }));
  assert.equal(chunks.at(-1).reason.kind, 'tool-calls');
  assert.ok(!chunks.some((chunk) => chunk.type === 'text-delta'));
  const assembler = new BlockAssembler();
  for (const chunk of chunks) assembler.push(chunk);
  assert.equal(assembler.blocks()[0].name, 'read');
});
test('bridge rejects undeclared names before producing any tool-call chunk', async () => {
  const adapter = adapterWith(async () => responseOf([finalRecord('```dsh-tool-call\n{"name":"delete","arguments":{}}\n```'), terminal]), { ...config, toolBridge: true });
  const chunks = [];
  await assert.rejects(async () => { for await (const chunk of adapter.stream({ ...request, tools: [{ name: 'read' }] })) chunks.push(chunk); }, code('INVALID_TOOL_ARGUMENTS'));
  assert.deepEqual(chunks, []);
});
test('host apply registers only its own routes and observes volatile updates', () => {
  let replaced = 0;
  const listeners = new Map();
  const ctx = {
    fiber: { entry: { options: { id: 'custom-notion-entry' } } },
    llm: {
      registerConfigurableProviders(entries) { assert.equal(entries[0].settingsNs, 'custom-notion-entry'); assert.equal(entries[0].provider, 'notion-subscription'); },
      registerAdapter(ids, adapter) { assert.deepEqual(ids, ['notion-subscription']); assert.ok(adapter instanceof NotionSubscriptionAdapter); return Object.assign(() => {}, { replace() { replaced++; } }); },
    },
    on(event, listener) { listeners.set(event, listener); },
    webServer: { register(entry) { assert.equal(entry.kind, 'exact'); assert.equal(entry.path, '/api/dsh-notion-subscription/quota'); assert.equal(typeof entry.handler, 'function'); return () => {}; } },
    inject(names, callback) {
      if (names[0] === 'webServer') { callback({ webServer: ctx.webServer, effect: (fn) => { fn(); } }); return; }
      assert.deepEqual(names, ['settings']); callback({ settings: { configure: (options) => assert.equal(options.auto, false) }, effect: (fn) => fn() });
    },
  };
  apply(ctx, config);
  listeners.get('loader/volatile-update')();
  assert.equal(replaced, 1);
});
