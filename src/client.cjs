const React = require('react');
const { createElement: h, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React;
const PLUGIN_ID = 'dsh-notion-subscription';
const PROVIDER_ID = 'notion-subscription';
const inject = ['slots', 'configForms', 'modelDirectories'];
const DEFAULT_MODELS = [
  {
    "id": "gpt-6.1-sol",
    "name": "GPT-6.1 Sol",
    "upstreamModel": "omniberry-sundae",
    "supportedReasoningEfforts": [
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ],
    "defaultReasoningEffort": "medium"
  },
  {
    "id": "gpt-5.6-terra",
    "name": "GPT-5.6 Terra",
    "upstreamModel": "orchid-muffin",
    "supportedReasoningEfforts": [
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ],
    "defaultReasoningEffort": "medium"
  },
  {
    "id": "gpt-6-luna",
    "name": "GPT-6 Luna",
    "upstreamModel": "omodi",
    "supportedReasoningEfforts": [
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ],
    "defaultReasoningEffort": "high"
  },
  {
    "id": "opus-5.5",
    "name": "Opus 5.5",
    "upstreamModel": "albuquerque-quinn",
    "supportedReasoningEfforts": [
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ],
    "defaultReasoningEffort": "medium"
  },
  {
    "id": "grok-4.6",
    "name": "Grok 4.6",
    "upstreamModel": "soursop-shortcake",
    "supportedReasoningEfforts": [
      "low",
      "medium",
      "high",
      "xhigh"
    ],
    "defaultReasoningEffort": "high"
  },
  {
    "id": "gpt-5.6-luna",
    "name": "GPT-5.6 Luna",
    "upstreamModel": "olive-jellyroll",
    "supportedReasoningEfforts": [
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ],
    "defaultReasoningEffort": "high"
  },
  {
    "id": "gpt-5.6-sol",
    "name": "GPT-5.6 Sol",
    "upstreamModel": "orange-mousse",
    "supportedReasoningEfforts": [
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ],
    "defaultReasoningEffort": "medium"
  },
  {
    "id": "gpt-5.2",
    "name": "GPT-5.2",
    "upstreamModel": "oatmeal-cookie",
    "supportedReasoningEfforts": [
      "medium",
      "high"
    ],
    "defaultReasoningEffort": "medium"
  },
  {
    "id": "gpt-5.4",
    "name": "GPT-5.4",
    "upstreamModel": "oval-kumquat-medium",
    "supportedReasoningEfforts": [
      "medium",
      "high"
    ],
    "defaultReasoningEffort": "medium"
  },
  {
    "id": "gpt-5.5",
    "name": "GPT-5.5",
    "upstreamModel": "opal-quince-medium",
    "supportedReasoningEfforts": [
      "medium",
      "high"
    ],
    "defaultReasoningEffort": "medium"
  },
  {
    "id": "gemini-3.5-flash",
    "name": "Gemini 3.5 Flash",
    "upstreamModel": "vertex-gemini-3.5-flash",
    "supportedReasoningEfforts": [
      "low",
      "medium",
      "high"
    ],
    "defaultReasoningEffort": "low"
  },
  {
    "id": "gemini-3.6-flash",
    "name": "Gemini 3.6 Flash",
    "upstreamModel": "vertex-gemini-3.6-flash",
    "supportedReasoningEfforts": [
      "minimal",
      "low",
      "medium",
      "high"
    ],
    "defaultReasoningEffort": "medium"
  },
  {
    "id": "gemini-3.7-flash",
    "name": "Gemini 3.7 Flash",
    "upstreamModel": "grapefruit-zeppole",
    "supportedReasoningEfforts": [
      "low",
      "medium",
      "high"
    ],
    "defaultReasoningEffort": "medium"
  },
  {
    "id": "claude-sonnet4.6",
    "name": "Sonnet 4.6",
    "upstreamModel": "almond-croissant-low",
    "supportedReasoningEfforts": [
      "low",
      "medium",
      "high",
      "max"
    ],
    "defaultReasoningEffort": "low"
  },
  {
    "id": "sonnet-5",
    "name": "Sonnet 5",
    "upstreamModel": "angel-cake-high",
    "supportedReasoningEfforts": [
      "none",
      "low",
      "medium",
      "high"
    ],
    "defaultReasoningEffort": "high"
  },
  {
    "id": "sonnet-5.5",
    "name": "Sonnet 5.5",
    "upstreamModel": "achira-donut",
    "supportedReasoningEfforts": [
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ],
    "defaultReasoningEffort": "high"
  },
  {
    "id": "haiku-5.5",
    "name": "Haiku 5.5",
    "upstreamModel": "amla-jam",
    "supportedReasoningEfforts": [
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ],
    "defaultReasoningEffort": "medium"
  },
  {
    "id": "claude-opus4.6",
    "name": "Opus 4.6",
    "upstreamModel": "avocado-froyo-medium",
    "supportedReasoningEfforts": [
      "medium"
    ],
    "defaultReasoningEffort": "medium"
  },
  {
    "id": "opus-4.7",
    "name": "Opus 4.7",
    "upstreamModel": "apricot-sorbet-high",
    "supportedReasoningEfforts": [
      "high"
    ],
    "defaultReasoningEffort": "high"
  },
  {
    "id": "opus-4.8",
    "name": "Opus 4.8",
    "upstreamModel": "ambrosia-tart-high",
    "supportedReasoningEfforts": [
      "low",
      "medium",
      "high",
      "max"
    ],
    "defaultReasoningEffort": "high"
  },
  {
    "id": "opus-5",
    "name": "Opus 5",
    "upstreamModel": "agave-flan",
    "supportedReasoningEfforts": [
      "low",
      "medium",
      "high",
      "max"
    ],
    "defaultReasoningEffort": "medium"
  },
  {
    "id": "gpt-5.4-mini",
    "name": "GPT-5.4 Mini",
    "upstreamModel": "oregon-grape-medium",
    "supportedReasoningEfforts": [
      "medium"
    ],
    "defaultReasoningEffort": "medium"
  },
  {
    "id": "gpt-5.4-nano",
    "name": "GPT-5.4 Nano",
    "upstreamModel": "otaheite-apple-medium",
    "supportedReasoningEfforts": [
      "medium"
    ],
    "defaultReasoningEffort": "medium"
  },
  {
    "id": "kimi-k3",
    "name": "Kimi K3",
    "upstreamModel": "fireworks-kimi-k3",
    "supportedReasoningEfforts": [
      "low",
      "high",
      "max"
    ],
    "defaultReasoningEffort": "high"
  },
  {
    "id": "deepseek-v4-pro",
    "name": "DeepSeek V4 Pro",
    "upstreamModel": "baseten-deepseek-v4-pro",
    "supportedReasoningEfforts": [
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "max",
      "xhigh"
    ],
    "defaultReasoningEffort": "high"
  },
  {
    "id": "deepseek-v4-flash",
    "name": "DeepSeek V4 Flash",
    "upstreamModel": "baseten-deepseek-v4-flash",
    "supportedReasoningEfforts": [
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh"
    ],
    "defaultReasoningEffort": "high"
  },
  {
    "id": "deepseek-v4.1-flash",
    "name": "DeepSeek V4.1 Flash",
    "upstreamModel": "baseten-deepseek-v4.1-flash",
    "supportedReasoningEfforts": [
      "none",
      "low",
      "high",
      "max"
    ],
    "defaultReasoningEffort": "high"
  },
  {
    "id": "glm-5.2",
    "name": "GLM 5.2",
    "upstreamModel": "baseten-glm-5.2",
    "supportedReasoningEfforts": [
      "none",
      "high",
      "max"
    ],
    "defaultReasoningEffort": "high"
  },
  {
    "id": "glm-5.3",
    "name": "GLM 5.3",
    "upstreamModel": "baseten-glm-5.3",
    "supportedReasoningEfforts": [
      "low",
      "high",
      "max"
    ],
    "defaultReasoningEffort": "high"
  },
  {
    "id": "glm-5.3-flash",
    "name": "GLM 5.3 Flash",
    "upstreamModel": "baseten-glm-5.3-flash",
    "supportedReasoningEfforts": [
      "low",
      "high",
      "max"
    ],
    "defaultReasoningEffort": "high"
  },
  {
    "id": "grok-4.3",
    "name": "Grok 4.3",
    "upstreamModel": "xigua-mochi-medium",
    "supportedReasoningEfforts": [
      "low",
      "medium",
      "high"
    ],
    "defaultReasoningEffort": "medium"
  },
  {
    "id": "grok-4.5",
    "name": "Grok 4.5",
    "upstreamModel": "strawberry-whoopiepie",
    "supportedReasoningEfforts": [
      "low",
      "medium",
      "high"
    ],
    "defaultReasoningEffort": "medium"
  },
  {
    "id": "grok-build-0.1",
    "name": "Grok Build 0.1",
    "upstreamModel": "xinomavro-cake"
  },
  {
    "id": "gemini-3.1pro",
    "name": "Gemini 3.1 Pro",
    "upstreamModel": "galette-medium-thinking",
    "supportedReasoningEfforts": [
      "low",
      "medium"
    ],
    "defaultReasoningEffort": "medium"
  },
  {
    "id": "haiku-4.5",
    "name": "Haiku 4.5",
    "upstreamModel": "anthropic-haiku-4.5"
  },
  {
    "id": "gemini-3-flash",
    "name": "Gemini 3 Flash",
    "upstreamModel": "gingerbread"
  }
];

const EFFORT_LABELS = {none:'关闭',minimal:'最低',low:'低',medium:'中',high:'高',xhigh:'极高',max:'最高'};
const NUMBER_DEFAULTS = {timeoutMs:120000,idleTimeoutMs:60000,maxRequestBytes:8388608,maxResponseBytes:33554432};
const EMPTY_CATALOG = Object.freeze({status:'idle',value:null,error:null});
const EMPTY_STORE = {getSnapshot:()=>EMPTY_CATALOG,subscribe:()=>()=>{}};
const COMPLETION_LABELS = [['stream-end','正常结束且有正文'],['final-record','要求最终记录'],['verified-marker','验证指定结束标记']];
function makeDraft(value = {}) {
  const {cookie,...safe}=value;
  return {notionHost:'app.notion.com',cookieEnv:'NOTION_COOKIE',completionMode:'stream-end',createThread:true,precreateThread:true,...NUMBER_DEFAULTS,...safe,
    autoDiscover:safe.autoDiscover!==false,autoModels:safe.autoModels!==false,defaultReasoningEffort:safe.defaultReasoningEffort || '',
    modelsText:JSON.stringify(safe.models?.length?safe.models:DEFAULT_MODELS,null,2),cookie:''};
}
function mutationFor(draft,clearCookie=false) {
  let models;try{models=JSON.parse(draft.modelsText);}catch{throw new Error('模型目录必须为有效 JSON 数组。');}
  if(!Array.isArray(models)||!models.length)throw new Error('模型目录至少需要一项。');
  const ids=new Set();for(const model of models){if(!model || typeof model.id!=='string' || !model.id.trim() || ids.has(model.id.trim()))throw new Error('模型 ID 不得为空或重复。');ids.add(model.id.trim());}
  const fields=['enabled','notionHost','autoDiscover','autoModels','defaultReasoningEffort','cookieEnv','spaceId','userId','clientVersion','toolBridge','createThread','precreateThread','completionMode','terminalType','terminalPath','terminalValue','captureDir',...Object.keys(NUMBER_DEFAULTS)];
  const ops=fields.filter(key=>draft[key]!==undefined).map(key=>{
    let value=draft[key];if(key in NUMBER_DEFAULTS){value=value===''?NUMBER_DEFAULTS[key]:Number(value);if(!Number.isSafeInteger(value)||value<=0)throw new Error(key+' 必须为正整数。');}
    return {op:'set',path:[key],value};
  });
  ops.push({op:'set',path:['models'],value:models});
  if(clearCookie)ops.push({op:'set',path:['cookie'],value:''});
  else if(draft.cookie?.trim())ops.push({op:'set',path:['cookie'],value:draft.cookie.trim()});
  return ops;
}
const effortLabel=id=>Object.hasOwn(EFFORT_LABELS,id)?EFFORT_LABELS[id]:id;
function displayModel(model,source) {
  const known=DEFAULT_MODELS.find(item=>item.upstreamModel===model.upstreamModel || item.id===model.id);
  const declared=model.supportedReasoningEfforts ?? known?.supportedReasoningEfforts;
  const levels=Array.isArray(model.reasoning?.efforts) ? model.reasoning.efforts.filter(e=>e && typeof e.id==='string' && typeof e.name==='string') : (Array.isArray(declared)?declared:[]).filter(id=>typeof id==='string').map(id=>({id,name:effortLabel(id)}));
  return {id:model.id,name:typeof model.name==='string'&&model.name?model.name:model.id,efforts:levels,source};
}
function modelsForDisplay(draft,catalog) {
  const group=catalog?.value?.groups?.find(item=>item.id===PROVIDER_ID);
  if(draft.autoModels!==false && group) {
    const models=group.models.map(model=>displayModel({...model,reasoning:model.reasoning || {efforts:[]}},catalog.status==='ready'?(model.description?.includes('离线快照')?'offline':model.description?.includes('手动配置')?'manual':'catalog'):'cached'));
    const source=catalog.status!=='ready'?'cached':models.length && models.every(m=>m.source!=='catalog')?(models.some(m=>m.source==='offline')?'offline':'manual'):'catalog';
    return {models,source};
  }
  let configured=[];try{const value=JSON.parse(draft.modelsText);if(Array.isArray(value))configured=value.filter(m=>m && typeof m.id==='string');}catch{}
  if(draft.autoModels===false)return {models:configured.map(m=>displayModel(m,'manual')),source:'manual'};
  const models=DEFAULT_MODELS.map(entry=>configured.find(m=>m.upstreamModel===entry.upstreamModel)||entry);
  for(const entry of configured)if(!models.some(m=>m.id===entry.id))models.push(entry);
  return {models:models.map(m=>displayModel(m,'offline')),source:'offline'};
}
const ICONS={link:'M10 13a5 5 0 0 0 7 .1l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7-.1l-3 3a5 5 0 0 0 7 7l2-2',spark:'m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3',shield:'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3m-4 9 3 3 5-6',search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',refresh:'M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3',settings:'M4 7h16M4 17h16M8 4v6M16 14v6',check:'m5 12 4 4L19 6'};
function icon(name){return h('svg',{viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true,className:'ns-icon'},h('path',{d:ICONS[name]||ICONS.settings}));}
function sectionTitle(symbol,title,detail,action){return h('div',{className:'ns-section-head'},h('div',{className:'ns-section-title'},h('span',{className:'ns-section-icon'},icon(symbol)),h('div',null,h('h2',null,title),detail&&h('p',null,detail))),action);}
function NotionSettings({form,mirror,reloadModels,catalogStore=EMPTY_STORE}) {
  const snapshot=useSyncExternalStore(listener=>form.subscribe(listener),()=>form.getSnapshot());
  const metadata=useSyncExternalStore(listener=>mirror.subscribe(listener),()=>mirror.getSnapshot());
  const catalog=useSyncExternalStore(listener=>catalogStore.subscribe(listener),()=>catalogStore.getSnapshot());
  const [draft,setDraft]=useState(()=>makeDraft(snapshot.value));
  const [dirty,setDirty]=useState(false),[revision,setRevision]=useState(snapshot.revision),[busy,setBusy]=useState(false),[refreshing,setRefreshing]=useState(false);
  const [message,setMessage]=useState(''),[error,setError]=useState(false),[query,setQuery]=useState(''),[showAll,setShowAll]=useState(false),[confirmClear,setConfirmClear]=useState(false);
  useEffect(()=>{if(!dirty&&snapshot.status==='ready'){setDraft(makeDraft(snapshot.value));setRevision(snapshot.revision);}},[snapshot.value,snapshot.revision,snapshot.status,dirty]);
  const secretSet=metadata.view?.namespaces?.find(entry=>entry.ns===form.entryId)?.secrets?.some(secret=>secret.path.join('.')==='cookie'&&secret.set);
  const change=(key,value)=>{setDirty(true);setConfirmClear(false);setDraft(previous=>({...previous,[key]:value}));};
  const display=useMemo(()=>modelsForDisplay(draft,catalog),[draft.modelsText,draft.autoModels,catalog]);
  const needle=query.trim().toLowerCase();
  const filtered=display.models.filter(model=>(model.name+' '+model.id).toLowerCase().includes(needle));
  const visible=filtered.slice(0,showAll?filtered.length:6);
  const effortIds=[...new Set(display.models.flatMap(model=>model.efforts.map(e=>e.id)))];
  if(draft.defaultReasoningEffort && !effortIds.includes(draft.defaultReasoningEffort))effortIds.push(draft.defaultReasoningEffort);
  const conflict=dirty&&snapshot.revision!==revision;
  const readOnly=snapshot.writable===false;
  const saving=useRef(false);
  const refresh=async()=>{setRefreshing(true);setError(false);setMessage('');try{await reloadModels?.();setMessage('目录已刷新。模型可选不等于已通过推理测试。');}catch{setError(true);setMessage('目录刷新失败，已保留现有列表。请检查账号与网络。');}finally{setRefreshing(false);}};
  const save=async(clearCookie=false)=>{
    if(saving.current)return;
    if(readOnly){setError(true);setMessage('当前配置只读，无法保存。');return;}
    saving.current=true;
    setBusy(true);setMessage('');setError(false);
    try{
      const ok=await form.mutate(mutationFor(draft,clearCookie),revision);
      if(!ok){setError(true);setMessage('保存被拒绝或配置已由其他窗口更新。草稿已保留；请撤销更改以载入最新配置。');return;}
      setDraft(previous=>({...previous,cookie:''}));setDirty(false);setConfirmClear(false);setMessage('已保存。');
      try{await reloadModels?.();setMessage('已保存并刷新模型目录。');}catch{setError(true);setMessage('配置已保存，但目录刷新失败；稍后可单独刷新。');}
    }catch(cause){setError(true);setMessage(cause.message || '保存失败，草稿已保留。');}finally{saving.current=false;setBusy(false);}
  };
  const reset=()=>{setDraft(makeDraft(snapshot.value));setRevision(snapshot.revision);setDirty(false);setMessage('');setError(false);setConfirmClear(false);};
  const field=(key,title,detail,type='text',extra={})=>h('label',{className:'ns-field',key},h('span',null,title),h('input',{id:'notion-'+key,type,value:draft[key]??'',autoComplete:type==='password'?'new-password':'off',spellCheck:false,...extra,onChange:event=>change(key,type==='number'?(event.target.value===''?'':Number(event.target.value)):event.target.value)}),detail&&h('small',null,detail));
  const select=(key,title,choices,detail)=>h('label',{className:'ns-field',key},h('span',null,title),h('select',{id:'notion-'+key,value:draft[key]??'',onChange:event=>change(key,event.target.value)},choices.map(([value,label])=>h('option',{key:value,value},label))),detail&&h('small',null,detail));
  const toggle=(key,title,detail)=>h('label',{className:'ns-toggle',key},h('div',null,h('strong',null,title),detail&&h('small',null,detail)),h('input',{type:'checkbox',role:'switch',checked:draft[key]===true,onChange:event=>change(key,event.target.checked),'aria-label':title}));
  if(snapshot.status!=='ready')return h('section',{className:'notion-settings notion-v3'},h('div',{className:'ns-panel'},h('h2',null,'Notion AI'),h('p',{role:'status'},snapshot.status==='unavailable'?'当前 Host 不提供可持久化的本地插件配置。':'正在读取插件配置…')));
  return h('form',{className:'notion-settings notion-v3',onSubmit:event=>{event.preventDefault();void save();}},
    h('header',{className:'ns-header'},h('div',{className:'ns-brand'},h('span',{className:'ns-brand-mark','aria-hidden':true},'N'),h('div',null,h('div',{className:'ns-eyebrow'},'SUBSCRIPTION PROVIDER'),h('h1',null,'Notion AI'),h('p',null,'你的订阅，你的模型，你的思考方式。'))),h('div',{className:'ns-header-state'},h('span',{className:'ns-badge'},'实验性 · 非官方接口'),h('label',{className:'ns-enable'},h('input',{type:'checkbox',role:'switch',checked:draft.enabled===true,disabled:busy||readOnly,'aria-label':'启用 Notion 线路',onChange:event=>change('enabled',event.target.checked)}),'启用线路'))),
    h('div',{className:'ns-overview'},
      h('div',{className:'ns-stat'},h('span',null,'目录条目'),h('strong',null,display.models.length),h('small',null,display.source==='manual'?'手动配置':display.source==='offline'?'离线快照':'账号目录 / 缓存')),
      h('div',{className:'ns-stat'},h('span',null,'可选思考档位'),h('strong',null,display.models.filter(m=>m.efforts.length).length,h('em',null,' 个模型')),h('small',null,'按模型能力展示，不强行套用')),
      h('div',{className:'ns-stat ns-stat-account'},h('span',null,'凭据状态'),h('strong',null,icon('shield'),secretSet?'已配置':'待配置 / 环境变量'),h('small',null,'不代表 AI 连接已验证'))),
    h('fieldset',{className:'ns-controls',disabled:busy||readOnly},
      h('section',{className:'ns-panel'},sectionTitle('link','连接与凭据','沿用现有账号和工作区，不自动切换身份。'),
        h('div',{className:'ns-credential'},field('cookie',secretSet?'更新 Cookie / token_v2':'Cookie / token_v2',secretSet?'已保存的凭据不会回显；留空保存不会覆盖。':'也可通过 Host 环境变量提供；不会读取浏览器 Cookie 数据库。','password',{placeholder:secretSet?'已保存 · 仅在需要更新时填写':'粘贴你本人账号的 token_v2 或单行 Cookie'}),h('span',{className:'ns-badge'},secretSet?'仅写入，不回显':'本人授权的登录态')),
        h('div',{className:'ns-inline-note'},icon('shield'),h('span',null,'本地保存不等于加密。实际调用可能创建会话并消耗订阅额度或 credits。')),
        h('details',{className:'ns-details'},h('summary',null,'身份、域名与凭据管理',h('span',null,draft.spaceId?'已指定工作区':'自动识别')),
          h('div',{className:'ns-details-body'},toggle('autoDiscover','自动识别身份','多个工作区时需指定目标，避免误用权限或额度。'),h('div',{className:'ns-grid'},
            select('notionHost','Notion API 域名',[['app.notion.com','app.notion.com'],['www.notion.so','www.notion.so（兼容选项）']]),field('cookieEnv','凭据环境变量名','Cookie 留空时读取，界面不检查环境变量内容。'),field('spaceId','工作区 spaceId',draft.autoDiscover?'可自动识别；多工作区时请指定。':'关闭自动识别时必填。'),field('userId','用户 userId',draft.autoDiscover?'可自动识别，也可手动指定。':'关闭自动识别时必填。')),
            h('div',{className:'ns-danger-zone'},h('p',null,'清除仅影响 Host 保存的 Cookie，不删除环境变量。'),confirmClear?h('div',{className:'ns-actions'},h('button',{type:'button',className:'ns-button ns-danger',onClick:()=>void save(true)},'确认清除 Cookie'),h('button',{type:'button',className:'ns-button',onClick:()=>setConfirmClear(false)},'取消')):h('button',{type:'button',className:'ns-button ns-danger',disabled:!secretSet||dirty,onClick:()=>setConfirmClear(true),title:dirty?'请先保存或撤销其他改动':''},'清除已保存 Cookie'))))),
      h('section',{className:'ns-panel'},sectionTitle('spark','模型与思考强度','会话选择优先；不指定策略时不覆盖 Notion 默认值。',h('button',{type:'button',className:'ns-button',disabled:refreshing||!reloadModels,onClick:()=>void refresh()},icon('refresh'),refreshing?'正在刷新…':'刷新目录')),
        h('div',{className:'ns-policy'},toggle('autoModels','自动发现账号模型','过滤禁用项，保留手动别名；网络异常时使用标记的离线快照。'),select('defaultReasoningEffort','插件默认思考强度',[['','跟随模型默认（推荐）'],...effortIds.map(id=>[id,effortLabel(id)+' · '+id])],'仅对支持该档位的模型生效；会话选择优先。')),
        h('div',{className:'ns-model-toolbar'},h('label',{className:'ns-search'},icon('search'),h('input',{type:'search',value:query,'aria-label':'搜索模型',placeholder:'搜索模型名称或 ID…',onKeyDown:event=>{if(event.key==='Enter')event.preventDefault();},onChange:event=>{setQuery(event.target.value);setShowAll(false);}})),h('span',{className:'ns-count'},filtered.length+' 个条目')),
        (display.source==='offline'||display.source==='cached'||catalog.status==='error')&&h('p',{className:'ns-notice',role:'status'},display.source==='offline'?'当前展示本地快照，不能据此确认账号权限或模型连通性。':'目录正在刷新或暂时不可用，当前显示上次缓存。'),
        dirty&&h('p',{className:'ns-muted'},'目录基于已保存配置；当前改动保存后生效。'),
        h('div',{className:'ns-model-grid',role:'list','aria-label':'模型目录'},visible.map(model=>h('article',{className:'ns-model-card',key:model.id,role:'listitem'},h('div',{className:'ns-model-heading'},h('div',null,h('h3',null,model.name),h('code',{title:model.id},model.id)),h('span',{className:'ns-source'},model.source==='offline'?'快照':model.source==='manual'?'手动':model.source==='cached'?'缓存':'目录')),h('div',{className:'ns-effort-row'},h('span',null,'思考'),model.efforts.length?h('div',{className:'ns-efforts'},model.efforts.map(e=>h('span',{className:'ns-effort',key:e.id,title:e.id},e.name))):h('span',{className:'ns-no-effort'},'未声明可选档位'))))),
        !filtered.length&&h('p',{className:'ns-empty'},query?'没有匹配的模型。':'当前目录没有可用模型；请检查账号目录或手动映射。'),
        filtered.length>6&&h('button',{type:'button',className:'ns-show-more',onClick:()=>setShowAll(!showAll)},showAll?'收起模型列表':'展开其余 '+(filtered.length-6)+' 个模型'),
        h('p',{className:'ns-muted'},'这些档位可在 DSH 聊天页的模型菜单中选择；不展示隐藏思考过程。')),
      h('details',{className:'ns-panel ns-advanced'},h('summary',null,h('span',{className:'ns-section-title'},h('span',{className:'ns-section-icon'},icon('settings')),h('span',null,h('strong',null,'高级设置'),h('small',null,'手动映射、请求限制、协议与本地诊断')))),
        h('div',{className:'ns-advanced-body'},
          h('details',{className:'ns-details'},h('summary',null,'手动模型映射 JSON'),h('div',{className:'ns-details-body'},h('label',{className:'ns-field'},h('span',null,'模型目录 JSON'),h('textarea',{rows:9,value:draft.modelsText,spellCheck:false,onChange:event=>change('modelsText',event.target.value)}),h('small',null,'自动发现开启时保留别名并合并目录。id 不得重复；上游 ID 与思考档位不要凭名称猜测。')))),
          h('h3',{className:'ns-subtitle'},'请求与资源限制'),h('div',{className:'ns-grid'},field('timeoutMs','请求超时（毫秒）','留空恢复 120000。','number',{min:1,step:1}),field('idleTimeoutMs','流空闲超时（毫秒）','留空恢复 60000。','number',{min:1,step:1}),field('maxRequestBytes','最大请求（字节）','留空恢复 8 MiB。','number',{min:1,step:1}),field('maxResponseBytes','最大响应（字节）','留空恢复 32 MiB。','number',{min:1,step:1})),
          h('h3',{className:'ns-subtitle'},'协议兼容'),h('div',{className:'ns-grid'},select('completionMode','完成判定',COMPLETION_LABELS),field('clientVersion','Notion 客户端版本','留空使用随包版本。')),
          draft.completionMode==='verified-marker'&&h('div',{className:'ns-grid'},field('terminalType','已确认的结束帧 type'),field('terminalPath','可选 JSON Pointer'),field('terminalValue','该路径需匹配的值')),
          toggle('toolBridge','实验性文本工具桥接','不是 Notion 原生 Function Calling；默认保持关闭。'),toggle('createThread','由 workflow 请求创建会话'),toggle('precreateThread','兼容旧模式的线程预创建'),
          h('h3',{className:'ns-subtitle'},'本地诊断'),field('captureDir','抓包目录（留空关闭）','不会默认保存响应。诊断文件仍可能含完整对话和工作区资料，不能直接上传。'),h('p',{className:'ns-notice'},'只支持文本。此插件不续期登录态，不绕过权限或验证码，也不报告猜测用量。初始参考 notion2api，当前能力以账号目录为准。')))),
    conflict&&h('div',{className:'ns-message ns-error',role:'alert'},'配置已在其他窗口更新，当前草稿已保留。撤销更改可载入最新配置。'),
    message&&h('div',{className:'ns-message'+(error?' ns-error':''),role:error?'alert':'status'},message),
    h('footer',{className:'ns-savebar'},h('div',{className:'ns-save-state'},h('span',{className:'ns-state-dot'+(dirty?' is-dirty':'')}),h('div',null,h('strong',null,dirty?'有未保存的更改':'设置已同步'),h('small',null,'留空的 Cookie 不会覆盖已保存凭据。'))),h('div',{className:'ns-actions'},h('button',{type:'button',className:'ns-button',disabled:busy||readOnly||!dirty,onClick:reset},'撤销更改'),h('button',{type:'button',className:'ns-button ns-primary',disabled:busy||readOnly,onClick:()=>void save()},icon('check'),busy?'正在保存…':'保存并刷新模型'))));
}
const STYLES = [
  ".notion-v3{--ns-accent:#4f46e5;--ns-border:color-mix(in srgb,currentColor 14%,transparent);--ns-soft:color-mix(in srgb,currentColor 4%,transparent);--ns-muted:color-mix(in srgb,currentColor 65%,transparent);max-width:1080px;margin:0 auto;padding:28px 24px 20px;color:inherit;font-family:inherit;font-size:14px;line-height:1.5;box-sizing:border-box}",
  ".notion-v3 *{box-sizing:border-box}",
  ".notion-v3 button,.notion-v3 input,.notion-v3 select,.notion-v3 textarea{font:inherit}",
  ".notion-v3 h1,.notion-v3 h2,.notion-v3 h3,.notion-v3 p{margin:0}",
  ".notion-v3 button{cursor:pointer}",
  ".notion-v3 button:disabled{cursor:not-allowed;opacity:.5}",
  ".notion-v3 :focus-visible{outline:3px solid color-mix(in srgb,var(--ns-accent) 65%,transparent);outline-offset:3px}",
  ".ns-icon{width:18px;height:18px;flex:none}",
  ".ns-header,.ns-brand,.ns-header-state,.ns-enable,.ns-actions,.ns-section-head,.ns-section-title{display:flex;align-items:center}",
  ".ns-header{justify-content:space-between;gap:20px;margin-bottom:24px}",
  ".ns-brand{gap:16px}",
  ".ns-brand-mark{display:grid;place-items:center;width:58px;height:58px;border:1.5px solid currentColor;border-radius:15px;font:700 39px Georgia,serif;box-shadow:3px 3px 0 var(--ns-border);transform:rotate(-3deg);flex:none}",
  ".ns-eyebrow{font-size:10px;font-weight:700;letter-spacing:.17em;color:var(--ns-muted)}",
  ".notion-v3 h1{font-size:28px;line-height:1.35;font-weight:750;letter-spacing:-.04em}",
  ".ns-brand p{font-size:12px;color:var(--ns-muted);margin-top:2px}",
  ".ns-header-state{align-items:flex-end;flex-direction:column;gap:12px}",
  ".ns-badge{display:inline-flex;align-items:center;border:1px solid var(--ns-border);border-radius:99px;padding:3px 9px;font-size:11px;white-space:nowrap;color:var(--ns-muted)}",
  ".ns-enable{gap:9px;font-size:13px}",
  ".notion-v3 input[type=checkbox]{accent-color:var(--ns-accent);width:17px;height:17px;cursor:pointer}",
  ".ns-overview{display:grid;grid-template-columns:1fr 1fr 1.25fr;margin-bottom:22px;border:1px solid var(--ns-border);border-radius:14px;overflow:hidden;background:var(--ns-soft)}",
  ".ns-stat{padding:17px 22px;display:flex;flex-direction:column;gap:3px}",
  ".ns-stat+.ns-stat{border-left:1px solid var(--ns-border)}",
  ".ns-stat>span{font-size:11px;color:var(--ns-muted)}",
  ".ns-stat>strong{font-size:27px;line-height:1.35;font-weight:650;font-variant-numeric:tabular-nums;display:flex;align-items:center;gap:8px}",
  ".ns-stat em{font-size:12px;font-style:normal;font-weight:400;color:var(--ns-muted)}",
  ".ns-stat small{font-size:11px;color:var(--ns-muted)}",
  ".ns-stat-account>strong{font-size:17px;margin:5px 0}",
  ".ns-controls{border:0;margin:0;padding:0;min-width:0}",
  ".ns-panel{border:1px solid var(--ns-border);border-radius:15px;padding:23px;margin-bottom:18px;background:color-mix(in srgb,currentColor 1%,transparent);box-shadow:0 3px 16px #00000003}",
  ".ns-section-head{gap:15px;justify-content:space-between;margin-bottom:21px}",
  ".ns-section-title{gap:12px;min-width:0}",
  ".ns-section-icon{width:35px;height:35px;display:grid;place-items:center;border-radius:10px;background:var(--ns-soft);flex:none}",
  ".notion-v3 h2{font-size:16px;font-weight:650;letter-spacing:-.02em}",
  ".ns-section-title p{font-size:12px;color:var(--ns-muted);margin-top:3px}",
  ".ns-field{display:flex;flex-direction:column;gap:7px;min-width:0}",
  ".ns-field>span{font-size:12px;font-weight:550}",
  ".ns-field small{font-size:11px;line-height:1.65;color:var(--ns-muted)}",
  ".notion-v3 .ns-field input,.notion-v3 select,.ns-field textarea,.ns-search input{width:100%;min-width:0;background:transparent;color:inherit;border:1px solid var(--ns-border);border-radius:8px;padding:10px 12px;outline-offset:2px;transition:border-color .15s}",
  ".notion-v3 select option{background:Canvas;color:CanvasText}",
  ".notion-v3 input::placeholder{color:var(--ns-muted);opacity:.7}",
  ".notion-v3 .ns-field input:hover,.notion-v3 select:hover{border-color:color-mix(in srgb,currentColor 32%,transparent)}",
  ".ns-field textarea{font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.7;resize:vertical}",
  ".ns-credential{display:grid;grid-template-columns:1fr auto;gap:16px;align-items:center}",
  ".ns-inline-note{display:flex;gap:9px;align-items:center;padding:12px 0;font-size:11px;color:var(--ns-muted)}",
  ".ns-inline-note .ns-icon{width:15px;height:15px}",
  ".ns-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px 20px}",
  ".ns-toggle{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:12px 0;cursor:pointer}",
  ".ns-toggle strong{font-weight:550;font-size:13px}",
  ".ns-toggle small{display:block;color:var(--ns-muted);font-size:11px;line-height:1.6;margin-top:3px}",
  ".ns-toggle input{flex:none}",
  ".ns-details{border-top:1px solid var(--ns-border);margin-top:7px}",
  ".ns-details>summary,.ns-advanced>summary{cursor:pointer;list-style:none}",
  ".ns-details>summary::-webkit-details-marker,.ns-advanced>summary::-webkit-details-marker{display:none}",
  ".ns-details>summary{padding:14px 0 3px;font-size:12px;display:flex;justify-content:space-between;gap:15px}",
  ".ns-details>summary:after{content:\"+\";margin-left:auto;font-size:16px;line-height:1}",
  ".ns-details[open]>summary:after{content:\"−\"}",
  ".ns-details>summary>span{color:var(--ns-muted);font-size:11px}",
  ".ns-details-body{padding-top:17px}",
  ".ns-details-body>.ns-toggle:first-child{padding-top:0;padding-bottom:20px}",
  ".ns-danger-zone{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:22px;padding-top:16px;border-top:1px dashed var(--ns-border)}",
  ".ns-danger-zone p{color:var(--ns-muted);font-size:11px}",
  ".ns-policy{display:grid;grid-template-columns:1.1fr 1fr;gap:25px;align-items:center;padding:16px 18px;border-radius:10px;background:var(--ns-soft);margin-bottom:20px}",
  ".ns-policy .ns-toggle{padding:0}",
  ".ns-model-toolbar{display:flex;align-items:center;justify-content:space-between;gap:15px;margin-bottom:15px}",
  ".ns-search{position:relative;max-width:420px;flex:1}",
  ".ns-search>.ns-icon{position:absolute;top:11px;left:12px;color:var(--ns-muted);width:16px;height:16px}",
  ".ns-search input{padding:9px 12px 9px 36px;font-size:12px}",
  ".ns-count{color:var(--ns-muted);font-size:11px;white-space:nowrap}",
  ".ns-model-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px}",
  ".ns-model-card{border:1px solid var(--ns-border);border-radius:10px;padding:15px 16px;min-width:0;transition:border-color .16s,background .16s}",
  ".ns-model-card:hover{border-color:color-mix(in srgb,currentColor 30%,transparent);background:var(--ns-soft)}",
  ".ns-model-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}",
  ".ns-model-heading>div{min-width:0}",
  ".ns-model-heading h3{font-size:13px;font-weight:600;line-height:1.5;overflow-wrap:anywhere}",
  ".ns-model-heading code{display:block;font-family:ui-monospace,Consolas,monospace;color:var(--ns-muted);font-size:10px;margin-top:3px;text-overflow:ellipsis;overflow:hidden;white-space:nowrap}",
  ".ns-source{font-size:10px;color:var(--ns-muted);white-space:nowrap}",
  ".ns-effort-row{display:flex;align-items:flex-start;gap:11px;margin-top:14px;font-size:10px;color:var(--ns-muted)}",
  ".ns-effort-row>span{padding-top:3px;flex:none}",
  ".ns-efforts{display:flex;flex-wrap:wrap;gap:4px}",
  ".ns-effort{padding:2px 7px;border:1px solid var(--ns-border);background:var(--ns-soft);border-radius:5px;font-size:10px;color:inherit}",
  ".ns-no-effort{font-size:10px}",
  ".notion-v3 .ns-muted{font-size:11px;color:var(--ns-muted);margin-top:13px}",
  ".ns-show-more{display:block;width:100%;border:0;background:transparent;color:var(--ns-muted);padding:13px 0 0;font-size:12px}",
  ".ns-empty{padding:28px;text-align:center;font-size:13px;color:var(--ns-muted)}",
  ".notion-v3 .ns-notice{padding:11px 13px;margin-bottom:14px;border-left:2px solid #b58b32;background:var(--ns-soft);color:var(--ns-muted);font-size:11px;line-height:1.7}",
  ".ns-advanced>summary{display:flex;align-items:center;justify-content:space-between;gap:12px}",
  ".ns-advanced>summary:after{content:\"+\";font-size:20px;color:var(--ns-muted)}",
  ".ns-advanced[open]>summary:after{content:\"−\"}",
  ".ns-advanced summary strong{font-size:14px;font-weight:600}",
  ".ns-advanced summary small{display:block;font-size:11px;color:var(--ns-muted);margin-top:3px}",
  ".ns-advanced-body{padding-top:19px}",
  ".ns-advanced-body .ns-details{margin-top:0;padding-top:0}",
  ".ns-subtitle{font-size:12px!important;font-weight:600;margin:24px 0 14px!important}",
  ".ns-message{margin:14px 0;padding:12px 15px;border:1px solid var(--ns-border);border-radius:9px;font-size:12px;white-space:pre-wrap}",
  ".ns-message.ns-error{border-color:#dc735b;color:inherit;border-left-width:3px}",
  ".ns-savebar{position:sticky;bottom:0;z-index:3;display:flex;justify-content:space-between;align-items:center;gap:20px;padding:16px 18px;margin-top:22px;border:1px solid var(--ns-border);border-radius:12px;background:color-mix(in srgb,Canvas 92%,transparent);color:CanvasText;backdrop-filter:blur(18px);box-shadow:0 -8px 24px #00000006}",
  ".ns-save-state{display:flex;gap:10px;align-items:center}",
  ".ns-save-state strong{display:block;font-size:12px;font-weight:550}",
  ".ns-save-state small{display:block;font-size:10px;color:var(--ns-muted);margin-top:3px}",
  ".ns-state-dot{width:7px;height:7px;border-radius:50%;background:#7b8797;flex:none}",
  ".ns-state-dot.is-dirty{background:#d9962b}",
  ".ns-actions{gap:8px}",
  ".ns-button{border:1px solid var(--ns-border);border-radius:8px;background:transparent;color:inherit;display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:8px 12px;white-space:nowrap;font-size:12px!important;transition:background .15s}",
  ".ns-button:hover:not(:disabled){background:var(--ns-soft)}",
  ".ns-button.ns-primary{background:var(--ns-accent);border-color:var(--ns-accent);color:white;padding:10px 15px}",
  ".ns-button.ns-primary:hover:not(:disabled){background:#4338ca}",
  ".ns-button.ns-danger{color:inherit;border-color:color-mix(in srgb,#c4453a 40%,transparent)}",
  ".ns-button .ns-icon{width:15px;height:15px}",
  "@media(max-width:700px){.notion-v3{padding:20px 14px 16px}",
  ".ns-header{gap:12px;align-items:flex-start;margin-bottom:20px}",
  ".ns-brand{gap:12px}",
  ".ns-brand-mark{width:44px;height:44px;border-radius:11px;font-size:31px}",
  ".notion-v3 h1{font-size:23px}",
  ".ns-brand p{max-width:190px;line-height:1.6;font-size:11px}",
  ".ns-eyebrow{font-size:8px}",
  ".ns-header-state>.ns-badge{display:none}",
  ".ns-header-state{padding-top:8px}",
  ".ns-overview{grid-template-columns:1fr 1fr}",
  ".ns-stat{padding:13px 16px}",
  ".ns-stat-account{grid-column:1/-1;border-top:1px solid var(--ns-border);border-left:0!important;padding:11px 16px;display:grid;grid-template-columns:1fr 1fr;align-items:center}",
  ".ns-stat-account>strong{font-size:13px;margin:0;justify-content:flex-end}",
  ".ns-stat-account>small{grid-column:1/-1;margin-top:2px}",
  ".ns-stat-account .ns-icon{width:14px;height:14px}",
  ".ns-panel{padding:17px;border-radius:12px}",
  ".ns-section-head{align-items:flex-start;gap:10px}",
  ".ns-section-title{gap:9px}",
  ".ns-section-title p{font-size:11px}",
  ".ns-section-icon{width:29px;height:29px;border-radius:8px}",
  ".ns-section-icon .ns-icon{width:16px;height:16px}",
  ".notion-v3 h2{font-size:15px}",
  ".ns-section-head>.ns-button{padding:7px 9px;font-size:11px!important}",
  ".ns-section-head>.ns-button .ns-icon{display:none}",
  ".ns-credential{grid-template-columns:1fr;gap:8px}",
  ".ns-credential>.ns-badge{justify-self:start;font-size:10px}",
  ".ns-inline-note{align-items:flex-start;line-height:1.7;margin-top:5px}",
  ".ns-policy,.ns-grid,.ns-model-grid{grid-template-columns:1fr}",
  ".ns-policy{padding:14px;gap:17px}",
  ".ns-model-card{padding:13px 14px}",
  ".ns-savebar{gap:12px;padding:13px 12px;flex-wrap:wrap;border-radius:10px}",
  ".ns-save-state small{display:none}",
  ".ns-savebar .ns-actions{margin-left:auto}",
  ".ns-savebar .ns-button{padding:9px 10px;font-size:11px!important}",
  ".ns-savebar .ns-primary .ns-icon{display:none}",
  ".ns-danger-zone{align-items:flex-start;flex-direction:column}",
  ".ns-details>summary>span{font-size:10px}",
  ".ns-model-toolbar{gap:8px}",
  "}",
  "@media(prefers-reduced-motion:reduce){.notion-v3 *{transition:none!important;scroll-behavior:auto!important}",
  "}"
].join('\n');

const QUOTA_ENDPOINT='/api/dsh-notion-subscription/quota';
const QUOTA_LABELS={sixHour:'6 小时',monthly:'本月'};
const NULL_STORE={subscribe:()=>()=>{},getSnapshot:()=>null};
function quotaPercent(value){const rounded=Math.round(value*10)/10;return (Number.isInteger(rounded)?String(rounded):rounded.toFixed(1))+'%';}
function quotaAmount(value){return Number.isInteger(value)?String(value):String(Math.round(value*100)/100);}
function quotaReset(resetAt,now){if(typeof resetAt!=='number'||!Number.isFinite(resetAt))return '';const delta=resetAt-now;if(delta<=0)return '即将重置';const minutes=Math.ceil(delta/60000);if(minutes<60)return minutes+' 分钟后重置';const hours=Math.floor(minutes/60);if(hours<48)return hours+' 小时 '+(minutes%60)+' 分后重置';return Math.ceil(hours/24)+' 天后重置';}
function quotaLevel(remaining){return remaining<=5?'danger':remaining<=20?'warning':'normal';}
function quotaDetail(window,now){if(!window)return '暂无该窗口数据';return quotaAmount(window.used)+' / '+quotaAmount(window.limit)+' · '+(quotaReset(window.resetAt,now)||'未提供重置时间');}
function NotionComposerQuota({directory,request}){
  const store=directory||NULL_STORE;
  const modelState=useSyncExternalStore(listener=>store.subscribe(listener),()=>store.getSnapshot());
  const selected=modelState?.current;
  const active=selected?.provider===PROVIDER_ID;
  const [mode,setMode]=useState('sixHour');
  const [attempt,setAttempt]=useState(0);
  const [status,setStatus]=useState({phase:'idle'});
  const read=useMemo(()=>async()=>{
    const call=request||(typeof window!=='undefined'&&typeof window.fetch==='function'?window.fetch.bind(window):null);
    if(!call)throw new Error('当前环境不支持额度读取。');
    const response=await call(QUOTA_ENDPOINT,{headers:{Accept:'application/json'},credentials:'same-origin'});
    const body=await response.json();
    if(!response.ok||body?.ok!==true)throw new Error(body?.error?.message||'读取 Notion 额度失败。');
    return body.value;
  },[request]);
  useEffect(()=>{
    if(!active){setStatus({phase:'idle'});return;}
    let disposed=false;
    setStatus(previous=>previous.phase==='ready'?previous:{phase:'loading'});
    const run=async()=>{
      try{const value=await read();if(!disposed)setStatus({phase:'ready',value,fetchedAt:Date.now()});}
      catch(error){if(!disposed)setStatus({phase:'error',message:error instanceof Error?error.message:'读取 Notion 额度失败。'});}
    };
    void run();
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void run();},60000);
    return ()=>{disposed=true;window.clearInterval(timer);};
  },[active,read,attempt]);
  if(!active)return null;
  const now=Date.now();
  const value=status.phase==='ready'?status.value:null;
  const other=mode==='sixHour'?'monthly':'sixHour';
  const current=value?.windows?.[mode]||null;
  const fallback=value?.windows?.[other]||null;
  if(status.phase==='error')return h('div',{className:'ns-quota',role:'status'},h('span',{className:'ns-quota-text'},'Notion 额度暂不可用'),h('span',{className:'ns-quota-note'},status.message||''),h('button',{type:'button',className:'ns-quota-button',onClick:()=>setAttempt(count=>count+1)},'重试'));
  const blocked=value&&value.state!=='ready'?(value.message||'Notion 额度暂不可用'):null;
  if(blocked)return h('div',{className:'ns-quota',role:'status'},h('span',{className:'ns-quota-text'},blocked),h('button',{type:'button',className:'ns-quota-button',onClick:()=>setAttempt(count=>count+1)},'刷新'));
  if(!current&&!fallback)return h('div',{className:'ns-quota',role:'status'},h('span',{className:'ns-quota-text'},status.phase==='loading'?'正在读取 Notion 额度…':'Notion 未提供额度窗口数据'));
  const shown=current||fallback;
  const shownMode=current?mode:other;
  const level=quotaLevel(shown.remainingPercent);
  const detail=quotaDetail(shown,now);
  return h('div',{className:'ns-quota','data-level':level},h('button',{type:'button',className:'ns-quota-trigger',onClick:()=>setMode(shownMode===mode?other:mode),title:'点击切换为'+QUOTA_LABELS[shownMode===mode?other:mode]+'额度 · 基础 AI 额度，不含单独计费项目','aria-label':QUOTA_LABELS[shownMode]+'额度剩余 '+quotaPercent(shown.remainingPercent)+'，'+detail+'，点击切换'},h('span',{className:'ns-quota-label'},QUOTA_LABELS[shownMode]),h('strong',{className:'ns-quota-value'},'剩余 '+quotaPercent(shown.remainingPercent)),h('span',{className:'ns-quota-detail'},detail),h('span',{className:'ns-quota-switch','aria-hidden':true},'切换为'+(QUOTA_LABELS[shownMode===mode?other:mode]))),status.phase!=='ready'&&h('span',{className:'ns-quota-stale'},'读取中…'),value?.enforcement==='preview'&&h('span',{className:'ns-quota-preview'},'预览期'));
}
const QUOTA_CSS=[
'.ns-quota{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:6px;font-size:11px;line-height:1.5;color:var(--ns-muted,color-mix(in srgb,currentColor 65%,transparent))}',
'.ns-quota-trigger{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--ns-border,color-mix(in srgb,currentColor 14%,transparent));border-radius:99px;background:transparent;color:inherit;padding:3px 10px 3px 9px;font:inherit;cursor:pointer;transition:background .15s,border-color .15s}',
'.ns-quota-trigger:hover{background:var(--ns-soft,color-mix(in srgb,currentColor 4%,transparent))}',
'.ns-quota-trigger:focus-visible{outline:3px solid color-mix(in srgb,currentColor 45%,transparent);outline-offset:2px}',
'.ns-quota-label{opacity:.72;white-space:nowrap}.ns-quota-value{font-weight:600;white-space:nowrap}.ns-quota-detail{opacity:.66;white-space:nowrap}',
'.ns-quota-switch{opacity:.5;border-left:1px solid var(--ns-border,color-mix(in srgb,currentColor 14%,transparent));padding-left:8px;white-space:nowrap}',
'.ns-quota[data-level=warning] .ns-quota-value{color:#a9741c}.ns-quota[data-level=danger] .ns-quota-value{color:#c4453a}',
'.ns-quota-text{white-space:nowrap}.ns-quota-note{opacity:.6;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
'.ns-quota-button{border:1px solid var(--ns-border,color-mix(in srgb,currentColor 14%,transparent));border-radius:99px;background:transparent;color:inherit;font:inherit;padding:2px 9px;cursor:pointer}',
'.ns-quota-preview,.ns-quota-stale{opacity:.55;white-space:nowrap}',
'@media(max-width:560px){.ns-quota-detail{display:none}.ns-quota-switch{display:none}}'
].join('\n');

function apply(ctx){
  const form=ctx.configForms.get(PLUGIN_ID);
  if(!form)return;
  const view={entryId:PLUGIN_ID,getSnapshot:()=>form.getSnapshot(),subscribe:listener=>form.subscribe(listener),mutate:(ops,revision)=>form.mutate(ops,revision)};
  const mirror=ctx.configForms.describe();
  const catalog=ctx.modelDirectories?.catalog;
  const quotaDirectory=sessionId=>{try{return ctx.modelDirectories.directoryFor(sessionId).store;}catch{return null;}};
  const reloadModels=async()=>{if(typeof catalog?.load==='function'){catalog.invalidate?.();await catalog.load();const state=catalog.store?.getSnapshot();if(state?.status==='error'||(state?.value?.groups&&form.getSnapshot().value?.enabled&&!state.value.groups.some(group=>group.id===PROVIDER_ID)))throw new Error('Notion 模型目录暂不可用。');}};
  ctx.effect(()=>{const style=document.createElement('style');style.textContent=STYLES+'\n'+QUOTA_CSS;document.head.appendChild(style);return ()=>style.remove();},PLUGIN_ID+': styles');
  ctx.slots.inject('conversation.input.dock',()=>ctx.slots.register({name:'conversation.input.dock',id:PLUGIN_ID+'-quota',order:24,inject:(sessionId)=>({directory:quotaDirectory(sessionId)})},NotionComposerQuota));
  ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:PLUGIN_ID,order:46,label:()=> 'Notion AI 订阅'},()=>h(NotionSettings,{form:view,mirror,reloadModels,catalogStore:catalog?.store || EMPTY_STORE})));
}
module.exports={inject,apply,NotionSettings,NotionComposerQuota,makeDraft,mutationFor,DEFAULT_MODELS,modelsForDisplay,quotaPercent,quotaReset,quotaLevel,STYLES,QUOTA_CSS};
