import test from 'node:test';
import assert from 'node:assert/strict';
import { NotionSubscriptionAdapter } from '../src/index.js';
import { resolveOptions, NOTION_HOSTS } from '../src/options.js';
import { discoverIdentity } from '../src/discovery.js';
import { requestHeaders } from '../src/transport.js';
import { config, request, responseOf, collect, finalRecord } from './helpers.js';

const code = (expected) => (error) => error.code === expected;
const base = { ...config, completionMode: 'stream-end' };

// The default is the host the current web client uses. www.notion.so still
// resolves but resets non-browser connections (measured 5/5 ECONNRESET).
test('host defaults to app.notion.com and derives every endpoint', () => {
  const options = resolveOptions(base, {});
  assert.equal(options.host, 'app.notion.com');
  assert.equal(options.endpoint, 'https://app.notion.com/api/v3/runInferenceTranscript');
  assert.equal(options.transactionsEndpoint, 'https://app.notion.com/api/v3/saveTransactions');
  assert.equal(options.loadUserContentEndpoint, 'https://app.notion.com/api/v3/loadUserContent');
});
test('the legacy host still works when explicitly selected', () => {
  const options = resolveOptions({ ...base, notionHost: 'www.notion.so' }, {});
  assert.equal(options.endpoint, 'https://www.notion.so/api/v3/runInferenceTranscript');
  assert.equal(requestHeaders({ ...options, cookie: 'token_v2=x' }).origin, 'https://www.notion.so');
});
test('app.notion.com moves every endpoint and the origin headers together', () => {
  const options = resolveOptions({ ...base, notionHost: 'app.notion.com' }, {});
  assert.equal(options.endpoint, 'https://app.notion.com/api/v3/runInferenceTranscript');
  assert.equal(options.transactionsEndpoint, 'https://app.notion.com/api/v3/saveTransactions');
  assert.equal(options.loadUserContentEndpoint, 'https://app.notion.com/api/v3/loadUserContent');
  const headers = requestHeaders({ ...options, cookie: 'token_v2=x' });
  assert.equal(headers.origin, 'https://app.notion.com');
  assert.equal(headers.referer, 'https://app.notion.com/ai');
});
test('an unknown host is refused instead of silently falling back', () => {
  for (const host of ['evil.example', 'notion.so', 'www.notion.so/path']) {
    assert.throws(() => resolveOptions({ ...base, notionHost: host }, {}), code('INVALID_CONFIG'));
  }
  assert.deepEqual([...NOTION_HOSTS], ['app.notion.com', 'www.notion.so']);
});
test('the configured host is used for inference requests, not the default', async () => {
  const seen = [];
  const adapter = new NotionSubscriptionAdapter({ ...base, notionHost: 'app.notion.com' }, {
    environment: {},
    fetchFn: async (url, options) => {
      seen.push(url);
      const body = JSON.parse(options.body);
      return responseOf([finalRecord('ok', body.threadId)]);
    },
  });
  await collect(adapter.stream(request));
  assert.deepEqual(seen, ['https://app.notion.com/api/v3/runInferenceTranscript']);
});
test('discovery calls the configured host and defaults to the shared one', async () => {
  let seen;
  const identity = { userId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', spaceId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
  const fetchFn = async (url) => { seen = url; return new Response(JSON.stringify({ recordMap: {
    notion_user: { [identity.userId]: { value: {} } }, space: { [identity.spaceId]: { value: {} } } } }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  await discoverIdentity({ cookie: 'token_v2=x', fetchFn });
  assert.equal(seen, 'https://app.notion.com/api/v3/loadUserContent');
  await discoverIdentity({ cookie: 'token_v2=x', fetchFn, endpoint: 'https://app.notion.com/api/v3/loadUserContent' });
  assert.equal(seen, 'https://app.notion.com/api/v3/loadUserContent');
});
test('autoDiscover uses the configured host for discovery and inference', async () => {
  const SPACE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const USER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const seen = [];
  const adapter = new NotionSubscriptionAdapter({ ...base, notionHost: 'app.notion.com', autoDiscover: true, spaceId: '', userId: '' }, {
    environment: {},
    fetchFn: async (url, options) => {
      seen.push(url);
      if (url.endsWith('loadUserContent')) {
        return new Response(JSON.stringify({ recordMap: { notion_user: { [USER]: { value: {} } }, space: { [SPACE]: { value: {} } } } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      const body = JSON.parse(options.body);
      assert.equal(body.spaceId, SPACE);
      return responseOf([finalRecord('ok', body.threadId)]);
    },
  });
  await collect(adapter.stream(request));
  assert.deepEqual(seen, ['https://app.notion.com/api/v3/loadUserContent', 'https://app.notion.com/api/v3/runInferenceTranscript']);
});
test('every discovery request carries browser origin headers', async () => {
  let headers;
  const fetchFn = async (_url, options) => {
    headers = options.headers;
    return new Response(JSON.stringify({ recordMap: {
      notion_user: { 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb': { value: {} } },
      space: { 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa': { value: {} } },
    } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  await discoverIdentity({ cookie: 'token_v2=x', fetchFn });
  // Without these Notion resets the connection instead of answering 401,
  // which surfaces as a bogus "network problem".
  assert.equal(headers.origin, 'https://app.notion.com');
  assert.equal(headers.referer, 'https://app.notion.com/ai');
  assert.ok(headers['user-agent'], 'a browser user-agent is required');
});
test('discovery host and origin headers stay in sync for the legacy host', async () => {
  let headers;
  const fetchFn = async (_url, options) => {
    headers = options.headers;
    return new Response('{}', { status: 401 });
  };
  await assert.rejects(
    discoverIdentity({ cookie: 'token_v2=x', fetchFn, host: 'www.notion.so', endpoint: 'https://www.notion.so/api/v3/loadUserContent' }),
    code('AUTH'),
  );
  assert.equal(headers.origin, 'https://www.notion.so');
});
test('a refused connection names the host instead of blaming the network', async () => {
  const reset = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
  await assert.rejects(
    discoverIdentity({ cookie: 'token_v2=x', fetchFn: async () => { throw reset; } }),
    (error) => error.code === 'TRANSPORT' && error.message.includes('app.notion.com') && /ECONNRESET/.test(error.message),
  );
  await assert.rejects(
    discoverIdentity({ cookie: 'token_v2=x', fetchFn: async () => { throw new TypeError('fetch failed'); } }),
    (error) => error.code === 'TRANSPORT' && /检查网络/.test(error.message),
  );
});
