import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { parseAvailableModels, mergeCatalog, offlineCatalog } from '../src/catalog.js';
import { MODEL_CATALOG } from '../src/models.js';
import { NotionSubscriptionAdapter } from '../src/index.js';
import { resolveOptions } from '../src/options.js';
import { config } from './helpers.js';
const SPACE = config.spaceId;
const rows={models:[{model:'omniberry-sundae',modelMessage:'GPT-6.1 Sol'},{model:'orlando-quinn',modelMessage:'GPT-6 Astra',isDisabled:true},{model:'almond-croissant-low',modelMessage:'Sonnet 4.6'}]};
const json=(v)=>new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}});
test('account catalog excludes disabled models and preserves legacy IDs',()=>{
  const got=parseAvailableModels(rows);
  assert.deepEqual(got.models.map(m=>m.id),['gpt-6.1-sol','claude-sonnet4.6']);
  assert.deepEqual(got.disabled,['orlando-quinn']);
});
test('invalid catalogs fail instead of inventing models',()=>{
  assert.throws(()=>parseAvailableModels({}),e=>e.code==='PROTOCOL_ERROR');
  assert.equal(parseAvailableModels({models:[null,{model:'unsafe\nheader'},{model:'ok',modelMessage:'New'},{model:'ok',modelMessage:'Duplicate'}]}).models.length,1);
});
test('manual aliases survive but disabled IDs cannot be reintroduced',()=>{
  const merged=mergeCatalog(parseAvailableModels(rows),[{id:'my-sol',name:'My Sol',upstreamModel:'omniberry-sundae',threadType:'workflow'},{id:'astra',upstreamModel:'orlando-quinn'},{id:'custom',upstreamModel:'own-model',threadType:'workflow'}]);
  assert.deepEqual(merged.map(m=>m.id),['my-sol','claude-sonnet4.6','custom']);
});
test('old five-model settings do not hide the updated offline catalog',()=>{
  const models=offlineCatalog(resolveOptions({...config,models:[{id:'claude-sonnet4.6',upstreamModel:'almond-croissant-low'}]},{}).models);
  assert.ok(models.some(m=>m.id==='gpt-6.1-sol'));
  assert.ok(models.every(m=>m.source==='offline'));
});
test('settings defaults match the host catalog exactly',()=>{
  const client=createRequire(import.meta.url)('../src/client.cjs');
  assert.deepEqual(client.DEFAULT_MODELS,MODEL_CATALOG.map(m=>({...m})));
  assert.equal(client.makeDraft().autoModels,true);
  assert.ok(client.mutationFor(client.makeDraft()).some(op=>op.path[0]==='autoModels'&&op.value===true));
});
test('live catalog cache is scoped to host and credentials',async()=>{
  const cfg={...config,autoModels:true}; let calls=0;
  const adapter=new NotionSubscriptionAdapter(()=>cfg,{environment:{},fetchFn:async(url,init)=>{calls++;assert.ok(url.endsWith('/getAvailableModels'));assert.equal(JSON.parse(init.body).spaceId,SPACE);return json(rows);}});
  const first=await adapter.listModels(); await adapter.listModels(); assert.equal(calls,1);
  assert.ok(first.some(m=>m.id==='gpt-6.1-sol'&&m.description.includes('实时目录')));
  assert.ok(!first.some(m=>m.id==='gpt-6-astra'));
  cfg.notionHost='www.notion.so'; await adapter.listModels(); assert.equal(calls,2);
  cfg.cookie='token_v2=another-token'; await adapter.listModels(); assert.equal(calls,3);
  adapter.catalog.expiresAt=0; await adapter.listModels(); assert.equal(calls,4);
});
test('offline fallback is labelled and manual mode never fetches',async()=>{
  let calls=0; const adapter=new NotionSubscriptionAdapter({...config,autoModels:true},{environment:{},fetchFn:async()=>{calls++;throw new TypeError('network');}});
  const models=await adapter.listModels(); await adapter.listModels(); assert.equal(calls,1);
  assert.ok(models.some(m=>m.id==='gpt-6.1-sol'&&m.description.includes('离线快照')));
  const manual=new NotionSubscriptionAdapter(config,{environment:{},fetchFn:async()=>{throw new Error('must not fetch');}});
  assert.equal((await manual.listModels()).length,MODEL_CATALOG.length);
});
test('disabled live model is rejected before inference',async()=>{
  let inference=0;const adapter=new NotionSubscriptionAdapter({...config,autoModels:true,models:[{id:'astra',upstreamModel:'orlando-quinn'}]},{environment:{},fetchFn:async(url)=>{if(url.includes('runInference'))inference++;return json(rows);}});
  await assert.rejects(adapter.prepareCall('notion-subscription','astra'),e=>e.code==='UNSUPPORTED_MODEL');assert.equal(inference,0);
});
test('multiple explicit aliases for one upstream model remain available',()=>{
  const models=mergeCatalog(parseAvailableModels(rows),[{id:'sol-a',upstreamModel:'omniberry-sundae'},{id:'sol-b',upstreamModel:'omniberry-sundae'}]);
  assert.ok(models.some(m=>m.id==='sol-a'));assert.ok(models.some(m=>m.id==='sol-b'));
});
test('alias collisions cannot silently route to the wrong upstream model',()=>{
  assert.throws(()=>mergeCatalog(parseAvailableModels(rows),[{id:'gpt-6.1-sol',upstreamModel:'almond-croissant-low'}]),e=>e.code==='INVALID_CONFIG');
});
