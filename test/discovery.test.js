import test from 'node:test';
import assert from 'node:assert/strict';
import { NotionSubscriptionAdapter } from '../src/index.js';
import { discoverIdentity, LOAD_USER_CONTENT_ENDPOINT } from '../src/discovery.js';
import { resolveOptions } from '../src/options.js';
import { config, request, responseOf, collect, finalRecord } from './helpers.js';

const code = (expected) => (error) => error.code === expected;
// Identity tests are not about completion detection: use the default mode.
const base = { ...config, completionMode: 'stream-end' };
const SPACE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const identityResponse = () => new Response(JSON.stringify({ recordMap: {
  notion_user: { [USER]: { value: { given_name: 'Test', email: 'test@example.com' } } },
  space: { [SPACE]: { value: { id: SPACE } } },
  space_view: { 'cccccccc-cccc-cccc-cccc-cccccccccccc': { value: {} } },
} }), { status: 200, headers: { 'content-type': 'application/json' } });

test('discovery reads the workspace and user out of the session cookie', async () => {
  let seen;
  const identity = await discoverIdentity({
    cookie: 'token_v2=synthetic; notion_user_id=old',
    fetchFn: async (url, options) => { seen = { url, options }; return identityResponse(); },
  });
  assert.equal(seen.url, LOAD_USER_CONTENT_ENDPOINT);
  assert.equal(seen.options.method, 'POST');
  assert.equal(seen.options.redirect, 'error');
  assert.ok(seen.options.headers.cookie.includes('token_v2=synthetic'));
  assert.deepEqual(identity, { userId: USER, spaceId: SPACE, spaceViewId: 'cccccccc-cccc-cccc-cccc-cccccccccccc', userName: 'Test', userEmail: 'test@example.com' });
});
test('discovery failures are classified and never invent an identity', async () => {
  await assert.rejects(discoverIdentity({ cookie: 'token_v2=x', fetchFn: async () => new Response('{}', { status: 401 }) }), code('AUTH'));
  await assert.rejects(discoverIdentity({ cookie: 'token_v2=x', fetchFn: async () => new Response('nope', { status: 500 }) }), code('PROVIDER_ERROR'));
  await assert.rejects(discoverIdentity({ cookie: 'token_v2=x', fetchFn: async () => new Response('<html>', { status: 200 }) }), code('PROTOCOL_ERROR'));
  await assert.rejects(discoverIdentity({ cookie: 'token_v2=x', fetchFn: async () => new Response('{"recordMap":{}}', { status: 200 }) }), code('IDENTITY_UNRESOLVED'));
  await assert.rejects(discoverIdentity({ fetchFn: async () => { throw new Error('unused'); } }), code('MISSING_CREDENTIAL'));
});
test('autoDiscover accepts a cookie-only config and needs no ids up front', () => {
  const options = resolveOptions({ ...base, autoDiscover: true, spaceId: '', userId: '' }, {}, true);
  assert.equal(options.spaceId, '');
  assert.equal(options.userId, '');
  assert.equal(options.cookie, undefined);
  assert.ok(options.rawCookie.includes('synthetic-test-token'));
});
test('autoDiscover posts with the resolved ids and binds the real user into the cookie', async () => {
  let inference;
  const adapter = new NotionSubscriptionAdapter({ ...base, autoDiscover: true, spaceId: '', userId: '' }, {
    environment: {},
    fetchFn: async (url, options) => {
      if (url === LOAD_USER_CONTENT_ENDPOINT) return identityResponse();
      inference = { url, headers: options.headers, body: JSON.parse(options.body) };
      return responseOf([finalRecord('ok', inference.body.threadId)]);
    },
  });
  await collect(adapter.stream(request));
  assert.equal(inference.body.spaceId, SPACE);
  assert.equal(inference.body.transcript[1].value.spaceId, SPACE);
  assert.equal(inference.body.transcript[1].value.userId, USER);
  assert.equal(inference.headers['x-notion-space-id'], SPACE);
  assert.equal(inference.headers['x-notion-active-user-header'], USER);
  assert.ok(inference.headers.cookie.includes(`notion_user_id=${USER}`));
});
test('discovery is cached across calls and re-run when the cookie changes', async () => {
  let looks = 0;
  let raw = { ...base, autoDiscover: true, spaceId: '', userId: '' };
  const adapter = new NotionSubscriptionAdapter(() => raw, {
    environment: {},
    fetchFn: async (url, options) => {
      if (url === LOAD_USER_CONTENT_ENDPOINT) { looks++; return identityResponse(); }
      return responseOf([finalRecord('ok', JSON.parse(options.body).threadId)]);
    },
  });
  await collect(adapter.stream(request));
  await collect(adapter.stream(request));
  assert.equal(looks, 1);
  raw = { ...raw, cookie: 'a-different-token' };
  await collect(adapter.stream(request));
  assert.equal(looks, 2);
});
test('an explicitly configured id still wins over discovery', async () => {
  const explicit = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  let inference;
  const adapter = new NotionSubscriptionAdapter({ ...base, autoDiscover: true, spaceId: explicit, userId: '' }, {
    environment: {},
    fetchFn: async (url, options) => {
      if (url === LOAD_USER_CONTENT_ENDPOINT) return identityResponse();
      inference = JSON.parse(options.body);
      return responseOf([finalRecord('ok', inference.threadId)]);
    },
  });
  await collect(adapter.stream(request));
  assert.equal(inference.spaceId, explicit);
});
test('autoDiscover off still demands both ids before any network IO', async () => {
  let called = false;
  const adapter = new NotionSubscriptionAdapter({ ...base, autoDiscover: false, spaceId: '', userId: '' }, {
    environment: {}, fetchFn: async () => { called = true; return identityResponse(); },
  });
  await assert.rejects(collect(adapter.stream(request)), code('MISSING_IDENTITY'));
  assert.equal(called, false);
});

