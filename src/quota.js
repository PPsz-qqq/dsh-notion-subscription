import {createHash} from 'node:crypto';
import {NotionError} from './options.js';
import {fetchNotionJson} from './http.js';
export const QUOTA_PATH='/api/dsh-notion-subscription/quota';
const EMPTY_WINDOWS={sixHour:null,monthly:null};
const MESSAGES={AUTH:'请更新 Notion 登录凭据。',PERMISSION:'当前账号无权读取此工作区额度。',IDENTITY_UNRESOLVED:'请先明确配置 Notion 工作区。',INVALID_CONFIG:'Notion 配置无效，请检查设置。',RATE_LIMIT:'额度读取受限，请稍后再试。',TIMEOUT:'读取 Notion 额度超时。',PROTOCOL_ERROR:'Notion 暂未提供可识别的额度窗口。',CONFIG_CHANGED:'配置已更新，等待重新读取额度。'};
const validNumber=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const validTime=value=>validNumber(value)&&value>0&&Number.isFinite(new Date(value).getTime())?value:null;
function windowData(value,resetAt){
  if(!value||value.creditType!=='basic_ai_credits'||!validNumber(value.used)||!validNumber(value.limit)||value.limit===0)return null;
  const usedPercent=value.used/value.limit*100;if(!Number.isFinite(usedPercent))return null;
  return {used:value.used,limit:value.limit,usedPercent,remainingPercent:Math.max(0,Math.min(100,100-usedPercent)),resetAt:validTime(resetAt),scope:['per_user','per_workspace','per_space'].includes(value.scope)?value.scope:'unknown'};
}
export function normalizeQuota(data,observedAt=Date.now()){
  if(data?.status==='not_applicable')return {state:'not_applicable',observedAt,windows:{...EMPTY_WINDOWS},message:'当前工作区不适用 Notion 基础 AI 额度。'};
  const sixHour=data?.window?.window==='6h'?windowData(data.window,validNumber(data.resetsInSeconds)?observedAt+data.resetsInSeconds*1000:null):null;
  const monthly=data?.billingPeriodWindow?.cadence==='billing_period'?windowData(data.billingPeriodWindow,data.billingPeriodWindow.periodEndMs):null;
  if(!sixHour&&!monthly)throw new NotionError('Notion 暂未提供可识别的额度窗口。','PROTOCOL_ERROR');
  return {state:'ready',observedAt,creditType:'basic_ai_credits',...(data.enforcement==='preview'?{enforcement:'preview'}:{}),windows:{sixHour,monthly}};
}
function unavailable(code,observedAt){return {state:'error',code,observedAt,windows:{...EMPTY_WINDOWS},message:MESSAGES[code]||'Notion 额度暂不可用，请稍后刷新。'};}
function scopeKey(options){return createHash('sha256').update(JSON.stringify([options.host,options.rawCookie,options.spaceId,options.userId])).digest('hex');}
export class NotionQuotaReader{
  constructor({readOptions,resolveIdentity,fetchFn=globalThis.fetch,onAuthFailure=()=>{},clock=Date.now}){this.readOptions=readOptions;this.resolveIdentity=resolveIdentity;this.fetchFn=fetchFn;this.onAuthFailure=onAuthFailure;this.clock=clock;this.cache=null;}
  invalidate(){this.cache=null;}
  async status(){
    let options;try{options={...this.readOptions()};}catch(error){this.invalidate();return unavailable(error.code||'INVALID_CONFIG',this.clock());}
    if(!options.enabled){this.invalidate();return {state:'disabled',observedAt:this.clock(),windows:{...EMPTY_WINDOWS},message:'Notion 线路尚未启用。'};}
    if(!options.rawCookie){this.invalidate();return unavailable('AUTH',this.clock());}
    const key=scopeKey(options),now=this.clock();
    if(this.cache?.key===key){if(this.cache.pending)return this.cache.pending;if(this.cache.expiresAt>now)return this.cache.value;}
    const entry={key,pending:null,value:null,expiresAt:0};this.cache=entry;
    entry.pending=this.load(options).then(value=>{
      let current;try{current=this.readOptions();}catch{return unavailable('CONFIG_CHANGED',this.clock());}
      if(this.cache!==entry||!current.enabled||scopeKey(current)!==key)return unavailable('CONFIG_CHANGED',this.clock());
      entry.value=value;entry.expiresAt=this.clock()+(value.state==='error'?15000:60000);
      const resets=Object.values(value.windows).filter(Boolean).map(window=>window.resetAt).filter(time=>time>this.clock());
      if(resets.length)entry.expiresAt=Math.min(entry.expiresAt,Math.min(...resets)+1000);
      return value;
    }).finally(()=>{entry.pending=null;});
    return entry.pending;
  }
  async load(options){
    const controller=new AbortController(),timeoutMs=Math.min(options.timeoutMs,10000);
    const timer=setTimeout(()=>controller.abort(new NotionError('额度读取超时。','TIMEOUT')),timeoutMs);
    try{
      options.timeoutMs=timeoutMs;
      await this.resolveIdentity(options,controller.signal);
      const data=await fetchNotionJson('https://'+options.host+'/api/v3/getCreditRateLimitStatus',{
        ...options,fetchFn:this.fetchFn,signal:controller.signal,timeoutMs,maxResponseBytes:1048576,
        body:{spaceId:options.spaceId},attribution:{'x-notion-space-id':options.spaceId,'x-notion-active-user-header':options.userId},
      });
      return normalizeQuota(data,this.clock());
    }catch(error){if(error.code==='AUTH')this.onAuthFailure();return unavailable(error.code||'TRANSPORT',this.clock());}
    finally{clearTimeout(timer);}
  }
}
function send(response,status,body){response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(status===405?{Allow:'GET'}:{})});response.end(JSON.stringify(body));}
export function quotaHandler(reader){return async(request,response)=>{
  let path;try{path=new URL(request.url||'/','http://dsh.local').pathname;}catch{send(response,400,{ok:false,error:{code:'BAD_REQUEST',message:'无效请求。'}});return;}
  if(path!==QUOTA_PATH){send(response,404,{ok:false,error:{code:'NOT_FOUND',message:'接口不存在。'}});return;}
  if(request.method!=='GET'){send(response,405,{ok:false,error:{code:'METHOD_NOT_ALLOWED',message:'仅允许读取额度。'}});return;}
  const origin=request.headers.origin;let crossOrigin=request.headers['sec-fetch-site']==='cross-site';
  if(origin!==undefined){try{crossOrigin ||= new URL(origin).host!==request.headers.host;}catch{crossOrigin=true;}}
  if(crossOrigin){send(response,403,{ok:false,error:{code:'CROSS_ORIGIN',message:'不允许跨站读取额度。'}});return;}
  try{send(response,200,{ok:true,value:await reader.status()});}catch{send(response,500,{ok:false,error:{code:'UNAVAILABLE',message:'Notion 额度暂不可用。'}});}
};}
export function registerQuotaRoute(ctx,reader){return ctx.webServer.register({kind:'exact',path:QUOTA_PATH,handler:quotaHandler(reader)});}
