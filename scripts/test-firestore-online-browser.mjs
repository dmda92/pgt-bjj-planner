import {createServer} from 'node:http';
import {connect} from 'node:net';
import {readFile} from 'node:fs/promises';
import {extname,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {structuredFixture} from '../tests/structured-firestore-fixture.ts';
const f=await structuredFixture(),devOrigin='https://pgt-github-probe-dev.david-dzm5.workers.dev';
const bundle=await build({entryPoints:['worker/dev.ts'],bundle:true,write:false,format:'esm',target:'es2022'});
const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-13',durableObjects:{SECURITY:{className:'ProbeSecurity',useSQLite:true}},bindings:{...f.env,ALLOWED_ORIGINS:devOrigin},outboundService:async r=>f.transport(r.url,{method:r.method,headers:r.headers,body:['GET','HEAD'].includes(r.method)?undefined:await r.text()})}));
const runtimeURL=await runtime.ready;
const connections=new Set();
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(value&&key!=='host')headers.set(key,Array.isArray(value)?value.join(','):value);
   headers.set('Origin',devOrigin);
   const r=await runtime.dispatchFetch(new URL(req.url,runtimeURL),{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
   res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));return;
  }
  let path=resolve('dist','.'+decodeURIComponent(url.pathname));if(!path.startsWith(resolve('dist')+'/')&&path!==resolve('dist'))throw Error('path');
  if(url.pathname==='/')path=resolve('dist/index.html');
  const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.png':'image/png','.jpg':'image/jpeg'};
  res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream'});res.end(await readFile(path));
 }catch{res.writeHead(500);res.end('Fixture error');}
});
server.on('connection',s=>{connections.add(s);s.on('close',()=>connections.delete(s));});
server.on('upgrade',(req,socket,head)=>{
 // Local transport fixture rewrites only Origin; production checks remain exact.
 const upstream=connect(Number(runtimeURL.port),runtimeURL.hostname,()=>{
  const lines=[`${req.method} ${req.url} HTTP/1.1`];for(const [key,value] of Object.entries(req.headers))if(!['origin','host'].includes(key))lines.push(key+': '+value);
  lines.push('Host: '+runtimeURL.host,'Origin: '+devOrigin,'','');upstream.write(lines.join('\r\n'));if(head.length)upstream.write(head);socket.pipe(upstream).pipe(socket);
 });upstream.on('error',()=>socket.destroy());socket.on('close',()=>upstream.destroy());
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
 const origin='http://127.0.0.1:'+server.address().port;
 const child=spawn(process.execPath,['scripts/test-firestore-dev-live.mjs'],{stdio:'inherit',env:{...process.env,PGT_LOCAL_QA_ORIGIN:origin,CLOUDFLARE_API_TOKEN:''}});
 const code=await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});if(code!==0)throw Error('Local online browser scenario failed: '+code);
}finally{for(const s of connections)s.destroy();await new Promise(r=>server.close(r));await runtime.dispose();}
