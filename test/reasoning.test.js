import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveOptions,modelInfo} from '../src/options.js';
import {reasoningConfiguration,reasoningInfo} from '../src/reasoning.js';
import {parseAvailableModels,mergeCatalog} from '../src/catalog.js';
import {buildRequest,selectReasoningEffort} from '../src/messages.js';
import {NotionSubscriptionAdapter} from '../src/index.js';
import {config,request,responseOf,finalRecord,terminal,collect} from './helpers.js';
const levels=['low','medium','high','xhigh','max'];
const options=()=>resolveOptions(config,{},true);
const sol=()=>options().models.find(m=>m.id==='gpt-6.1-sol');
const provider={id:'notion-subscription',name:'Notion AI'};
const wire=(opts,req,model)=>buildRequest(opts,req,model,()=> 'synthetic-id').transcript.find(m=>m.type==='config').value;
const rows={models:[{model:'omniberry-sundae',modelMessage:'GPT-6.1 Sol',modelConfiguration:{supportedReasoningEfforts:levels,defaultReasoningEffort:'medium'}}]};
test('account model configuration preserves supported levels and upstream default',()=>{
  const model=parseAvailableModels(rows).models[0];assert.deepEqual(model.supportedReasoningEfforts,levels);assert.equal(model.defaultReasoningEffort,'medium');
});
test('live capabilities override stale configured lists while preserving aliases',()=>{
  const model=mergeCatalog(parseAvailableModels(rows),[{id:'alias',upstreamModel:'omniberry-sundae',supportedReasoningEfforts:['imaginary'],reasoningEffort:'high'}])[0];assert.deepEqual(model.supportedReasoningEfforts,levels);assert.equal(model.id,'alias');assert.equal(model.reasoningEffort,'high');
});
test('DSH receives native effort metadata without forcing upstream defaults',()=>{
  const info=modelInfo(provider,sol());assert.deepEqual(info.reasoning.efforts.map(e=>e.id),levels);assert.equal(info.reasoning.defaultEffort,undefined);
});
test('plugin default is advertised only when the exact model supports it',()=>{
  assert.equal(modelInfo(provider,sol(),false,'xhigh').reasoning.defaultEffort,'xhigh');assert.equal(modelInfo(provider,sol(),false,'none').reasoning.defaultEffort,undefined);
});
test('no declared reasoning capability means no native reasoning selector',()=>{
  assert.equal(reasoningInfo({supportedReasoningEfforts:[]}),undefined);assert.equal(reasoningInfo({...sol(),threadType:'markdown-chat'}),undefined);
});
test('omitting effort leaves the upstream workflow default untouched',()=>{
  assert.equal(Object.hasOwn(wire(options(),request,sol()),'reasoningEffort'),false);
});
test('explicit DSH effort is transmitted in the workflow config block',()=>{
  assert.equal(wire(options(),{...request,reasoningEffort:'max'},sol()).reasoningEffort,'max');
});
test('session effort wins over model and provider preferences',()=>{
  const model={...sol(),reasoningEffort:'medium'};const opts={...options(),defaultReasoningEffort:'low'};assert.equal(selectReasoningEffort(opts,{...request,reasoningEffort:'high'},model),'high');assert.equal(selectReasoningEffort(opts,request,model),'medium');
});
test('provider default is used only for supporting models',()=>{
  const opts=resolveOptions({...config,defaultReasoningEffort:'max'},{},true);assert.equal(opts.defaultReasoningEffort,'max');assert.equal(wire(opts,request,sol()).reasoningEffort,'max');assert.equal(selectReasoningEffort(opts,request,{threadType:'workflow',supportedReasoningEfforts:['low']}),undefined);
});
test('invalid explicit efforts fail rather than falling back silently',()=>{
  for(const reasoningEffort of ['none','',null,2,{},['high']])assert.throws(()=>selectReasoningEffort(options(),{...request,reasoningEffort},sol()),e=>e.code==='INVALID_REQUEST');
});
test('malformed effort metadata is sanitized and unknown opaque ids remain strings',()=>{
  const cfg=reasoningConfiguration({supportedReasoningEfforts:['low','low',null,'bad value','constructor'],defaultReasoningEffort:'wrong'});assert.deepEqual(cfg.supportedReasoningEfforts,['low','constructor']);assert.equal(cfg.defaultReasoningEffort,undefined);assert.equal(reasoningInfo(cfg).efforts[1].name,'constructor');
});
test('adapter exposes native metadata and sends selected effort to mocked inference',async()=>{
  let body;let calls=0;const adapter=new NotionSubscriptionAdapter({...config,defaultReasoningEffort:'high'},{environment:{},attribution:()=>({}),fetchFn:async(_url,init)=>{calls++;body=JSON.parse(init.body);return responseOf([finalRecord('OK',body.threadId),terminal]);}});
  const models=await adapter.listModels(provider);assert.equal(models.find(m=>m.id==='gpt-6.1-sol').reasoning.defaultEffort,'high');
  await collect(adapter.stream({...request,model:'gpt-6.1-sol',reasoningEffort:'xhigh'}));assert.equal(calls,1);assert.equal(body.transcript[0].value.reasoningEffort,'xhigh');
});
test('unsupported efforts are rejected before any inference network call',async()=>{
  let calls=0;const adapter=new NotionSubscriptionAdapter(config,{environment:{},attribution:()=>({}),fetchFn:async()=>{calls++;throw Error('No network expected');}});await assert.rejects(()=>collect(adapter.stream({...request,model:'gpt-6.1-sol',reasoningEffort:'none'})),e=>e.code==='INVALID_REQUEST');assert.equal(calls,0);
});
