import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NotionStreamState, readNotionStream } from '../src/stream.js';
import { responseOf, collect } from './helpers.js';
const start = { type: 'patch-start', data: { s: [{ type: 'agent-instruction-state' }] }, version: 1 };
const patch = (...v) => ({ type: 'patch', v });
const add = (type, value) => ({ o: 'a', p: '/s/-', v: { type, value } });
test('patch-start uses server indexes instead of outgoing transcript length', () => {
  const state = new NotionStreamState({ transcript: [{type:'config'}, {type:'context'}, {type:'user'}] });
  state.consume(start);
  state.consume(patch(add('agent-turn-full-record-map', { content:'private' }), add('agent-tool-result', 'private'), add('agent-inference', [{type:'text',content:''}])));
  assert.equal(state.consume(patch({o:'x',p:'/s/3/value/0/content',v:'answer'})), 'answer');
  state.finish();
  assert.equal(state.root.s.length, 4);
});
test('redacted live GPT-6.1 response replays with split bytes', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/live-patch-start.redacted.json',import.meta.url),'utf8'));
  const out = await collect(readNotionStream(responseOf(fixture.frames, {splitBytes:1}).body, {transcript:fixture.transcript}));
  assert.ok(out.join('').length > 0);
  assert.equal(out.join(''), 'OK');
});
test('initial assistant history stays hidden even when server and request states differ', () => {
  const state = new NotionStreamState({transcript:[]});
  state.consume({type:'patch-start',data:{s:[{type:'agent-inference',value:'old answer'}]}});
  assert.equal(state.consume(patch(add('text','new answer'))),'new answer');
});
test('malformed, repeated and late initial states fail closed', () => {
  for(const data of [null,{}, {s:{}}, {s:[null]}]) assert.throws(()=>new NotionStreamState().consume({type:'patch-start',data}),e=>e.code==='PROTOCOL_ERROR');
  const state = new NotionStreamState(); state.consume(start);
  assert.throws(()=>state.consume(start),e=>e.code==='PROTOCOL_ERROR');
  const late = new NotionStreamState(); late.consume(patch(add('text','answer')));
  assert.throws(()=>late.consume(start),e=>e.code==='PROTOCOL_ERROR');
  assert.throws(()=>new NotionStreamState().consume({...start,version:2}),e=>e.code==='PROTOCOL_ERROR');
});
test('removing a thinking block shifts text indexes without exposing reasoning', () => {
  const state = new NotionStreamState();
  state.consume(start);
  state.consume(patch(add('agent-inference',[{type:'thinking',content:'private'}, {type:'text',content:'A'}])));
  assert.equal(state.consume(patch({o:'r',p:'/s/1/value/0'})), '');
  assert.equal(state.consume(patch({o:'x',p:'/s/1/value/0/content',v:'B'})), 'B');
  assert.equal(state.text,'AB');
});
test('deleting already emitted content is not accepted as successful completion', () => {
  const state = new NotionStreamState(); state.consume(patch(add('text','answer')));
  assert.throws(()=>state.consume(patch({o:'r',p:'/s/0'})),e=>e.code==='PROTOCOL_ERROR');
});
test('seed boundary tracks insertion and removal without replaying history', () => {
  const state = new NotionStreamState({transcript:[{type:'agent-inference',value:'old'}]});
  assert.equal(state.consume(patch({o:'a',p:'/s/0',v:{type:'text',value:'inserted history'}})),'');
  state.consume(patch({o:'r',p:'/s/0'}));
  assert.equal(state.consume(patch(add('text','answer'))),'answer');
});
test('markdown rich-text tuples do not leak formatting metadata', () => {
  const state = new NotionStreamState();
  assert.equal(state.consume(patch(add('markdown-chat',[['answer',[['a','private-link']]],['!']]))),'answer!');
});
test('deep markdown nesting fails with a protocol error instead of overflowing', () => {
  let value='answer';for(let i=0;i<30;i++)value={value};
  assert.throws(()=>new NotionStreamState().consume(patch(add('markdown-chat',value))),e=>e.code==='PROTOCOL_ERROR');
});
test('a nested markdown block is not a complete final record', () => {
  const state=new NotionStreamState({completionMode:'final-record'});
  state.consume(patch(add('agent-inference',[{type:'text',content:'answer'}])));
  state.consume(patch({o:'a',p:'/s/0/value/-',v:{type:'markdown-chat',value:'nested'}}));
  assert.throws(()=>state.finish(),e=>e.code==='PROTOCOL_ERROR');
});
