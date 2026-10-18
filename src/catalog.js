import { reasoningConfiguration } from './reasoning.js';
import { MODEL_CATALOG, threadTypeFor } from './models.js';
import { NotionError } from './options.js';
import { fetchNotionJson } from './http.js';
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9.]+/g,'-').replace(/^-|-$/g,'');
export function parseAvailableModels(data) {
  if(!Array.isArray(data?.models)) throw new NotionError('Notion 模型目录格式无效。','PROTOCOL_ERROR');
  const models=[], disabled=[], seen=new Set(), ids=new Set();
  for(const row of data.models) {
    if(!row || typeof row.model !== 'string' || !/^[a-z0-9_.:/-]{1,160}$/i.test(row.model)) continue;
    if(row.isDisabled === true) { disabled.push(row.model); continue; }
    if(seen.has(row.model)) continue;
    const name=typeof row.modelMessage === 'string' && row.modelMessage.trim() ? row.modelMessage.trim().slice(0,160) : row.model;
    const id=MODEL_CATALOG.find((model)=>model.upstreamModel===row.model)?.id || slug(name) || row.model;
    if(ids.has(id)) continue;
    seen.add(row.model); ids.add(id);
    models.push({id,name,upstreamModel:row.model,threadType:threadTypeFor(id,row.model),source:'live',...reasoningConfiguration(row.modelConfiguration)});
  }
  return {models:models.filter(m=>!disabled.includes(m.upstreamModel)),disabled};
}
export function mergeCatalog(catalog, configured) {
  const models=catalog.models.flatMap((entry)=>{
    const aliases=configured.filter((model)=>model.upstreamModel===entry.upstreamModel);
    return aliases.length ? aliases.map(custom=>({...entry,...custom,source:entry.source,supportedReasoningEfforts:entry.supportedReasoningEfforts || [],defaultReasoningEffort:entry.defaultReasoningEffort})) : [entry];
  });
  const used=new Set(models.map(m=>m.id));
  if(used.size!==models.length) throw new NotionError('手动模型别名与账号目录冲突；请修改别名或关闭自动模型发现。','INVALID_CONFIG');
  for(const model of configured) {
    if(used.has(model.id) || catalog.disabled.includes(model.upstreamModel) || MODEL_CATALOG.some(m=>m.upstreamModel===model.upstreamModel)) continue;
    models.push({...model,source:'manual'}); used.add(model.id);
  }
  return models;
}
export function offlineCatalog(configured) {
  return mergeCatalog({models:MODEL_CATALOG.map(m=>({...m,threadType:threadTypeFor(m.id,m.upstreamModel),source:'offline'})),disabled:[]},configured);
}
export async function fetchAvailableModels(options, dependencies = {}) {
  return parseAvailableModels(await fetchNotionJson('https://' + options.host + '/api/v3/getAvailableModels',{
    ...options, ...dependencies, body:{spaceId:options.spaceId}, timeoutMs:Math.min(options.timeoutMs,10000), maxResponseBytes:1024*1024,
    attribution:{...dependencies.attribution,'x-notion-space-id':options.spaceId,'x-notion-active-user-header':options.userId},
  }));
}
