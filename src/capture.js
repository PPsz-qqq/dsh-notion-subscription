import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
const PRIVATE_KEYS=new Set(['cookie','setcookie','authorization','proxyauthorization','tokenv2','accesstoken','refreshtoken','apikey','password','secret','secretkey']);
const HEADER_KEYS=new Set(['content-type','accept','origin','referer','notion-client-version','notion-audit-log-platform']);
export class CaptureSink {
  constructor({enabled=false,directory='',cookie='',maxBytes=40*1024*1024}={}) {
    this.enabled=enabled===true; this.directory=directory; this.maxBytes=maxBytes; this.error=null;
    this.secrets=[cookie,...cookie.split(';').filter(p=>p.trim().startsWith('token_v2=')).map(p=>p.slice(p.indexOf('=')+1).trim())].filter(Boolean).sort((a,b)=>b.length-a.length);
  }
  redact(value) {
    if(typeof value==='string') { for(const secret of this.secrets) value=value.split(secret).join('[REDACTED]'); return value; }
    if(Array.isArray(value)) return value.map(v=>this.redact(v));
    if(value && typeof value==='object') return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,PRIVATE_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g,''))?'[REDACTED]':this.redact(v)]));
    return value;
  }
  async record(label,{requestBody,headers,frames}) {
    if(!this.enabled || !this.directory) return;
    try {
      if(!/^[a-z0-9-]{1,40}$/i.test(label)) throw new Error('抓包标签无效。');
      const safeHeaders=Object.fromEntries(Object.entries(headers || {}).filter(([key])=>HEADER_KEYS.has(key.toLowerCase())));
      const request=JSON.stringify(this.redact({headers:safeHeaders,body:requestBody}),null,2);
      const response=frames.map(frame=>JSON.stringify(this.redact(frame))).join('\n')+'\n';
      if(Buffer.byteLength(request)+Buffer.byteLength(response)>this.maxBytes) throw new Error('抓包超过本地大小上限。');
      await mkdir(this.directory,{recursive:true});
      const base=join(this.directory,new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID()+'-'+label);
      await writeFile(base+'.request.json',request,{encoding:'utf8',mode:0o600,flag:'wx'});
      await writeFile(base+'.frames.ndjson',response,{encoding:'utf8',mode:0o600,flag:'wx'});
    } catch { this.error='无法保存抓包；请检查目录权限、路径或大小限制。'; }
  }
}
