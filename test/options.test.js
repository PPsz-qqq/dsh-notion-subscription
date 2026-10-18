import test from 'node:test';
import assert from 'node:assert/strict';
import { Config } from '../src/index.js';
import { DEFAULT_CLIENT_VERSION, resolveOptions, normalizeCookie, modelInfo } from '../src/options.js';
import { MODEL_CATALOG, threadTypeFor } from '../src/models.js';
import { config } from './helpers.js';

const code = (expected) => (error) => error.code === expected;
// schemastery serializes a schema graph: { uid, refs }, and the root is refs[uid].
const fields = (schema) => Object.fromEntries(Object.entries(schema.refs[schema.uid].dict).map(([key, ref]) => [key, schema.refs[ref]]));

test('safe defaults: disabled, text-only, stream-end and no guessed context', () => {
  const options = resolveOptions({}, {});
  assert.equal(options.enabled, false);
  assert.equal(options.toolBridge, false);
  assert.equal(options.completionMode, 'stream-end');
  assert.equal(options.terminalType, '');
  assert.equal(options.precreateThread, true);
  assert.equal(modelInfo('notion-subscription', options.models[0]).context, undefined);
});
test('updated catalog preserves legacy mappings and verified current models', () => {
  const options = resolveOptions({}, {});
  assert.deepEqual(options.models.map((model) => model.id), MODEL_CATALOG.map((model) => model.id));
  assert.equal(options.models.length, 36);
  for (const model of options.models) {
    assert.ok(model.upstreamModel, `${model.id} must ship an upstream id`);
    assert.equal(model.threadType, threadTypeFor(model.id, model.upstreamModel));
  }
  assert.equal(options.models.find((model) => model.id === 'gemini-3.1pro').threadType, 'workflow');
  assert.equal(options.models.find((model) => model.id === 'claude-sonnet4.6').threadType, 'workflow');
});
test('current Gemini routes use workflow unless explicitly overridden', () => {
  assert.equal(threadTypeFor('my-alias', 'galette-medium-thinking'), 'workflow');
  assert.equal(threadTypeFor('my-alias', 'vertex-anything'), 'workflow');
  assert.equal(threadTypeFor('claude-opus4.6', 'avocado-froyo-medium'), 'workflow');
  const declared = resolveOptions({ ...config, models: [{ id: 'x', upstreamModel: 'oatmeal-cookie', threadType: 'markdown-chat' }] }, {}, true);
  assert.equal(declared.models[0].threadType, 'markdown-chat');
});
test('an empty clientVersion falls back to the bundled build string', () => {
  assert.equal(resolveOptions({}, {}).clientVersion, DEFAULT_CLIENT_VERSION);
  assert.equal(resolveOptions({ clientVersion: 'custom' }, {}).clientVersion, 'custom');
});
test('credentials and IDs can come only from explicit config or named env', () => {
  const { cookie, ...withoutCookie } = config;
  const options = resolveOptions(withoutCookie, { NOTION_COOKIE: 'env-test-token', NOTION_SPACE_ID: config.spaceId, NOTION_USER_ID: config.userId }, true);
  assert.ok(options.cookie.includes('token_v2=env-test-token'));
  assert.ok(options.cookie.includes(`notion_user_id=${config.userId}`));
});
test('explicit cookie overrides env and normalizes the active user', () => {
  assert.equal(resolveOptions(config, { NOTION_COOKIE: 'other-test-token' }, true).cookie, `token_v2=synthetic-test-token; notion_user_id=${config.userId}`);
  assert.equal(normalizeCookie('token_v2=test; notion_user_id=old; other=yes', config.userId), `token_v2=test; other=yes; notion_user_id=${config.userId}`);
});
test('blank/malformed cookies fail without disclosing their values', () => {
  for (const value of ['', 'secret\r\nX-Evil: 1', 'token_v2=', 'token_v2=one; token_v2=two', '有秘密']) {
    assert.throws(() => normalizeCookie(value, config.userId), (error) => {
      assert.ok(['MISSING_CREDENTIAL', 'INVALID_CREDENTIAL'].includes(error.code));
      if (value) assert.ok(!error.message.includes(value));
      return true;
    });
  }
});
test('verified-marker refuses to dispatch until a terminal shape is confirmed', () => {
  assert.throws(() => resolveOptions({ ...config, terminalType: '', completionMode: 'verified-marker' }, {}, true), code('PROTOCOL_UNVERIFIED'));
  // The default stream-end mode needs no terminal shape at all.
  assert.doesNotThrow(() => resolveOptions({ ...config, terminalType: '', completionMode: 'stream-end' }, {}, true));
});
test('terminal pointer/value must be paired and cannot be malformed', () => {
  for (const patch of [{ terminalPath: 'status' }, { terminalPath: '/status', terminalValue: '' }, { terminalPath: '', terminalValue: 'done' }, { terminalPath: '/bad~2key' }]) {
    assert.throws(() => resolveOptions({ ...config, ...patch }, {}, false), code('INVALID_CONFIG'));
  }
});
test('reject invalid IDs, duplicate models, unknown modes and invalid limits', () => {
  for (const patch of [
    { spaceId: 'wrong' }, { models: [] }, { models: [{ id: 'x' }, { id: 'x' }] },
    { completionMode: 'eof' }, { timeoutMs: 0 }, { toolBridge: 'true' }, { clientVersion: 'bad\nheader' },
    { models: [{ id: 'x', threadType: 'markdown-chat-2' }] },
  ]) {
    assert.throws(() => resolveOptions({ ...config, ...patch }, {}, true), code('INVALID_CONFIG'));
  }
});
test('volatile Config schema marks Cookie as secret and has explicit safety defaults', () => {
  const dict = fields(Config.toJSON());
  assert.equal(dict.cookie.meta.role, 'secret');
  assert.equal(dict.cookie.meta.volatile, true);
  assert.equal(dict.enabled.meta.default, false);
  assert.equal(dict.toolBridge.meta.default, false);
  assert.equal(dict.completionMode.meta.default, 'stream-end');
});
test('volatile references are read into detached options', () => {
  const options = resolveOptions(Object.fromEntries(Object.entries(config).map(([key, value]) => [key, { get: () => value }])), {}, true);
  assert.equal(options.enabled, true);
  assert.equal(options.terminalType, config.terminalType);
});
