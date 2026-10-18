import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { JSDOM } from 'jsdom';
import { config } from './helpers.js';
const require = createRequire(import.meta.url);
const { makeDraft, mutationFor, NotionSettings, apply, modelsForDisplay } = require('../src/client.cjs');

test('drafts never receive saved secrets; blank secret inputs preserve credentials', () => {
  const draft = makeDraft({ ...config, cookie: 'saved-secret-never-visible' });
  assert.equal(draft.cookie, '');
  assert.ok(!JSON.stringify(draft).includes('saved-secret-never-visible'));
  assert.ok(!mutationFor(draft).some((op) => op.path[0] === 'cookie'));
});
test('explicit new secret and explicit clearing generate only write operations', () => {
  const draft = { ...makeDraft(config), cookie: 'new-local-test-secret' };
  assert.equal(mutationFor(draft).find((op) => op.path[0] === 'cookie').value, 'new-local-test-secret');
  assert.equal(mutationFor(draft, true).find((op) => op.path[0] === 'cookie').value, '');
});
test('invalid model JSON is rejected before any host write', () => {
  assert.throws(() => mutationFor({ modelsText: 'not JSON' }), /JSON/);
  assert.throws(() => mutationFor({ modelsText: '[]' }), /至少/);
});

async function withDom(run) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:19387' });
  const old = Object.getOwnPropertyDescriptors(globalThis);
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const root = createRoot(document.getElementById('root'));
  try { await run(dom, root); }
  finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT']) {
      if (old[key]) Object.defineProperty(globalThis, key, old[key]); else delete globalThis[key];
    }
  }
}
function fixtures(accepted = true) {
  const writes = [];
  let snapshot = { status: 'ready', writable: true, value: { ...config, cookie: 'saved-secret-never-visible', models: [{ id: 'claude-sonnet4.6', upstreamModel: 'almond-croissant-low' }] }, revision: 7 };
  const listeners=new Set();
  const form = { entryId: 'dsh-notion-subscription', subscribe: listener => {listeners.add(listener);return ()=>listeners.delete(listener);}, getSnapshot: () => snapshot, mutate: async (ops, revision) => { writes.push({ ops, revision }); return accepted; } };
  const view = { view: { namespaces: [{ ns: form.entryId, secrets: [{ path: ['cookie'], set: true }] }] } };
  const mirror = { subscribe: () => () => {}, getSnapshot: () => view };
  return { writes, form, mirror, publish:next=>{snapshot={...snapshot,...next};for(const listener of listeners)listener();} };
}

test('rendered settings use a blank password field and show billing/protocol risks', async () => {
  await withDom(async (_, root) => {
    const props = fixtures();
    await act(async () => root.render(React.createElement(NotionSettings, props)));
    assert.equal(document.querySelector('input[type="password"]').value, '');
    assert.ok(!document.body.textContent.includes('saved-secret-never-visible'));
    assert.ok(document.body.textContent.includes('credits'));
    assert.ok(document.body.textContent.includes('notion2api'));
    assert.ok(document.body.textContent.includes('已保存'));
  });
});
test('saving retains credentials and submits the revision from the draft', async () => {
  await withDom(async (dom, root) => {
    const props = fixtures();
    await act(async () => root.render(React.createElement(NotionSettings, props)));
    await act(async () => document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(props.writes.length, 1);
    assert.equal(props.writes[0].revision, 7);
    assert.ok(!props.writes[0].ops.some((op) => op.path[0] === 'cookie'));
    assert.ok(document.body.textContent.includes('已保存并刷新模型目录'));
  });
});
test('clear Cookie is explicit and conflicts are not reported as success', async () => {
  await withDom(async (dom, root) => {
    const props = fixtures(false);
    await act(async () => root.render(React.createElement(NotionSettings, props)));
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.includes('清除'));
    await act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.equal(props.writes.length, 0);
    const confirm = [...document.querySelectorAll('button')].find(node => node.textContent === '确认清除 Cookie');
    await act(async () => confirm.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.equal(props.writes[0].ops.find((op) => op.path[0] === 'cookie').value, '');
    assert.ok(document.body.textContent.includes('草稿已保留'));
  });
});
test('DSH settings and dock quota slots register and styles dispose cleanly', async () => {
  await withDom(async () => {
    const props = fixtures();
    let dispose;
    let registered;
    const ctx = {
      configForms: { get: (id) => { assert.equal(id, 'dsh-notion-subscription'); return props.form; }, describe: () => props.mirror },
      modelDirectories: { catalog: { load: async () => {} }, directoryFor: () => ({ store: { subscribe: () => () => {}, getSnapshot: () => ({ current: null }) } }) },
      effect(fn) { dispose = fn(); },
      slots: {
        inject: (name, callback) => { assert.ok(['settings.section', 'conversation.input.dock'].includes(name)); callback(); },
        register: (metadata, component) => { assert.equal(typeof component, 'function'); if (metadata.name === 'settings.section') registered = { metadata, component }; },
      },
    };
    apply(ctx);
    assert.equal(registered.metadata.id, 'dsh-notion-subscription');
    assert.equal(typeof registered.component, 'function');
    assert.equal(document.querySelectorAll('style').length, 1);
    dispose();
    assert.equal(document.querySelectorAll('style').length, 0);
  });
});
test('live catalog drives model cards and does not fabricate missing reasoning',()=>{
  const draft=makeDraft({...config,autoModels:true});
  const catalog={status:'ready',value:{groups:[{id:'notion-subscription',models:[{id:'gpt-6.1-sol',name:'Sol',reasoning:{efforts:[{id:'max',name:'最高'}]}},{id:'other',name:'Plain'}]}]}};
  const display=modelsForDisplay(draft,catalog);assert.equal(display.models.length,2);assert.deepEqual(display.models[0].efforts,[{id:'max',name:'最高'}]);assert.deepEqual(display.models[1].efforts,[]);
  assert.equal(modelsForDisplay(draft,{status:'ready',value:{groups:[{id:'notion-subscription',models:[]}]}}).models.length,0);
});
test('model preview handles malformed user metadata without crashing',()=>{
  const draft=makeDraft({...config,autoModels:false,models:[{id:'custom',name:{bad:true},supportedReasoningEfforts:5}]});const display=modelsForDisplay(draft,{});assert.equal(display.models[0].name,'custom');assert.deepEqual(display.models[0].efforts,[]);
});
test('offline entries from the host are not mislabeled as an account catalog',()=>{
  const draft=makeDraft({...config,autoModels:true});const display=modelsForDisplay(draft,{status:'ready',value:{groups:[{id:'notion-subscription',models:[{id:'gpt-6.1-sol',description:'离线快照'}]}]}});assert.equal(display.source,'offline');
});
test('default reasoning selection is persisted without touching saved credentials',async()=>{
  await withDom(async(dom,root)=>{const props=fixtures();await act(async()=>root.render(React.createElement(NotionSettings,props)));await act(async()=>Simulate.change(document.querySelector('#notion-defaultReasoningEffort'),{target:{value:'high'}}));await act(async()=>document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));assert.equal(props.writes[0].ops.find(op=>op.path[0]==='defaultReasoningEffort').value,'high');assert.ok(!props.writes[0].ops.some(op=>op.path[0]==='cookie'));});
});
test('model search and collapse operate on the exact catalog',async()=>{
  await withDom(async(_,root)=>{const props=fixtures();props.publish({value:{...config,autoModels:true}});const value={status:'ready',value:{groups:[{id:'notion-subscription',models:Array.from({length:9},(_,i)=>({id:'test-'+i,name:'Test '+i,reasoning:{efforts:[{id:'high',name:'高'}]}}))}]}};props.catalogStore={subscribe:()=>()=>{},getSnapshot:()=>value};await act(async()=>root.render(React.createElement(NotionSettings,props)));assert.equal(document.querySelectorAll('[role=listitem]').length,6);await act(async()=>Simulate.change(document.querySelector('[aria-label="搜索模型"]'),{target:{value:'Test 8'}}));assert.equal(document.querySelectorAll('[role=listitem]').length,1);assert.match(document.querySelector('[role=listitem]').textContent,/Test 8/);});
});
test('concurrent config changes retain local edits and the original revision',async()=>{
  await withDom(async(dom,root)=>{const props=fixtures(false);await act(async()=>root.render(React.createElement(NotionSettings,props)));await act(async()=>Simulate.change(document.querySelector('#notion-spaceId'),{target:{value:'11111111-1111-4111-8111-111111111111'}}));await act(async()=>props.publish({revision:8,value:{...config,spaceId:'22222222-2222-4222-8222-222222222222'}}));assert.equal(document.querySelector('#notion-spaceId').value,'11111111-1111-4111-8111-111111111111');await act(async()=>document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));assert.equal(props.writes[0].revision,7);assert.match(document.body.textContent,/草稿已保留/);await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='撤销更改').click());assert.equal(document.querySelector('#notion-spaceId').value,'22222222-2222-4222-8222-222222222222');});
});
test('read-only projections cannot submit configuration changes',async()=>{
  await withDom(async(dom,root)=>{const props=fixtures();props.publish({writable:false});await act(async()=>root.render(React.createElement(NotionSettings,props)));await act(async()=>document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));assert.equal(props.writes.length,0);assert.match(document.body.textContent,/只读/);});
});
test('a catalog failure after saving is distinguished from a failed save',async()=>{
  await withDom(async(dom,root)=>{const props={...fixtures(),reloadModels:async()=>{throw Error('offline');}};await act(async()=>root.render(React.createElement(NotionSettings,props)));await act(async()=>document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));assert.equal(props.writes.length,1);assert.match(document.body.textContent,/配置已保存，但目录刷新失败/);});
});
