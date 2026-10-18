import test from 'node:test';
import assert from 'node:assert/strict';
import { readNotionStream, NotionStreamState, cleanNotionText, recordMapPick } from '../src/stream.js';
import { config, collect, finalRecord, responseOf, terminal } from './helpers.js';

const strict = { completionMode: 'verified-marker', terminalType: config.terminalType, terminalPath: config.terminalPath, terminalValue: config.terminalValue };
const added = (text) => ({ type: 'patch', v: [{ o: 'a', p: '/s/-', v: { type: 'text', value: [{ type: 'text', content: text }] } }] });
const append = (text) => ({ type: 'patch', v: [{ o: 'x', p: '/s/0/value/0/content', v: text }] });
const replace = (text) => ({ type: 'patch', v: [{ o: 'p', p: '/s/0/value/0/content', v: text }] });
const code = (expected) => (error) => error.code === expected;

test('a/x/p patches produce deltas without duplicating replacement snapshots', async () => {
  const response = responseOf([added('Hel'), append('lo'), finalRecord('Hello'), terminal]);
  assert.deepEqual(await collect(readNotionStream(response.body, strict)), ['Hel', 'lo']);
});
test('UTF-8 split across every byte, CRLF and no last newline are preserved', async () => {
  const response = responseOf([JSON.stringify(added('你好🙂')) + '\r', finalRecord('你好🙂'), terminal], { splitBytes: 1, trailingNewline: false });
  assert.equal((await collect(readNotionStream(response.body, strict))).join(''), '你好🙂');
});
test('initial transcript indexes are retained for generated segments', async () => {
  const transcript = [{ type: 'config', value: {} }, { type: 'user', value: [['input']] }];
  const response = responseOf([added('A'), { type: 'patch', v: [{ o: 'x', p: '/s/2/value/0/content', v: 'B' }] }, terminal]);
  assert.equal((await collect(readNotionStream(response.body, { ...strict, transcript }))).join(''), 'AB');
});
test('history turns in the transcript are never re-emitted as the answer', () => {
  const transcript = [
    { type: 'config', value: { type: 'workflow' } },
    { type: 'user', value: [['hello']] },
    { type: 'agent-inference', value: [{ type: 'text', content: 'PRIOR ANSWER FROM HISTORY' }] },
  ];
  const state = new NotionStreamState({ transcript, completionMode: 'stream-end' });
  const delta = state.consume({ type: 'patch', v: [{ o: 'a', p: '/s/-', v: { type: 'text', value: [{ type: 'text', content: 'new answer' }] } }] });
  assert.equal(delta, 'new answer');
  assert.doesNotThrow(() => state.finish());
});
test('stream-end mode completes on a closed stream with visible text', async () => {
  assert.equal((await collect(readNotionStream(responseOf([added('answer')]).body, { completionMode: 'stream-end' }))).join(''), 'answer');
  await assert.rejects(collect(readNotionStream(responseOf([terminal]).body, { completionMode: 'stream-end' })), code('EMPTY_RESPONSE'));
});
test('final-record mode requires the final record, not bare EOF', async () => {
  const options = { completionMode: 'final-record' };
  assert.equal((await collect(readNotionStream(responseOf([finalRecord('answer')]).body, options))).join(''), 'answer');
  await assert.rejects(collect(readNotionStream(responseOf([added('partial')]).body, options)), code('PROTOCOL_ERROR'));
});
test('strict mode does not treat record-map or EOF as normal completion', async () => {
  await assert.rejects(collect(readNotionStream(responseOf([added('partial'), finalRecord('partial')]).body, strict)), code('PROTOCOL_ERROR'));
});
test('wrong terminal status and unknown metadata do not manufacture a finish', async () => {
  await assert.rejects(collect(readNotionStream(responseOf([added('text'), { type: config.terminalType, status: 'failed' }, { type: 'unknown', text: 'not a completion' }]).body, strict)), code('PROTOCOL_ERROR'));
});
test('terminal pointer supports escaped JSON object keys', () => {
  const state = new NotionStreamState({ completionMode: 'verified-marker', terminalType: 'end', terminalPath: '/a~1b/~0key', terminalValue: 'ok' });
  state.consume(added('text'));
  state.consume({ type: 'end', 'a/b': { '~key': 'ok' } });
  assert.doesNotThrow(() => state.finish());
});
test('empty/error/malformed frames fail with stable classifications', async () => {
  for (const [frames, expected] of [
    [[terminal], 'EMPTY_RESPONSE'],
    [[{ type: 'error', error: { code: 'quota_exceeded', message: 'private response' } }], 'QUOTA'],
    [['{"type":"patch"'], 'PROTOCOL_ERROR'],
    [[[]], 'PROTOCOL_ERROR'],
    [[{ type: 'patch', v: 'invalid' }], 'PROTOCOL_ERROR'],
  ]) await assert.rejects(collect(readNotionStream(responseOf(frames).body, strict)), code(expected));
});
test('appended text that would rewrite visible output fails closed', () => {
  const state = new NotionStreamState(strict);
  state.consume(added('Hello'));
  assert.throws(() => state.consume(replace('Different')), code('PROTOCOL_ERROR'));
});
test('a shorter final record confirms without retracting streamed text', () => {
  const state = new NotionStreamState({ completionMode: 'final-record' });
  state.consume(added('Hello world'));
  // The record map lags behind what already streamed: keep the fuller text.
  assert.equal(state.consume(finalRecord('Hello')), '');
  assert.equal(state.text, 'Hello world');
  assert.doesNotThrow(() => state.finish());
});
test('thinking, title and native-tool data are not concatenated into prose', () => {
  const state = new NotionStreamState(strict);
  assert.equal(state.consume({ type: 'patch', v: [{ o: 'a', p: '/s/-', v: { type: 'title', value: 'not answer' } }] }), '');
  assert.equal(state.consume({ type: 'patch', v: [{ o: 'a', p: '/s/-', v: { type: 'agent-inference', value: [{ type: 'reasoning', content: 'not exposed' }, { type: 'text', content: 'answer' }] } }] }), 'answer');
  // A native tool/search segment is skipped, not fatal: Notion AI searches as a
  // normal capability, and failing the call would reject ordinary answers.
  assert.equal(state.consume({ type: 'patch', v: [{ o: 'a', p: '/s/-', v: { type: 'agent-tool-result', value: 'native result' } }] }), '');
});

test('a web-search answer still completes and never leaks tool payloads', () => {
  const state = new NotionStreamState({ completionMode: 'stream-end' });
  // Search UI segments and queries are dropped...
  assert.equal(state.consume({ type: 'patch', v: [{ o: 'a', p: '/s/-', v: { type: 'search', value: [{ type: 'text', content: '{"queries":["secret query"]}' }] } }] }), '');
  // ...while the answer that follows is delivered intact.
  assert.equal(state.consume({ type: 'patch', v: [{ o: 'a', p: '/s/-', v: { type: 'text', value: [{ type: 'text', content: 'the answer' }] } }] }), 'the answer');
  assert.doesNotThrow(() => state.finish());
  assert.ok(!state.text.includes('secret query'), 'tool payloads must not become prose');
});

test('a record map whose only step is a tool segment yields no answer text', () => {
  const frame = { type: 'record-map', recordMap: { thread_message: {
    tool: { value: { last_edited_time: 5, value: { step: { type: 'agent-tool-result', value: 'raw tool output' } } } },
  } } };
  assert.equal(recordMapPick(frame, undefined), null);
});
test('record-map picks the body over the draft and the title', () => {
  const frame = { type: 'record-map', recordMap: { thread_message: {
    title: { value: { last_edited_time: 9, value: { step: { type: 'title', value: 'A Title' } } } },
    draft: { value: { last_edited_time: 8, value: { step: { type: 'agent-inference', value: [{ type: 'text', content: 'draft' }] } } } },
    body: { value: { last_edited_time: 1, value: { step: { type: 'text', value: 'the answer' } } } },
  } } };
  assert.equal(recordMapPick(frame, undefined).text, 'the answer');
  assert.equal(recordMapPick({ type: 'record-map', recordMap: {} }, undefined), null);
});
test('record-map prefers this request thread but never returns empty', () => {
  const message = (text, owner) => ({ value: { last_edited_time: 1, value: { thread_id: owner, step: { type: 'text', value: text } } } });
  const merged = { type: 'record-map', recordMap: { thread_message: { a: message('own thread', 'thread-own'), b: message('other thread', 'thread-other') } } };
  assert.equal(recordMapPick(merged, 'thread-own').text, 'own thread');
  // An unknown thread id must still yield an answer rather than nothing.
  assert.ok(recordMapPick(merged, 'thread-missing').text.length > 0);
});
test('markdown-chat segments stream as answer text', () => {
  const state = new NotionStreamState({ completionMode: 'final-record' });
  const delta = state.consume({ type: 'patch', v: [{ o: 'a', p: '/s/-', v: { type: 'markdown-chat', value: [{ type: 'text', content: 'gemini answer' }] } }] });
  assert.equal(delta, 'gemini answer');
  assert.doesNotThrow(() => state.finish());
});
test('notion lang markup is stripped, including tags split across frames', () => {
  const state = new NotionStreamState(strict);
  const first = state.consume(added('中文<lan'));
  assert.equal(first, '中文');
  // The half tag is held back, so the next chunk cannot break the prefix rule.
  const second = state.consume(append('g primary="zh-CN">正文</lang>'));
  assert.equal(second, '正文');
  assert.equal(cleanNotionText('a<lang primary="en">b</lang>c'), 'abc');
});
test('unsafe patch keys and unknown paths cannot mutate object prototypes', async () => {
  for (const path of ['/__proto__/x', '/s/0/constructor/y']) {
    await assert.rejects(collect(readNotionStream(responseOf([{ type: 'patch', v: [{ o: 'p', p: path, v: 'x' }] }]).body, strict)), code('PROTOCOL_ERROR'));
  }
});
test('response byte guard and idle timeout cancel the reader', async () => {
  await assert.rejects(collect(readNotionStream(responseOf([added('x')]).body, { ...strict, maxResponseBytes: 5 })), code('RESPONSE_TOO_LARGE'));
  const idle = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('')); } });
  await assert.rejects(collect(readNotionStream(new Response(idle).body, { ...strict, idleTimeoutMs: 20 })), code('TIMEOUT'));
});
test('abort while waiting for upstream data cancels promptly', async () => {
  const controller = new AbortController();
  const stream = new ReadableStream({ start(inner) { inner.enqueue(new TextEncoder().encode('')); setTimeout(() => controller.abort(), 10); } });
  await assert.rejects(collect(readNotionStream(new Response(stream).body, { ...strict, signal: controller.signal })), code('ABORTED'));
});
test('reader errors do not leak provider response details', async () => {
  const stream = new ReadableStream({ start(controller) { controller.error(new Error('private upstream detail')); } });
  await assert.rejects(collect(readNotionStream(new Response(stream).body, strict)), (error) => error.code === 'TRANSPORT' && !error.message.includes('private'));
});
