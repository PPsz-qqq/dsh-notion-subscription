import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, buildTranscript, buildThreadCreationPayload, parseToolReply } from '../src/messages.js';
import { resolveOptions } from '../src/options.js';
import { config, request } from './helpers.js';

const tools = [{ name: 'read', description: 'Read a file', parameters: { type: 'object', properties: { file_path: { type: 'string' } } } }];
const userTurnTexts = (blocks) => blocks.filter((block) => block.type === 'user').map((block) => block.value[0][0]);

test('transcript keeps original turn order and role boundaries', () => {
  const messages = [
    { role: 'system', content: [{ type: 'text', text: 'original system' }] },
    { role: 'user', content: [{ type: 'text', text: 'first' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'reply' }] },
    { role: 'user', content: [{ type: 'text', text: 'last' }] },
  ];
  const blocks = buildTranscript(resolveOptions(config, {}, true), { ...request, messages }, { threadType: 'workflow', upstreamModel: 'm' });
  assert.deepEqual(blocks.map((block) => block.type), ['config', 'context', 'user', 'agent-inference', 'user']);
  assert.equal(blocks[2].value[0][0], '[System Instructions: original system]\n\nfirst');
  assert.equal(blocks[2].userId, config.userId);
  assert.equal(blocks[3].value[0].content, 'reply');
  assert.equal(blocks[4].value[0][0], 'last');
});
test('native image/file inputs fail instead of silently disappearing', () => {
  assert.throws(
    () => buildTranscript(resolveOptions(config, {}, true), { ...request, messages: [{ role: 'user', content: [{ type: 'image' }] }] }, { threadType: 'workflow' }),
    (error) => error.code === 'UNSUPPORTED_CONTENT',
  );
});
test('tool calls and results flatten to text lines rather than vanishing', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'go' }] },
    { role: 'assistant', content: [{ type: 'tool-call', id: 'call1', name: 'read', arguments: '{"file_path":"a"}' }] },
    { role: 'tool', toolCallId: 'call1', isError: false, content: [{ type: 'text', text: 'result' }] },
  ];
  const blocks = buildTranscript(resolveOptions(config, {}, true), { ...request, messages }, { threadType: 'workflow' });
  assert.match(blocks[3].value[0].content, /read\(\{"file_path":"a"\}\)/);
  assert.match(userTurnTexts(blocks).at(-1), /dsh-tool-call result call1: result/);
});
test('request carries the ported envelope flags and the model route', () => {
  const options = resolveOptions(config, {}, true);
  const model = { threadType: 'workflow', upstreamModel: 'almond-croissant-low' };
  const body = buildRequest(options, request, model, () => 'synthetic-id');
  assert.equal(body.transcript[0].value.type, 'workflow');
  assert.equal(body.transcript[0].value.model, 'almond-croissant-low');
  assert.equal(body.transcript[0].value.modelFromUser, true);
  assert.equal(body.transcript[0].value.useReadOnlyMode, true);
  assert.equal(body.transcript[0].value.useWebSearch, false);
  assert.deepEqual(body.transcript[0].value.searchScopes, []);
  assert.equal(body.threadType, 'workflow');
  assert.equal(body.createThread, true);
  assert.equal(body.isPartialTranscript, false);
  assert.equal(body.asPatchResponse, true);
  assert.deepEqual(body.debugOverrides.emitInferences, false);
  assert.equal(body.transcript[1].type, 'context');
  assert.equal(body.transcript[1].value.userId, config.userId);
});
test('markdown-chat route pre-creates its thread instead of asking the request to', () => {
  const options = resolveOptions(config, {}, true);
  const body = buildRequest(options, request, { threadType: 'markdown-chat' }, () => 'synthetic-id');
  assert.equal(body.threadType, 'markdown-chat');
  assert.equal(body.createThread, false);
  assert.equal(body.isPartialTranscript, true);
  const payload = buildThreadCreationPayload(options, 'thread-1', 'markdown-chat', () => 'synthetic-id', () => 42);
  assert.equal(payload.transactions[0].operations[0].command, 'set');
  assert.equal(payload.transactions[0].operations[0].args.type, 'markdown-chat');
  assert.equal(payload.transactions[0].operations[0].args.created_time, 42);
});
test('a model without an upstream id never fabricates one', () => {
  const body = buildRequest(resolveOptions(config, {}, true), request, { threadType: 'workflow', upstreamModel: '' });
  assert.ok(!('model' in body.transcript[0].value));
});
test('tool descriptions only enter prompts on explicit opt-in', () => {
  const plain = buildTranscript(resolveOptions(config, {}, true), { ...request, tools }, { threadType: 'workflow' });
  assert.ok(!JSON.stringify(plain).includes('Available DSH tools'));
  const bridged = buildTranscript(resolveOptions({ ...config, toolBridge: true }, {}, true), { ...request, tools }, { threadType: 'workflow' });
  assert.ok(JSON.stringify(bridged).includes('dsh-tool-call'));
});
test('parse exactly one whole-answer declared tool call', () => {
  const block = parseToolReply('```dsh-tool-call\n{"name":"read","arguments":{"file_path":"a"}}\n```', tools);
  assert.equal(block.name, 'read');
  assert.deepEqual(JSON.parse(block.arguments), { file_path: 'a' });
  assert.ok(block.id.startsWith('notion_'));
  assert.equal(parseToolReply('Example: ```dsh-tool-call\n{}\n```', tools), null);
});
test('reject malformed, undeclared and nonobject tool arguments', () => {
  for (const body of ['not json', '{"name":"delete","arguments":{}}', '{"name":"read","arguments":[]}', '{"name":"read","arguments":{},"extra":1}']) {
    assert.throws(() => parseToolReply(`\`\`\`dsh-tool-call\n${body}\n\`\`\``, tools), (error) => error.code === 'INVALID_TOOL_ARGUMENTS');
  }
});
