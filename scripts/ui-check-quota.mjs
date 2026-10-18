import {createServer} from 'node:http';
import {readFile,writeFile,access,mkdtemp,rm} from 'node:fs/promises';
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
const script=String.raw`(async()=>{
  const {NotionComposerQuota,QUOTA_CSS}=window.plugin;
  const params=new URLSearchParams(location.search),dark=params.get('theme')==='dark',variant=params.get('variant');
  document.documentElement.style.colorScheme=dark?'dark':'light';
  document.body.style.cssText='margin:0;min-height:100vh;padding:32px 20px;font-family:Inter,Segoe UI,Microsoft YaHei,sans-serif;background:'+(dark?'#14161a':'#f8fafc')+';color:'+(dark?'#e5e9f0':'#202632');
  const style=document.createElement('style');style.textContent=QUOTA_CSS+'\n.demo{max-width:760px;margin:0 auto}.box{border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:14px;padding:14px 16px;background:color-mix(in srgb,currentColor 2%,transparent)}.fake{height:22px;color:color-mix(in srgb,currentColor 45%,transparent);font-size:13px}';
  document.head.appendChild(style);
  const errors=[];window.addEventListener('error',event=>errors.push(event.message));
  const quota={state:'ready',observedAt:Date.now(),enforcement:params.get('preview')==='1'?'preview':undefined,windows:{sixHour:{used:12.21,limit:100,remainingPercent:87.79,resetAt:Date.now()+18917000},monthly:{used:43.31,limit:100,remainingPercent:56.69,resetAt:Date.now()+20*86400000}}};
  const snapshot={current:{provider:'notion-subscription',model:'gpt-6.1-sol'}};
  const directory={subscribe:()=>()=>{},getSnapshot:()=>snapshot};
  const request=async()=>({ok:true,json:async()=>({ok:true,value:quota})});
  const host=document.getElementById('root');
  const box=document.createElement('div');box.className='demo';
  const shell=document.createElement('div');shell.className='box';
  shell.innerHTML='<div class="fake">输入框（示意）</div>';
  const dock=document.createElement('div');shell.appendChild(dock);box.appendChild(shell);host.appendChild(box);
  ReactDOM.createRoot(dock).render(React.createElement(NotionComposerQuota,{directory,request}));
  const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  await paint();await paint();
  const report={theme:dark?'dark':'light',variant,errors};
  const trigger=document.querySelector('.ns-quota-trigger');
  report.label=document.querySelector('.ns-quota-label')?.textContent;
  report.value=document.querySelector('.ns-quota-value')?.textContent;
  report.detail=document.querySelector('.ns-quota-detail')?.textContent;
  report.width=trigger?.getBoundingClientRect().width;
  report.overflow=document.documentElement.scrollWidth>innerWidth;
  report.previewVisible=document.body.textContent.includes('预览期');
  if(params.get('interact')==='1'){
    trigger.click();await paint();
    report.afterClick=document.querySelector('.ns-quota-label')?.textContent;
    report.afterValue=document.querySelector('.ns-quota-value')?.textContent;
    report.aria=trigger.getAttribute('aria-label');
    report.noOverflowAfter=document.documentElement.scrollWidth<=innerWidth;
  }
  await fetch('/report',{method:'POST',body:JSON.stringify(report)});
})();`;
const html=['<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Notion quota verification</title></head><body>',
'<div id="root"></div>','<script src="/react.js"></script><script src="/react-dom.js"></script>',
'<script>window.__ModuleLoader__={load:entry=>{window.plugin=entry.factory(name=>{if(name==="react")return window.React;throw Error(name);});}};</script>',
'<script src="/client.js"></script><script>'+script+'</script></body></html>'].join('\n');
const waiting=new Map();
const server=createServer(async(req,res)=>{try{
  if(req.url==='/report'&&req.method==='POST'){let text='';for await(const part of req){text+=part;if(text.length>100000)throw Error('Report limit');}const report=JSON.parse(text);waiting.get(report.variant)?.(report);res.end('ok');return;}
  const path=new URL(req.url,'http://localhost').pathname;
  res.setHeader('Content-Type',assets[path]?'text/javascript; charset=utf-8':'text/html; charset=utf-8');res.end(assets[path]||html);
}catch{res.statusCode=500;res.end('Verification server error');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const profile=await mkdtemp(join(tmpdir(),'notion-quota-ui-'));
let browser,socket;const pending=new Map();let sequence=0;const reports=[];
const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
try{
  const address=await new Promise((resolve,reject)=>{
    browser=spawn(browserPath,['--headless=new','--disable-gpu','--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe'],windowsHide:true});
    const timer=setTimeout(()=>reject(Error('Browser startup timed out')),20000);let log='';
    browser.stderr.on('data',chunk=>{log=(log+chunk.toString()).slice(-4000);const match=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
    browser.on('error',error=>{clearTimeout(timer);reject(error);});browser.on('exit',code=>{clearTimeout(timer);reject(Error('Browser exited early: '+code));});
  });
  socket=new WebSocket(address);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  const runtimeErrors=[],externalRequests=[];
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const operation=pending.get(message.id);pending.delete(message.id);if(message.error)operation?.reject(Error(message.error.message));else operation?.resolve(message.result);}else if(message.method==='Runtime.exceptionThrown')runtimeErrors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);else if(message.method==='Network.requestWillBeSent'){const url=message.params.request.url;if(!url.startsWith(origin)&&!url.startsWith('data:'))externalRequests.push(url);}});
  for(const item of [{variant:'quota-light',theme:'light',width:900,height:260,interact:true},{variant:'quota-dark',theme:'dark',width:900,height:260},{variant:'quota-mobile',theme:'dark',width:390,height:240},{variant:'quota-preview',theme:'light',width:900,height:260,preview:true}]){
    const {targetId}=await send('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
    await send('Runtime.enable',{},sessionId);await send('Page.enable',{},sessionId);await send('Network.enable',{},sessionId);
    await send('Emulation.setDeviceMetricsOverride',{width:item.width,height:item.height,deviceScaleFactor:2,mobile:item.width<500},sessionId);
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:item.theme}]},sessionId);
    let timer;const ready=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('Quota report timed out: '+item.variant)),20000);waiting.set(item.variant,resolve);});
    await send('Page.navigate',{url:origin+'/?variant='+item.variant+'&theme='+item.theme+(item.interact?'&interact=1':'')+(item.preview?'&preview=1':'')},sessionId);
    let report;try{report=await ready;}finally{clearTimeout(timer);waiting.delete(item.variant);}
    const shot=await send('Page.captureScreenshot',{format:'png'},sessionId);
    const path='verification/ui-0.4.0-'+item.variant+'.png';await writeFile(join(root,path),Buffer.from(shot.data,'base64'));
    report.screenshot=path;
    if(report.errors.length||report.overflow||!report.label||!report.value)throw Error('Quota rendering failed: '+JSON.stringify(report));
    if(item.interact&&(report.afterClick!=='本月'||!report.noOverflowAfter||!/本月额度剩余/.test(report.aria||'')))throw Error('Quota toggle failed: '+JSON.stringify(report));
    if(item.preview&&!report.previewVisible)throw Error('Enforcement preview badge missing');
    reports.push(report);await send('Target.closeTarget',{targetId});console.log(JSON.stringify({variant:item.variant,label:report.label,value:report.value,detail:report.detail,afterClick:report.afterClick,overflow:report.overflow,screenshot:path}));
  }
  if(runtimeErrors.length||externalRequests.length)throw Error('Unexpected browser errors: '+JSON.stringify({runtimeErrors,externalRequests}));
  await writeFile(join(root,'verification/ui-0.4.0.json'),JSON.stringify({clientSha256:createHash('sha256').update(client).digest('hex'),runtimeErrors,externalRequests,reports},null,2));
}finally{
  try{if(socket?.readyState===1)await send('Browser.close');}catch{}
  socket?.close();browser?.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
