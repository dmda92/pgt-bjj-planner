import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { v2DevFixture } from '../tests/v2-dev-fixture.mjs';
const {f,password,mail}=await v2DevFixture(),origin='https://synthetic-pro.test';
const dev='pgt-bjj-dev',pro='pgt-bjj-pro';
const replace=value=>value.replaceAll(dev,pro);
const credential=JSON.parse(f.env.FIRESTORE_SERVICE_ACCOUNT_JSON);
credential.project_id=pro;credential.client_email='pgt-worker-pro@pgt-bjj-pro.iam.gserviceaccount.com';
// Adapt only synthetic control metadata to the explicit PRO contract.
for (const row of f.docs.values()) if (row.name.endsWith('/pgt_v2/control')) row.fields.database={stringValue:'(default)'};
for (const row of f.docs.values()) if (row.name.endsWith('/pgt_v2/control') || row.name.endsWith('/import-'+'c'.repeat(24))) {row.fields.bundleChecksum={stringValue:'c'.repeat(64)};row.fields.target={stringValue:pro};}
const env={...f.env,FIRESTORE_ENVIRONMENT:'pro',FIRESTORE_PROJECT_ID:pro,FIRESTORE_SERVICE_ACCOUNT_EMAIL:credential.client_email,FIRESTORE_SERVICE_ACCOUNT_JSON:JSON.stringify(credential),ALLOWED_ORIGINS:origin,WORKER_BUILD_SHA:'a'.repeat(40)};
const compiled=await build({entryPoints:['worker/pro.ts'],bundle:true,write:false,format:'esm',target:'es2022',external:['cloudflare:workers']});
assert.ok(!compiled.outputFiles[0].text.includes('api.github.com'),'New production runtime has no GitHub transport');
let calls=0;
const runtimeOptions={modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-10-13',durableObjects:{SECURITY:{className:'FirestoreSecurity',useSQLite:true},DOMAIN_IO:{className:'DomainIO',useSQLite:true},LEGACY_SECURITY:{className:'ProbeSecurity',useSQLite:true}},bindings:env,outboundService:async request=>{
 calls++; assert.ok(!request.url.includes('github.com'));
 if(request.url.startsWith('https://firestore.googleapis.com/'))assert.ok(request.url.includes('/projects/'+pro+'/'));
 const init={method:request.method,headers:request.headers,...(!['GET','HEAD'].includes(request.method)?{body:(await request.text()).replaceAll(pro,dev)}:{})};
 const response=await f.transport(request.url.replaceAll(pro,dev),init);
 const text=await response.text();return new Response(replace(text),{status:response.status,headers:response.headers});
}};
const runtime=new Miniflare(convertV4MiniflareOptions(runtimeOptions));
async function api(path,body,token=''){
 const response=await runtime.dispatchFetch('https://local/api/'+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer '+token,...{'CF-Connecting-IP':'synthetic'}},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;
}
try{
 const metadata=await api('runtime');assert.equal(metadata.project,pro);assert.equal(metadata.environment,'pro');assert.equal(metadata.build,'a'.repeat(40));
 const login=await api('v2/auth/login',{mail,password});assert.equal(login.profile.mail,mail);assert.ok(login.token);
 const catalog=await api('v2/catalog',undefined,login.token);assert.ok(catalog);
 const ns=await runtime.getDurableObjectNamespace('LEGACY_SECURITY');
 const legacy=ns.get(ns.idFromName('probe'));const before=calls;
 assert.equal((await legacy.fetch('https://local/api/auth/login',{method:'POST',body:'{}'})).status,410);
 assert.equal(calls,before,'Legacy durable object makes no external requests');
 console.log(JSON.stringify({scope:'Synthetic isolated Miniflare; no Google/Cloudflare remote',project:pro,migratedPasswordLogin:true,namespaceRead:true,legacyInert:true,externalCalls:calls}));
}finally{await runtime.dispose();}

for (const bad of [{...f.env,ALLOWED_ORIGINS:origin},{...env,FIRESTORE_PROJECT_ID:dev},{...env,FIRESTORE_SERVICE_ACCOUNT_EMAIL:undefined},{...env,FIRESTORE_SERVICE_ACCOUNT_JSON:f.env.FIRESTORE_SERVICE_ACCOUNT_JSON}]) {
 const isolated=new Miniflare(convertV4MiniflareOptions({...runtimeOptions,bindings:Object.fromEntries(Object.entries(bad).filter(([,v])=>v!==undefined))})),before=calls;
 try{const r=await isolated.dispatchFetch('https://local/api/v2/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({mail,password})});assert.equal(r.status,503);assert.equal(calls,before);}finally{await isolated.dispose();}
}
const control=[...f.docs.values()].find(row=>row.name.endsWith('/pgt_v2/control'));
const manifest=[...f.docs.values()].find(row=>row.name.endsWith('/import-'+'c'.repeat(24)));
for (const [row,key,value] of [[control,'database','other'],[control,'project','foreign'],[control,'bundleChecksum','e'.repeat(64)],[manifest,'bundleChecksum','e'.repeat(64)],[manifest,'target','foreign'],[manifest,'sourceCommit','e'.repeat(40)]]) {
 const original=structuredClone(row.fields);row.fields[key]={stringValue:value};
 const isolated=new Miniflare(convertV4MiniflareOptions(runtimeOptions));
 try{const r=await isolated.dispatchFetch('https://local/api/v2/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({mail,password})});assert.equal(r.status,503);const result=await r.json();assert.ok(['V2_MIGRATION_NOT_ACTIVATED','V2_IMPORT_NOT_VERIFIED'].includes(result.error),JSON.stringify(result));}finally{row.fields=original;await isolated.dispose();}
}
console.log('PRO incomplete/cross credentials and activation checksum/source/target reject locally.');
