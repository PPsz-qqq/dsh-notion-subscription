import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeQuota,NotionQuotaReader,quotaHandler,QUOTA_PATH} from '../src/quota.js';
const live={status:'within_limit',resetsInSeconds:18917,enforcement:'preview',window:{creditType:'basic_ai_credits',scope:'per_user',window:'6h',used:12.21,limit:100},billingPeriodWindow:{creditType:'basic_ai_credits',scope:'per_user',cadence:'billing_period',used:43.31,limit:100,periodEndMs:1794538800000}};
const observedAt=1_800_000_000_000;
const opts={host:'app.notion.com',rawCookie:'token_v2=synthetic',spaceId:'11111111-1111-4111-8111-111111111111',userId:'22222222-2222-4222-8222-222222222222',enabled:true,timeoutMs:5000};
const response=data=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
const reader=(overrides={})=>new NotionQuotaReader({readOptions:()=>opts,resolveIdentity:async()=>{},fetchFn:async()=>response(live),...overrides});
test('six-hour and monthly windows map to real usage without inventing numbers',()=>{
  const value=normalizeQuota(live,observedAt);
  assert.equal(value.state,'ready');assert.equal(value.enforcement,'preview');
  assert.equal(value.windows.sixHour.used,12.21);assert.equal(value.windows.sixHour.limit,100);
  assert.equal(Math.round(value.windows.sixHour.remainingPercent*100)/100,87.79);
  assert.equal(value.windows.sixHour.resetAt,observedAt+18917000);
  assert.equal(value.windows.monthly.resetAt,1794538800000);
  assert.equal(Math.round(value.windows.monthly.remainingPercent*100)/100,56.69);
});
test('a single reported window still renders without fabricating the other',()=>{
  const only6h=normalizeQuota({...live,billingPeriodWindow:undefined},observedAt);
  assert.equal(only6h.windows.monthly,null);assert.equal(only6h.windows.sixHour.used,12.21);
  const onlyMonthly=normalizeQuota({window:{window:'12h'},billingPeriodWindow:live.billingPeriodWindow},observedAt);
  assert.equal(onlyMonthly.windows.sixHour,null);assert.equal(onlyMonthly.windows.monthly.used,43.31);
});
test('overage is preserved in used percent and clamped only for display',()=>{
  const value=normalizeQuota({window:{...live.window,used:130}},observedAt);
  assert.equal(value.windows.sixHour.usedPercent,130);assert.equal(value.windows.sixHour.remainingPercent,0);
});
test('not applicable and unrecognized payloads are distinct states',()=>{
  assert.equal(normalizeQuota({status:'not_applicable'},observedAt).state,'not_applicable');
  assert.throws(()=>normalizeQuota({window:{window:'6h',used:'x',limit:1},billingPeriodWindow:{}},observedAt),error=>error.code==='PROTOCOL_ERROR');
  assert.throws(()=>normalizeQuota({},observedAt),error=>error.code==='PROTOCOL_ERROR');
});
test('reader resolves identity once and reports the live response',async()=>{
  let identities=0,requests=0;
  const value=await reader({resolveIdentity:async()=>{identities++;},fetchFn:async()=>{requests++;return response(live);}}).status();
  assert.equal(value.state,'ready');assert.equal(identities,1);assert.equal(requests,1);
  assert.equal(value.windows.sixHour.limit,100);
});
test('concurrent reads share one credential-scoped request',async()=>{
  let requests=0;const r=reader({fetchFn:async()=>{requests++;await new Promise(resolve=>setTimeout(resolve,5));return response(live);}});
  const [a,b]=await Promise.all([r.status(),r.status()]);
  assert.equal(requests,1);assert.equal(a.state,'ready');assert.equal(b.windows.sixHour.used,12.21);
});
test('cached readings expire and another space never reuses them',async()=>{
  let requests=0,clock=observedAt;const r=reader({clock:()=>clock,fetchFn:async()=>{requests++;return response(live);}});
  await r.status();await r.status();assert.equal(requests,1);
  clock+=61000;await r.status();assert.equal(requests,2);
  opts.spaceId='33333333-3333-4333-8333-333333333333';await r.status();assert.equal(requests,3);
  opts.spaceId='11111111-1111-4111-8111-111111111111';
});
test('failures surface a readable state and clear after their shorter cache',async()=>{
  let requests=0,clock=observedAt;const r=reader({clock:()=>clock,fetchFn:async()=>{requests++;return new Response('{}',{status:403});}});
  const failed=await r.status();assert.equal(failed.state,'error');assert.equal(failed.code,'PERMISSION');assert.ok(failed.message);
  await r.status();assert.equal(requests,1);
  clock+=16000;await r.status();assert.equal(requests,2);
});
test('authentication failures notify the adapter without leaking the cookie',async()=>{
  let notified=0;const r=reader({onAuthFailure:()=>{notified++;},fetchFn:async()=>new Response('{}',{status:401})});
  const value=await r.status();assert.equal(value.state,'error');assert.equal(value.code,'AUTH');assert.equal(notified,1);
  assert.ok(!JSON.stringify(value).includes('synthetic'));
});
test('a disabled line or missing credential never performs a request',async()=>{
  let requests=0;const fetchFn=async()=>{requests++;return response(live);};
  const disabled=await new NotionQuotaReader({readOptions:()=>({...opts,enabled:false}),resolveIdentity:async()=>{},fetchFn}).status();
  const unauth=await new NotionQuotaReader({readOptions:()=>({...opts,rawCookie:''}),resolveIdentity:async()=>{},fetchFn}).status();
  assert.equal(disabled.state,'disabled');assert.equal(unauth.code,'AUTH');assert.equal(requests,0);
});
test('configuration changes invalidate in-flight readings',async()=>{
  let space='11111111-1111-4111-8111-111111111111';let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const r=new NotionQuotaReader({readOptions:()=>({...opts,spaceId:space}),resolveIdentity:async()=>{},fetchFn:async()=>{await gate;return response(live);}});
  const pending=r.status();space='44444444-4444-4444-8444-444444444444';release();
  assert.equal((await pending).code,'CONFIG_CHANGED');
});
const fake=(method='GET',headers={})=>{const written={status:0,headers:null,body:''};return {
  req:{method,url:QUOTA_PATH,headers:{host:'127.0.0.1:59785',...headers}},
  res:{writeHead(status,value){written.status=status;written.headers=value;},end(body){written.body=body;}},
  written};};
test('the quota route is same-origin, read-only and leaks nothing',async()=>{
  const handler=quotaHandler({status:async()=>({state:'ready',windows:{sixHour:{used:1,limit:2,remainingPercent:50},monthly:null}})});
  const ok=fake();await handler(ok.req,ok.res);
  assert.equal(ok.written.status,200);assert.equal(ok.written.headers['Cache-Control'],'no-store');
  assert.equal(JSON.parse(ok.written.body).value.windows.sixHour.used,1);
  const post=fake('POST');await handler(post.req,post.res);assert.equal(post.written.status,405);
  const cross=fake('GET',{origin:'https://evil.example'});await handler(cross.req,cross.res);assert.equal(cross.written.status,403);
  const sfs=fake('GET',{'sec-fetch-site':'cross-site'});await handler(sfs.req,sfs.res);assert.equal(sfs.written.status,403);
  const other=fake();other.req.url='/api/dsh-notion-subscription/other';await handler(other.req,other.res);assert.equal(other.written.status,404);
});
