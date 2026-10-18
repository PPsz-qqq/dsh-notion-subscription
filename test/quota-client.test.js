import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
const require=createRequire(import.meta.url);
const {NotionComposerQuota,quotaPercent,quotaReset,quotaLevel}=require('../src/client.cjs');
const live={state:'ready',observedAt:1_800_000_000_000,enforcement:'preview',windows:{sixHour:{used:12.21,limit:100,remainingPercent:87.79,resetAt:Date.now()+18917000},monthly:{used:43.31,limit:100,remainingPercent:56.69,resetAt:Date.now()+86400000*20}}};
const directoryFor=current=>{const snapshot={current};return {subscribe:()=>()=>{},getSnapshot:()=>snapshot};};
async function withDom(run){
  const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{pretendToBeVisual:true});
  globalThis.window=dom.window;globalThis.document=dom.window.document;
  Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true,writable:true});
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  const root=createRoot(dom.window.document.getElementById('root'));
  try{await run(dom,root);}finally{await act(async()=>root.unmount());dom.window.close();delete globalThis.window;delete globalThis.document;delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
}
const okRequest=async()=>({ok:true,json:async()=>({ok:true,value:live})});
const click=async node=>{await act(async()=>{node.dispatchEvent(new window.MouseEvent('click',{bubbles:true}));});};
test('formatting helpers stay honest about unknown values',()=>{
  assert.equal(quotaPercent(87.786),'87.8%');assert.equal(quotaPercent(100),'100%');
  assert.equal(quotaReset(undefined,0),'');assert.equal(quotaReset(5000,0),'1 分钟后重置');
  assert.equal(quotaReset(3600000*5,0),'5 小时 0 分后重置');
  assert.equal(quotaLevel(5),'danger');assert.equal(quotaLevel(20),'warning');assert.equal(quotaLevel(21),'normal');
});
test('the dock defaults to the six-hour window and toggles to monthly on click',async()=>{
  await withDom(async(dom,root)=>{
    await act(async()=>root.render(React.createElement(NotionComposerQuota,{directory:directoryFor({provider:'notion-subscription',model:'gpt-6.1-sol'}),request:okRequest})));
    const text=()=>document.getElementById('root').textContent;
    assert.equal(document.querySelector('.ns-quota-label').textContent,'6 小时');
    assert.match(text(),/剩余 87\.8%/);assert.match(text(),/12\.21 \/ 100/);
    await click(document.querySelector('.ns-quota-trigger'));
    assert.equal(document.querySelector('.ns-quota-label').textContent,'本月');
    assert.match(text(),/剩余 56\.7%/);assert.match(text(),/43\.31 \/ 100/);
    assert.match(document.querySelector('.ns-quota-trigger').getAttribute('aria-label'),/本月额度剩余/);
    await click(document.querySelector('.ns-quota-trigger'));
    assert.equal(document.querySelector('.ns-quota-label').textContent,'6 小时');
  });
});
test('the badge stays absent unless the conversation uses Notion',async()=>{
  await withDom(async(_,root)=>{
    await act(async()=>root.render(React.createElement(NotionComposerQuota,{directory:directoryFor({provider:'other-provider',model:'x'}),request:okRequest})));
    assert.equal(document.getElementById('root').textContent,'');
    await act(async()=>root.render(React.createElement(NotionComposerQuota,{directory:null,request:okRequest})));
    assert.equal(document.getElementById('root').textContent,'');
  });
});
test('a failed read is reported with a retry rather than a zero balance',async()=>{
  let calls=0;const request=async()=>{calls++;if(calls===1)throw new Error('读取 Notion 额度失败。');return {ok:true,json:async()=>({ok:true,value:live})};};
  await withDom(async(dom,root)=>{
    await act(async()=>root.render(React.createElement(NotionComposerQuota,{directory:directoryFor({provider:'notion-subscription',model:'m'}),request})));
    assert.match(document.body.textContent,/额度暂不可用/);
    assert.doesNotMatch(document.body.textContent,/剩余 0%/);
    await click([...document.querySelectorAll('button')].find(node=>node.textContent==='重试'));
    assert.match(document.body.textContent,/剩余 87\.8%/);assert.equal(calls,2);
  });
});
test('not-applicable and single-window payloads render their own message',async()=>{
  const notApplicable=async()=>({ok:true,json:async()=>({ok:true,value:{state:'not_applicable',windows:{sixHour:null,monthly:null},message:'当前工作区不适用 Notion 基础 AI 额度。'}})});
  await withDom(async(_,root)=>{
    await act(async()=>root.render(React.createElement(NotionComposerQuota,{directory:directoryFor({provider:'notion-subscription',model:'m'}),request:notApplicable})));
    assert.match(document.body.textContent,/不适用/);
  });
  const monthlyOnly=async()=>({ok:true,json:async()=>({ok:true,value:{state:'ready',windows:{sixHour:null,monthly:live.windows.monthly}}})});
  await withDom(async(_,root)=>{
    await act(async()=>root.render(React.createElement(NotionComposerQuota,{directory:directoryFor({provider:'notion-subscription',model:'m'}),request:monthlyOnly})));
    assert.match(document.body.textContent,/本月/);assert.match(document.body.textContent,/剩余 56\.7%/);
  });
});
