import test from 'node:test';
import assert from 'node:assert/strict';
import {readNotionStream} from '../src/stream.js';
import {streamNotion} from '../src/transport.js';
import {resolveOptions} from '../src/options.js';
import {config,request,finalRecord,terminal} from './helpers.js';
const encode=frames=>new TextEncoder().encode(frames.map(frame=>JSON.stringify(frame)).join('\n')+'\n');
const collect=async stream=>{let text='';for await(const chunk of stream)text+=chunk;return text;};
test('first data may arrive after idle allowance but within its own bounded allowance',async()=>{
  const body=new ReadableStream({start(controller){setTimeout(()=>{controller.enqueue(encode([finalRecord('OK'),terminal]));controller.close();},25);}});
  assert.equal(await collect(readNotionStream(body,{idleTimeoutMs:5,firstByteTimeoutMs:250})),'OK');
});
test('first-data timeout is explicit and cancels the upstream reader',async()=>{
  let cancelled=false;const body=new ReadableStream({cancel(){cancelled=true;}});
  await assert.rejects(()=>collect(readNotionStream(body,{idleTimeoutMs:5,firstByteTimeoutMs:10})),e=>e.code==='TIMEOUT'&&e.message.includes('首段'));
  assert.equal(cancelled,true);
});
test('once data arrives the shorter idle protection still applies',async()=>{
  const body=new ReadableStream({start(controller){controller.enqueue(encode([finalRecord('partial')]));}});
  await assert.rejects(()=>collect(readNotionStream(body,{idleTimeoutMs:5,firstByteTimeoutMs:250})),e=>e.code==='TIMEOUT'&&e.message.includes('已接收'));
});
test('transport preserves total deadline and never retries stalled inference',async()=>{
  let calls=0;const options=resolveOptions({...config,timeoutMs:30,idleTimeoutMs:2},{},true);
  const fetchFn=async()=>{calls++;return new Response(new ReadableStream());};
  await assert.rejects(()=>collect(streamNotion(options,request,{threadType:'workflow'}, {fetchFn,attribution:{}})),e=>e.code==='TIMEOUT'&&e.message.includes('总时限'));
  assert.equal(calls,1);
});
