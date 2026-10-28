import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {v2DevFixture} from '../tests/v2-dev-fixture.mjs';
import {readFile} from 'node:fs/promises';

const redPrototype=process.argv.includes('--red-per-socket');
const plugins=redPrototype?[{name:'isolated-previous-per-socket-auth',setup(build){build.onLoad({filter:/worker[\\/]v2[\\/]runtime\.ts$/},async args=>{
 const source=await readFile(args.path,'utf8');
 const before=source.replace(/const changed = profiles.get\(a.mail\);[\s\S]*?if \(a.connection/,`try { await this.queries.actor(a); } catch { ws.close(4401,'SESSION_REVOKED'); continue; }\n            if (a.connection`);
 assert.notEqual(before,source,'Red comparison must replace the actual broadcast authorization loop');
 return{contents:before,loader:'ts'};
});}}]:[];
if(redPrototype)console.log('RED comparison: prior per-socket authorization prototype substituted only in the isolated bundle; repository source unchanged.');

// Cache eviction and crash coordination are test-only private subclass hooks.
const compiled=await build({stdin:{contents:`
import {ProbeSecurity as Base, default as entry, DomainIO} from './worker/dev.ts';
export default entry; export {DomainIO};
export class ProbeSecurity extends Base {
 async fetch(request) {
  const path=new URL(request.url).pathname;
  if(path==='/api/__qa/evict-profiles') {for(const mail of await request.json())this.queries.cache.invalidate('profile:'+mail);return Response.json({evicted:true});}
  if(path==='/api/__qa/pending-restart') {await this.ctx.storage.put('v2-pending:'+crypto.randomUUID(),{attempts:0});this.api=undefined;this.queries=undefined;return Response.json({restarted:true});}
  return super.fetch(request);
 }
}`,resolveDir:process.cwd(),loader:'js'},bundle:true,write:false,format:'esm',target:'es2022',external:['cloudflare:workers'],plugins});
const {f,password,mail}=await v2DevFixture(),origin='https://synthetic.test';
const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-10-13',
 durableObjects:{SECURITY:{className:'ProbeSecurity',useSQLite:true},DOMAIN_IO:{className:'DomainIO',useSQLite:true}},bindings:{...f.env,ALLOWED_ORIGINS:origin},
 outboundService:async request=>f.transport(request.url,{method:request.method,headers:request.headers,...(!['GET','HEAD'].includes(request.method)?{body:await request.text()}:{})})}));
const sockets=[];
async function api(path,body,token='') {
 const r=await runtime.dispatchFetch('https://local/api/v2/'+path,{method:body===undefined?'GET':'POST',headers:{Connection:'close',Origin:origin,'CF-Connecting-IP':crypto.randomUUID(),Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const value=await r.json();assert.ok(r.ok,JSON.stringify(value));return value;
}
try {
 const trainer=await api('auth/login',{mail,password}),pupils=[];
 for(let i=0;i<3;i++) {
  const p=await api('auth/register',{mail:'session-budget-'+i+'@example.test',password,confirm:password,nombre:'Synthetic',apellidos:String(i)});pupils.push(p);
  const ticket=await api('realtime-ticket',{},p.token);
  const r=await runtime.dispatchFetch('https://local/api/v2/realtime?ticket='+ticket.ticket,{headers:{Origin:origin,Upgrade:'websocket'}});
  assert.equal(r.status,101);const ws=r.webSocket;ws.accept();sockets.push(ws);
 }
 assert.equal((await runtime.dispatchFetch('https://local/api/__qa/evict-profiles',{method:'POST',body:JSON.stringify(pupils.map(p=>p.profile.mail))})).status,200);
 const start=f.calls.length;
 await api('commands/profile',{data:{...trainer.profile,nombre:'Unrelated change'},expected:'1',operationId:crypto.randomUUID()},trainer.token);
 const coldProfileReads=f.calls.slice(start).filter(c=>c.method==='GET'&&pupils.some(p=>decodeURIComponent(c.url).includes('/aggregates/profile__'+p.profile.mail)));
 assert.equal(coldProfileReads.length,0,'Unrelated publication must not reload evicted profiles for every connected user');
 // A pending outbox after restart may hide a committed role/password mutation.
 // Close sockets before serving new publications, without reading N profiles.
 const closed=sockets.map(ws=>new Promise(resolve=>ws.addEventListener('close',resolve,{once:true})));
 const head=f.calls.length;
 assert.equal((await runtime.dispatchFetch('https://local/api/__qa/pending-restart',{method:'POST'})).status,200);
 await api('catalog',undefined,trainer.token);
 const restartProfileReads=f.calls.slice(head).filter(c=>c.method==='GET'&&pupils.some(p=>decodeURIComponent(c.url).includes('/aggregates/profile__'+p.profile.mail)));
 assert.equal(restartProfileReads.length,0);
 for(const ws of sockets)try{ws.close();}catch{}
 for(const event of await Promise.all(closed))assert.equal(event.code,1012);
 console.log(JSON.stringify({scope:'isolated Miniflare, intercepted Google/GitHub',sockets:sockets.length,coldUnrelatedProfileReads:coldProfileReads.length,restartUnrelatedProfileReads:restartProfileReads.length,pendingRestartCloseCode:1012}));
} finally {for(const ws of sockets)try{ws.close();}catch{}await runtime.dispose();}
