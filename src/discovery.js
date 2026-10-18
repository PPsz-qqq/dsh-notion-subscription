import { DEFAULT_NOTION_HOST, NotionError, endpointFor, NOTION_LOAD_USER_CONTENT_PATH } from './options.js';
import { fetchNotionJson } from './http.js';
export { notionHeaders } from './http.js';
export const LOAD_USER_CONTENT_ENDPOINT = endpointFor(DEFAULT_NOTION_HOST, NOTION_LOAD_USER_CONTENT_PATH);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function choose(ids, preferred, label) {
  const unique=[...new Set(ids.filter((id)=>UUID.test(id)))];
  if(preferred) {
    if(!UUID.test(preferred)) throw new NotionError(label + ' UUID 无效。','INVALID_CONFIG');
    return preferred;
  }
  if(unique.length>1) throw new NotionError('检测到多个 ' + label + '；请在设置中填写对应 UUID，避免误用其他工作区。','IDENTITY_UNRESOLVED');
  return unique[0];
}
export async function discoverIdentity({ cookie, endpoint=LOAD_USER_CONTENT_ENDPOINT, host, clientVersion='', fetchFn=globalThis.fetch, attribution={}, timeoutMs=20000, signal, preferredSpaceId, preferredUserId }={}) {
  if(!cookie) throw new NotionError('缺少 token_v2，无法自动识别工作区；请在设置中填写。','MISSING_CREDENTIAL');
  const data=await fetchNotionJson(endpoint,{cookie,host,clientVersion,fetchFn,attribution,timeoutMs,signal});
  const records=data?.recordMap;
  if(!records || typeof records !== 'object') throw new NotionError('未能自动识别 Notion 工作区；请手动填写 spaceId 与 userId。','IDENTITY_UNRESOLVED');
  const userIds=Object.keys(records.notion_user || {});
  const cookieUser=cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith('notion_user_id='))?.slice('notion_user_id='.length);
  const userId=choose(userIds,preferredUserId || (userIds.includes(cookieUser) ? cookieUser : undefined),'用户');
  const spaceIds=Object.keys(records.space || {});
  if(!spaceIds.length) for(const record of Object.values(records.space_view || {})) { const value=record?.value?.value ?? record?.value; if(value?.space_id) spaceIds.push(value.space_id); }
  const spaceId=choose(spaceIds,preferredSpaceId,'工作区');
  if(!userId || !spaceId) throw new NotionError('未能自动识别 Notion 工作区；请确认有权限并手动填写 spaceId 与 userId。','IDENTITY_UNRESOLVED');
  const record=records.notion_user[userId]; const user=record?.value?.value ?? record?.value ?? {};
  const views=Object.entries(records.space_view || {});
  const match=views.find(([,r])=>(r?.value?.value ?? r?.value)?.space_id===spaceId);
  const spaceViewId=match?.[0] ?? (views.length===1 ? views[0][0] : '');
  return {userId,spaceId,spaceViewId,userName:user.given_name ?? user.name ?? '',userEmail:user.email ?? ''};
}
