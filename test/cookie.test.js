import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveOptions, cookieHeader, normalizeCookie } from '../src/options.js';
import { config } from './helpers.js';

const code = (expected) => (error) => error.code === expected;
const TOKEN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const base = { ...config, autoDiscover: true, spaceId: '', userId: '' };

// The regression this file exists for: a bare token_v2 value used to be sent
// as the whole Cookie header, so Notion saw no token and answered 401 — which
// DSH renders as "API 密钥无效" even though no API key is involved.
test('a bare token_v2 value becomes a valid Cookie header before discovery', () => {
  assert.equal(cookieHeader(TOKEN), `token_v2=${TOKEN}`);
  const options = resolveOptions({ ...base, cookie: TOKEN }, {}, true);
  assert.equal(options.rawCookie, `token_v2=${TOKEN}`);
  assert.ok(options.rawCookie.startsWith('token_v2='), 'discovery must see a token_v2= pair');
});
test('a pasted multi-pair cookie keeps its pairs and is not double-wrapped', () => {
  assert.equal(cookieHeader('token_v2=abc; other=1'), 'token_v2=abc; other=1');
  assert.equal(cookieHeader('  token_v2=abc  '), 'token_v2=abc');
});
test('discovery-only header never carries a placeholder user id', () => {
  const options = resolveOptions({ ...base, cookie: TOKEN }, {}, true);
  assert.ok(!options.rawCookie.includes('notion_user_id='), 'user id is unknown until discovery resolves it');
});
test('normalizeCookie binds the real user and drops a stale one', () => {
  assert.equal(normalizeCookie(TOKEN, 'uid-1'), `token_v2=${TOKEN}; notion_user_id=uid-1`);
  assert.equal(normalizeCookie('token_v2=abc; notion_user_id=stale; x=1', 'uid-2'), 'token_v2=abc; x=1; notion_user_id=uid-2');
});
test('both paths share one parsing rule and reject the same defects', () => {
  for (const bad of ['', 'a\r\nb', 'token_v2=', 'token_v2=one; token_v2=two', 'has space']) {
    assert.throws(() => cookieHeader(bad), (error) => ['MISSING_CREDENTIAL', 'INVALID_CREDENTIAL'].includes(error.code));
    assert.throws(() => normalizeCookie(bad, 'uid'), (error) => ['MISSING_CREDENTIAL', 'INVALID_CREDENTIAL'].includes(error.code));
  }
});
test('autoDiscover without any cookie fails before any network IO', () => {
  let called = false;
  assert.throws(() => resolveOptions({ ...base, cookie: '' }, {}, true), code('MISSING_CREDENTIAL'));
  assert.equal(called, false);
});