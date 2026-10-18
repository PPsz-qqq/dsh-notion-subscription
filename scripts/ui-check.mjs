import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,mkdtemp,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(import.meta.url);
const candidates=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
let browserPath;for(const path of candidates){try{await access(path);browserPath=path;break;}catch{}}
if(!browserPath)throw new Error('Set CHROME_PATH to an installed Chrome/Chromium browser.');
const client=await readFile(join(root,'lib/client.js'));
const assets={'/react.js':await readFile(join(dirname(require.resolve('react/package.json')),'umd/react.development.js')),'/react-dom.js':await readFile(join(dirname(require.resolve('react-dom/package.json')),'umd/react-dom.development.js')),'/client.js':client};
const bootstrap=String.raw`(async()=>{
  const {NotionSettings,DEFAULT_MODELS,STYLES}=window.plugin;
  const params=new URLSearchParams(location.search),name=params.get('case'),dark=params.get('theme')==='dark';
  document.documentElement.style.colorScheme=dark?'dark':'light';
  document.body.style.cssText='margin:0;font-family:Inter,Segoe UI,Microsoft YaHei,sans-serif;background:'+(dark?'#14161a':'#f8fafc')+';color:'+(dark?'#e5e9f0':'#202632');
  const style=document.createElement('style');style.textContent=STYLES;document.head.appendChild(style);
  const errors=[];window.addEventListener('error',event=>errors.push(event.message));
  let snapshot={status:'ready',writable:true,revision:1,value:{enabled:true,autoModels:true,autoDiscover:true,cookie:'SYNTHETIC_SECRET_NOT_RENDERED',models:DEFAULT_MODELS}};
  const listeners=new Set(),writes=[];
  const form={entryId:'dsh-notion-subscription',subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},getSnapshot:()=>snapshot,mutate:async(ops,revision)=>{if(revision!==snapshot.revision)return false;writes.push(ops);const value={...snapshot.value};for(const op of ops)value[op.path[0]]=op.value;snapshot={...snapshot,value,revision:snapshot.revision+1};for(const fn of listeners)fn();return true;}};
  const metadata={view:{namespaces:[{ns:form.entryId,secrets:[{path:['cookie'],set:true}]}]}};
  const mirror={subscribe:()=>()=>{},getSnapshot:()=>metadata};
  const labels={none:'关闭',minimal:'最低',low:'低',medium:'中',high:'高',xhigh:'极高',max:'最高'};
  const catalog={status:'ready',value:{groups:[{id:'notion-subscription',models:DEFAULT_MODELS.map(m=>({...m,description:'账号目录（合成预览）',reasoning:{efforts:(m.supportedReasoningEfforts||[]).map(id=>({id,name:labels[id]||id}))}}))}],failures:[]}};
  const catalogStore={subscribe:()=>()=>{},getSnapshot:()=>catalog};
  let refreshes=0;
  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(NotionSettings,{form,mirror,catalogStore,reloadModels:async()=>{refreshes++;}}));
  const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const report={name,theme:dark?'dark':'light',errors};
  try{
    await paint();report.initialCards=document.querySelectorAll('.ns-model-card').length;
    report.blankPassword=document.querySelector('input[type=password]').value==='';
    report.secretHidden=!document.getElementById('root').textContent.includes('SYNTHETIC_SECRET_NOT_RENDERED');
    report.initialDefault=document.querySelector('#notion-defaultReasoningEffort').value;
    report.overflow=document.documentElement.scrollWidth>innerWidth;
    if(params.has('interact')){
      const search=document.querySelector('[aria-label="搜索模型"]');
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      setter.call(search,'GPT-6.1 Sol');search.dispatchEvent(new Event('input',{bubbles:true}));await paint();
      report.searchWorks=document.querySelectorAll('.ns-model-card').length===1&&document.querySelector('.ns-model-card').textContent.includes('GPT-6.1 Sol');
      setter.call(search,'');search.dispatchEvent(new Event('input',{bubbles:true}));await paint();
      const select=document.querySelector('#notion-defaultReasoningEffort');select.value='high';select.dispatchEvent(new Event('change',{bubbles:true}));await paint();
      document.querySelector('.ns-primary').click();await paint();
      report.effortSaved=writes[0]?.some(op=>op.path[0]==='defaultReasoningEffort'&&op.value==='high')===true;
      report.credentialPreserved=writes.every(ops=>!ops.some(op=>op.path[0]==='cookie'));
      select.value='';select.dispatchEvent(new Event('change',{bubbles:true}));await paint();document.querySelector('.ns-primary').click();await paint();
      report.refreshes=refreshes;report.restoredModelDefault=select.value==='';
    }
    const details=[...document.querySelectorAll('details')];details.forEach(node=>node.open=true);await paint();report.expandedOverflow=document.documentElement.scrollWidth>innerWidth;details.forEach(node=>node.open=false);await paint();
    document.activeElement?.blur();report.viewportWidth=innerWidth;report.viewportHeight=innerHeight;report.finalCards=document.querySelectorAll('.ns-model-card').length;report.cssRules=[...document.styleSheets].reduce((sum,sheet)=>sum+sheet.cssRules.length,0);
  }catch(error){errors.push(error.message);}
  await fetch('/report',{method:'POST',body:JSON.stringify(report)});
})();`;
const html=['<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Notion UI verification</title></head><body>',
'<div style="padding:8px 24px;font:11px sans-serif;opacity:.6">界面验收预览 · 合成配置 · 不调用 AI</div><main id="root"></main>',
'<script src="/react.js"></script><script src="/react-dom.js"></script>',
'<script>window.__ModuleLoader__={load:entry=>{window.plugin=entry.factory(name=>{if(name==="react")return window.React;throw Error(name);});}};</script>',
'<script src="/client.js"></script><script>'+bootstrap+'</script></body></html>'].join('\n');
const waiting=new Map();
const server=createServer(async(req,res)=>{try{
  if(req.url==='/report'&&req.method==='POST'){let text='';for await(const part of req){text+=part;if(text.length>100000)throw Error('Report limit');}const report=JSON.parse(text);waiting.get(report.name)?.(report);res.end('ok');return;}
  const path=new URL(req.url,'http://localhost').pathname;
  res.setHeader('Content-Type',assets[path]?'text/javascript; charset=utf-8':'text/html; charset=utf-8');res.end(assets[path]||html);
}catch{res.statusCode=500;res.end('Verification server error');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const profile=await mkdtemp(join(tmpdir(),'notion-ui-verification-'));
let browser,socket;const reports=[];const pending=new Map();let sequence=0;
const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
try{
  const address=await new Promise((resolve,reject)=>{
    browser=spawn(browserPath,['--headless=new','--disable-gpu','--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe'],windowsHide:true});
    const timer=setTimeout(()=>reject(Error('Browser startup timed out')),20000);let log='';
    browser.stderr.on('data',chunk=>{log=(log+chunk.toString()).slice(-4000);const match=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
    browser.on('error',error=>{clearTimeout(timer);reject(error);});browser.on('exit',code=>{clearTimeout(timer);reject(Error('Browser exited before verification: '+code));});
  });
  socket=new WebSocket(address);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  const runtimeErrors=[],externalRequests=[];
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const operation=pending.get(message.id);pending.delete(message.id);if(message.error)operation?.reject(Error(message.error.message));else operation?.resolve(message.result);}else if(message.method==='Runtime.exceptionThrown')runtimeErrors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);else if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')runtimeErrors.push(message.params.args.map(a=>a.value||a.description).join(' '));else if(message.method==='Network.requestWillBeSent'){const url=message.params.request.url;if(!url.startsWith(origin)&&!url.startsWith('data:'))externalRequests.push(url);}});
  const version=await send('Browser.getVersion');
  await mkdir(join(root,'verification'),{recursive:true});
  for(const item of [{name:'light',theme:'light',width:1280,height:1320,interact:true},{name:'dark',theme:'dark',width:1280,height:1320},{name:'mobile',theme:'dark',width:390,height:1600}]){
    const {targetId}=await send('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
    await send('Runtime.enable',{},sessionId);await send('Page.enable',{},sessionId);await send('Network.enable',{},sessionId);
    await send('Emulation.setDeviceMetricsOverride',{width:item.width,height:item.height,deviceScaleFactor:1,mobile:item.name==='mobile'},sessionId);
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:item.theme}]},sessionId);
    let timer;const ready=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('UI report timed out: '+item.name)),20000);waiting.set(item.name,resolve);});
    await send('Page.navigate',{url:origin+'/?case='+item.name+'&theme='+item.theme+(item.interact?'&interact=1':'')},sessionId);
    let report;try{report=await ready;}finally{clearTimeout(timer);waiting.delete(item.name);}
    const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sessionId);
    const path='verification/ui-0.4.0-settings-'+item.name+'.png';await writeFile(join(root,path),Buffer.from(screenshot.data,'base64'));
    report.screenshot=path;report.browser=version.product;
    if(report.errors.length||report.overflow||report.expandedOverflow||!report.blankPassword||!report.secretHidden||report.initialDefault!==''||report.viewportWidth!==item.width||report.initialCards!==6||report.cssRules<50)throw Error('Rendering acceptance failed: '+JSON.stringify(report));
    if(item.interact&&(!report.searchWorks||!report.effortSaved||!report.credentialPreserved||!report.restoredModelDefault||report.refreshes!==2))throw Error('Interaction acceptance failed: '+JSON.stringify(report));
    reports.push(report);await send('Target.closeTarget',{targetId});console.log(JSON.stringify({case:item.name,width:report.viewportWidth,overflow:report.overflow,expandedOverflow:report.expandedOverflow,rendering:'passed',interactions:item.interact?'passed':'covered separately',screenshot:path}));
  }
  if(runtimeErrors.length||externalRequests.length)throw Error('Unexpected browser errors or external requests: '+JSON.stringify({runtimeErrors,externalRequests}));
  await writeFile(join(root,'verification/ui-0.4.0-settings.json'),JSON.stringify({clientSha256:createHash('sha256').update(client).digest('hex'),runtimeErrors,externalRequests,reports},null,2));
}finally{
  try{if(socket?.readyState===1)await send('Browser.close');}catch{}
  socket?.close();browser?.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
