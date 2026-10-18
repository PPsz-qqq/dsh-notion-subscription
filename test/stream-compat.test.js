import test from 'node:test';
import assert from 'node:assert/strict';
import { NotionStreamState, readNotionStream } from '../src/stream.js';
import { NotionSubscriptionAdapter } from '../src/index.js';
import { config, request, responseOf, collect, finalRecord } from './helpers.js';

// Synthetic compatibility fixtures, not captured account traffic.
const frame = (...v) => ({ type: 'patch', v });
const add = (v, p = '/s/-') => ({ o: 'a', p, v });
const append = (v, p = '/s/0/value/0/content') => ({ o: 'x', p, v });
const protocolError = (error) => error.code === 'PROTOCOL_ERROR';

for (const initial of [undefined, null, '']) {
  test(`text append initializes a ${String(initial)} leaf`, () => {
    const state = new NotionStreamState();
    const item = { type: 'text', ...(initial === undefined ? {} : { content: initial }) };
    assert.equal(state.consume(frame(add({ type: 'agent-inference', value: [item] }))), '');
    assert.equal(state.consume(frame(append('你好'))), '你好');
    assert.equal(state.consume(frame(append('🙂'))), '🙂');
    assert.equal(state.text, '你好🙂');
    state.finish();
  });
}

for (const field of ['p', 'path', 'pointer', 'at']) {
  for (const array of [false, true]) {
    test(`${field} supports ${array ? 'array' : 'string'} paths`, () => {
      const state = new NotionStreamState();
      const path = (parts) => array ? parts : parts.join('/');
      state.consume(frame({ o: 'a', [field]: path(['s', '-']), v: { type: 'text', value: [{ type: 'text' }] } }));
      assert.equal(state.consume(frame({ o: 'x', [field]: path(['s', 0, 'value', 0, 'content']), v: 'answer' })), 'answer');
      assert.equal(state.consume(frame({ o: 'p', [field]: path(['s', 0, 'value', 0, 'content']), v: 'answer!' })), '!');
      state.finish();
    });
  }
}

test('patch-level type labels apply to untyped nested value blocks', () => {
  const state = new NotionStreamState();
  state.consume(frame(add({ type: 'agent-inference', value: [] })));
  state.consume(frame({ ...add({}, '/s/0/value/-'), type: 'reasoning' }));
  assert.equal(state.consume(frame(append('private reasoning'))), '');
  state.consume(frame({ ...add({}, '/s/0/value/1'), type: 'text' }));
  assert.equal(state.consume(frame(append('answer', '/s/0/value/1/content'))), 'answer');
  state.finish();
});

test('top-level tool labels and null tool text never become visible prose', () => {
  const state = new NotionStreamState();
  assert.equal(state.consume(frame({ ...add({ value: [{ type: 'text', content: null }] }), type: 'agent-tool-result' })), '');
  assert.equal(state.consume(frame(append('private search result'))), '');
  assert.equal(state.consume(frame(add({ type: 'text', value: 'answer' }))), 'answer');
  state.finish();
});

test('JSON Pointer escapes and empty object keys are preserved', () => {
  const state = new NotionStreamState();
  state.consume(frame(add({ type: 'text', value: 'answer', 'a/b': { '~key': { '': '' } } })));
  state.consume(frame(append('metadata', '/s/0/a~1b/~0key/')));
  assert.equal(state.root.s[0]['a/b']['~key'][''], 'metadata');
  assert.equal(state.text, 'answer');
});

test('null direct markdown text may receive its first append', () => {
  const state = new NotionStreamState();
  state.consume(frame(add({ type: 'markdown-chat', value: null })));
  assert.equal(state.consume(frame(append('answer', '/s/0/value'))), 'answer');
  state.finish();
});

test('malformed text append reports types but never the payload or arbitrary path keys', () => {
  const secret = 'private-value-never-log';
  for (const initial of [{}, [], 7, true]) {
    const state = new NotionStreamState();
    state.consume(frame(add({ type: 'text', value: [{ type: 'text', content: initial }] })));
    assert.throws(() => state.consume(frame(append(secret))), (error) => {
      assert.equal(error.code, 'PROTOCOL_ERROR');
      assert.match(error.message, /op=x/);
      assert.match(error.message, /target=/);
      assert.match(error.message, /value=string/);
      assert.ok(!error.message.includes(secret));
      return true;
    });
  }
  const state = new NotionStreamState();
  state.consume(frame(add({ type: 'text', value: 'answer', [secret]: {} })));
  assert.throws(() => state.consume(frame(append(secret, '/s/0/' + secret))), (error) => protocolError(error) && !error.message.includes(secret));
});

test('invalid paths, wrong value types and unknown parents still fail closed', () => {
  for (const patch of [
    append({ text: 'wrong type' }), append('x', '/s/0/value/9/content'),
    append('x', '/s/0/value/01/content'), append('x', '/s/0/value/-/content'),
    append('x', '/s/0/value/0/unknown'), append('x', '/s/0/constructor/prototype/polluted'),
    { o: 'p', p: '/s/0/__proto__/polluted', v: true },
    { o: 'a', p: '/s/4294967295', v: {} },
    { o: 'p', p: '/s/0/a~2b', v: 'x' },
    { o: 'a', p: ['s', {}, 'value'], v: 'x' },
    { o: 'unknown', p: '/s/0/value', v: 'x' },
    { o: 'p', undefined: '/s/0/value', v: 'x' },
    { o: 'p', p: '/s', v: {} },
  ]) {
    const state = new NotionStreamState();
    state.consume(frame(add({ type: 'text', value: [{ type: 'text' }] })));
    assert.throws(() => state.consume(frame(patch)), protocolError);
  }
  assert.equal({}.polluted, undefined);
});

test('metadata-only final records never count as answers', () => {
  for (const type of ['title', 'reasoning', 'thinking', 'agent-tool-result']) {
    const state = new NotionStreamState({ completionMode: 'final-record' });
    assert.equal(state.consume(finalRecord('private metadata', undefined, type)), '');
    assert.throws(() => state.finish(), (error) => error.code === 'EMPTY_RESPONSE');
  }
});

test('adapter handles seeded history, search and split UTF-8 with lazy text initialization', async () => {
  const adapter = new NotionSubscriptionAdapter({ ...config, completionMode: 'stream-end' }, {
    environment: {},
    fetchFn: async (_url, options) => {
      const { transcript, threadId } = JSON.parse(options.body);
      const n = transcript.length;
      return responseOf([
        frame(add({ type: 'agent-tool-result', value: [{ type: 'text', content: null }] })),
        frame(append('private search', `/s/${n}/value/0/content`)),
        frame(add({ type: 'agent-inference', value: [{ type: 'text' }] })),
        frame(append('你好', `/s/${n + 1}/value/0/content`)),
        frame(append('🙂', `/s/${n + 1}/value/0/content`)),
        finalRecord('你好🙂', threadId),
      ], { splitBytes: 1, trailingNewline: false });
    },
  });
  const events = await collect(adapter.stream({ ...request, messages: [
    { role: 'user', content: [{ type: 'text', text: 'old question' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'private old answer' }] },
    ...request.messages,
  ] }));
  assert.ok(!JSON.stringify(events).includes('private'));
  assert.ok(!events.some((event) => event.type === 'error'));
  const visible = events.filter((event) => event.type === 'text-delta').map((event) => event.text).join('');
  assert.equal(visible, '你好🙂');
});

test('an opening lang wrapper split inside its attributes is withheld until complete', () => {
  const state = new NotionStreamState();
  assert.equal(state.consume(frame(add({ type: 'text', value: [{ type: 'text', content: '你好<lang pri' }] }))), '你好');
  assert.equal(state.consume(frame(append('mary="zh-CN"'))), '');
  assert.equal(state.consume(frame(append('>正文</lang>'))), '正文');
  state.finish();
});

test('nested markdown metadata is excluded without dropping visible text', () => {
  const state = new NotionStreamState();
  assert.equal(state.consume(frame(add({ type: 'markdown-chat', value: [
    { type: 'reasoning', value: 'private reasoning' },
    { type: 'connector-result', value: 'private connector' },
    { type: 'text', content: 'answer' },
  ] }))), 'answer');
  state.finish();
});

test('protocol errors cancel the reader and never emit a normal finish', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ start(controller) {
    const frames = [
      frame(add({ type: 'text', value: [{ type: 'text', content: 'partial' }] })),
      frame(append({ privatePayload: 'must not leak' })),
    ];
    controller.enqueue(new TextEncoder().encode(frames.map((f) => JSON.stringify(f)).join('\n') + '\n'));
  }, cancel() { cancelled = true; } }));
  const adapter = new NotionSubscriptionAdapter({ ...config, completionMode: 'stream-end' }, { environment: {}, fetchFn: async () => response });
  const events = [];
  await assert.rejects(async () => { for await (const event of adapter.stream(request)) events.push(event); }, (error) => protocolError(error) && !error.message.includes('must not leak'));
  assert.equal(cancelled, true);
  assert.ok(!events.some((event) => event.type === 'finish'));
});
