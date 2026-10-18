import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchNotionJson } from '../src/http.js';
import { discoverIdentity } from '../src/discovery.js';
import { NotionSubscriptionAdapter } from '../src/index.js';
import { CaptureSink } from '../src/capture.js';
import { resolveOptions } from '../src/options.js';
import { config } from './helpers.js';
const endpoint='https://app.notion.com/api/v3/getAvailableModels';
const json=(value)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const opts={cookie:'token_v2=synthetic'};
const match=(code)=>error=>error.code===code;
const S=config.spaceId,U=config.userId,SECOND='cccccccc-cccc-cccc-cccc-cccccccccccc';
const identity=(spaces={ [S]:{value:{}} })=>({recordMap:{notion_user:{[U]:{value:{}}},space:spaces}});

test('JSON body stalls are cancelled by the request deadline',async()=>{
  let cancelled=false;
  await assert.rejects(fetchNotionJson(endpoint,{...opts,timeoutMs:10,fetchFn:async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}))}),match('TIMEOUT'));
  assert.equal(cancelled,true);
});
test('external abort interrupts JSON body reading and is not reported as timeout',async()=>{
  const controller=new AbortController();let cancelled=false;
  const promise=fetchNotionJson(endpoint,{...opts,signal:controller.signal,fetchFn:async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}))});
  setImmediate(()=>controller.abort()); await assert.rejects(promise,match('ABORTED'));assert.equal(cancelled,true);
});
test('pre-aborted JSON requests never reach the network',async()=>{
  const controller=new AbortController();controller.abort();let calls=0;
  await assert.rejects(fetchNotionJson(endpoint,{...opts,signal:controller.signal,fetchFn:async()=>{calls++;return json({});}}),match('ABORTED'));assert.equal(calls,0);
});
test('JSON transport limits bytes and rejects malformed responses',async()=>{
  await assert.rejects(fetchNotionJson(endpoint,{...opts,maxResponseBytes:10,fetchFn:async()=>json({text:'x'.repeat(100)})}),match('RESPONSE_TOO_LARGE'));
  await assert.rejects(fetchNotionJson(endpoint,{...opts,fetchFn:async()=>new Response('<html>')}),match('PROTOCOL_ERROR'));
});
test('untrusted endpoints and redirect responses never forward credentials',async()=>{
  let calls=0;for(const url of ['https://evil.example/api','http://app.notion.com/api','https://user:pass@app.notion.com/api']) await assert.rejects(fetchNotionJson(url,{...opts,fetchFn:async()=>{calls++;}}),match('INVALID_CONFIG'));
  assert.equal(calls,0);
  await assert.rejects(fetchNotionJson(endpoint,{...opts,fetchFn:async(_url,init)=>{assert.equal(init.redirect,'error');return new Response('',{status:302});}}),match('PROVIDER_ERROR'));
});
test('permission and rate-limit errors remain distinct from network failures',async()=>{
  for(const [status,code] of [[401,'AUTH'],[403,'PERMISSION'],[429,'RATE_LIMIT']]) await assert.rejects(fetchNotionJson(endpoint,{...opts,fetchFn:async()=>new Response('',{status})}),match(code));
});
test('multiple workspaces require a selection instead of choosing the first',async()=>{
  const fetchFn=async()=>json(identity({[S]:{value:{}},[SECOND]:{value:{}}}));
  await assert.rejects(discoverIdentity({...opts,fetchFn}),match('IDENTITY_UNRESOLVED'));
  assert.equal((await discoverIdentity({...opts,fetchFn,preferredSpaceId:SECOND})).spaceId,SECOND);
});
test('space_view fallback uses the referenced space_id, not the view ID',async()=>{
  const data=identity({});data.recordMap.space_view={[SECOND]:{value:{space_id:S}}};
  assert.equal((await discoverIdentity({...opts,fetchFn:async()=>json(data)})).spaceId,S);
});
test('identity cache expires and never crosses hosts or credentials',async()=>{
  let calls=0;const cfg={...config,autoDiscover:true,spaceId:'',userId:''};
  const adapter=new NotionSubscriptionAdapter(()=>cfg,{environment:{},fetchFn:async()=>{calls++;return json(identity());}});
  await adapter.prepareCall('notion-subscription','claude-sonnet4.6');await adapter.prepareCall('notion-subscription','claude-sonnet4.6');assert.equal(calls,1);
  cfg.notionHost='www.notion.so';await adapter.prepareCall('notion-subscription','claude-sonnet4.6');assert.equal(calls,2);
  cfg.cookie='token_v2=changed';await adapter.prepareCall('notion-subscription','claude-sonnet4.6');assert.equal(calls,3);
  adapter.identity.expiresAt=0;await adapter.prepareCall('notion-subscription','claude-sonnet4.6');assert.equal(calls,4);
  adapter.llmError({code:'AUTH'});assert.equal(adapter.identity,undefined);
});
test('cookie-only option defaults match the schema and booleans are validated',()=>{
  const options=resolveOptions({enabled:true,cookie:'synthetic'}, {}, true);
  assert.equal(options.autoDiscover,true);assert.equal(options.autoModels,true);
  assert.throws(()=>resolveOptions({autoModels:'true'},{}),match('INVALID_CONFIG'));
});
test('capture redacts mixed-case headers, nested credentials and known secret echoes',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'notion-redaction-'));
  try {
    const sink=new CaptureSink({enabled:true,directory:dir,cookie:'token_v2=very-private-token'});
    await sink.record('test',{headers:{Cookie:'cookie-secret',Authorization:'auth-secret','X-Secret':'header-secret','content-type':'application/json'},requestBody:{password:'nested-secret',prompt:'echo very-private-token',nested:{token_v2:'nested-token'}},frames:[{type:'one',secret:'frame-secret'},{type:'two',text:'safe'}]});
    assert.equal(sink.error,null);
    const files=await readdir(dir);const contents=await Promise.all(files.map(f=>readFile(join(dir,f),'utf8')));
    for(const secret of ['cookie-secret','auth-secret','header-secret','nested-secret','very-private-token','nested-token','frame-secret']) assert.ok(!contents.join('').includes(secret),secret);
    const ndjson=contents[files.findIndex(f=>f.endsWith('.ndjson'))].trim().split('\n').map(line=>JSON.parse(line));
    assert.equal(ndjson.length,2);
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('capture filenames are unique and oversized captures do not write files',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'notion-capture-limits-'));
  try {
    const sink=new CaptureSink({enabled:true,directory:dir});const data={headers:{},requestBody:{},frames:[]};
    await Promise.all([sink.record('test',data),sink.record('test',data)]);assert.equal((await readdir(dir)).length,4);
    const limited=new CaptureSink({enabled:true,directory:dir,maxBytes:1});await limited.record('test',data);assert.ok(limited.error);assert.equal((await readdir(dir)).length,4);
  } finally {await rm(dir,{recursive:true,force:true});}
});
