import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeValidation, readOnlyValidationTransport, createValidationWorker, validationConfig, validationReadApi, type ValidationEnv } from '../worker/validation.ts';
const env: ValidationEnv = { FIRESTORE_ENVIRONMENT: 'pro', FIRESTORE_PROJECT_ID: 'pgt-bjj-pro', FIRESTORE_DATABASE_ID: '(default)', FIRESTORE_SERVICE_ACCOUNT_EMAIL: 'pgt-validator-pro@pgt-bjj-pro.iam.gserviceaccount.com', VALIDATION_ORIGIN: 'https://validation.example.test', VALIDATION_ACCESS_ISSUER: 'https://pgt-test.cloudflareaccess.com', VALIDATION_ACCESS_AUD: 'a'.repeat(64), VALIDATION_ALLOWED_EMAILS: 'owner@example.test', VALIDATION_ACTOR_EMAIL: 'trainer@example.test', VALIDATION_NAMESPACE: 'pgt_v2/import-' + 'b'.repeat(24), VALIDATION_SOURCE_COMMIT: 'c'.repeat(40), VALIDATION_BUNDLE_CHECKSUM: 'b'.repeat(64) };
const bytes = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
async function credentials() {
 const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, true, ['sign','verify']);
 const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
 const now = Math.floor(Date.now()/1000), base = { iss: env.VALIDATION_ACCESS_ISSUER, aud: [env.VALIDATION_ACCESS_AUD], email: 'owner@example.test', sub: 'owner-id', iat: now, exp: now+600 };
 return { jwk, async token(changes: Record<string,unknown> = {}, headers: Record<string,unknown> = {}) { const body = bytes({ alg: 'RS256', kid: 'test-key', ...headers })+'.'+bytes({ ...base,...changes }); return body+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey,new TextEncoder().encode(body))).toString('base64url'); } };
}
test('validator rejects incomplete, DEV, runtime PRO credential and cross environment configurations',()=>{
 for(const changes of [{ FIRESTORE_PROJECT_ID:'pgt-bjj-dev' },{ FIRESTORE_ENVIRONMENT:'dev' },{ FIRESTORE_SERVICE_ACCOUNT_EMAIL:'pgt-worker-pro@pgt-bjj-pro.iam.gserviceaccount.com' },{ VALIDATION_ACCESS_AUD:undefined },{ VALIDATION_NAMESPACE:'pgt_v2/main' },{ VALIDATION_ALLOWED_EMAILS:'' },{ VALIDATION_SOURCE_COMMIT:'latest' }]) assert.throws(()=>validationConfig({...env,...changes}));
 assert.equal(validationConfig(env).target.project,'pgt-bjj-pro');
});
test('Access requires verified signature, audience, issuer, allowlist and valid time; spoofed headers fail',async()=>{
 const c=await credentials(), transport=async()=>Response.json({keys:[c.jwk]});
 await assert.rejects(authorizeValidation(new Request(env.VALIDATION_ORIGIN!,{headers:{'Cf-Access-Authenticated-User-Email':'owner@example.test'}}),env,transport));
 await authorizeValidation(new Request(env.VALIDATION_ORIGIN!,{headers:{'Cf-Access-Jwt-Assertion':await c.token()}}),env,transport);
 for(const changes of [{aud:['other']},{iss:'https://evil.example'},{email:'other@example.test'},{exp:0},{iat:9999999999},{nbf:9999999999},{sub:''}]) await assert.rejects(authorizeValidation(new Request(env.VALIDATION_ORIGIN!,{headers:{'Cf-Access-Jwt-Assertion':await c.token(changes)}}),env,transport));
 const token=await c.token(); await assert.rejects(authorizeValidation(new Request(env.VALIDATION_ORIGIN!,{headers:{'Cf-Access-Jwt-Assertion':token.slice(0,-8)+'AAAAAAAA'}}),env,transport));
 await assert.rejects(authorizeValidation(new Request(env.VALIDATION_ORIGIN!,{headers:{'Cf-Access-Jwt-Assertion':await c.token({}, {alg:'none'})}}),env,transport));
});
test('transport never forwards writes, transactions, arbitrary projects/namespaces or query bodies',async()=>{
 const seen:string[]=[], send=readOnlyValidationTransport(env,async(url)=>{seen.push(url);return Response.json({});});
 const base='https://firestore.googleapis.com/v1/projects/pgt-bjj-pro/databases/(default)/documents';
 await send(base+'/pgt_v2/control'); await send(base+'/'+env.VALIDATION_NAMESPACE+'/aggregates/roster__users');
 await send(base+':batchGet',{method:'POST',body:JSON.stringify({documents:['projects/pgt-bjj-pro/databases/(default)/documents/'+env.VALIDATION_NAMESPACE]})});
 for(const [url,init] of [[base+':commit',{method:'POST'}],[base+'/'+env.VALIDATION_NAMESPACE,{method:'DELETE'}],[base+'/'+env.VALIDATION_NAMESPACE,{method:'PATCH'}],[base+':beginTransaction',{method:'POST'}],[base+':runQuery',{method:'POST'}],[base+':batchGet',{method:'POST',body:JSON.stringify({documents:['projects/pgt-bjj-dev/databases/(default)/documents/pgt_v2/control']})}],[base+':batchGet',{method:'POST',body:JSON.stringify({documents:['projects/pgt-bjj-pro/databases/(default)/documents/pgt_v2/control'],transaction:'bad'})}],[base+'/pgt_v2/import-'+'d'.repeat(24),{}],[base+'/'+env.VALIDATION_NAMESPACE+'?mask.fieldPaths=pwd',{}],['https://evil.example',{}]] as [string,RequestInit][]) await assert.rejects(send(url,init));
 assert.equal(seen.length,3);
});
test('worker validates Access before data; denies ALL mutation/auth/WS routes before reader; same-origin only',async()=>{
 const c=await credentials();let reads=0;
 const worker=createValidationWorker(async()=>Response.json({keys:[c.jwk]}),async()=>{reads++;return {fetch:async()=>Response.json({safe:true})} as any;});
 const token=await c.token(), headers={'Cf-Access-Jwt-Assertion':token};
 assert.equal((await worker.fetch(new Request(env.VALIDATION_ORIGIN!),env)).status,403);
 for(const path of ['/api/v2/auth/login','/api/v2/auth/register','/api/v2/auth/logout','/api/v2/realtime','/api/v2/realtime-ticket','/api/v2/commands/text','/api/dev/runtime','/api/v2/commands/prepare']) for(const method of ['GET','POST','DELETE']) assert.ok((await worker.fetch(new Request(env.VALIDATION_ORIGIN+path,{method,headers}),env)).status>=400);
 assert.equal(reads,0);
 assert.equal((await worker.fetch(new Request('https://evil.example/api/v2/roster',{headers}),env)).status,403);
 assert.equal((await worker.fetch(new Request(env.VALIDATION_ORIGIN+'/api/v2/roster',{headers:{...headers,Origin:'https://evil.example'}}),env)).status,403);
 const html=await worker.fetch(new Request(env.VALIDATION_ORIGIN!,{headers}),env);assert.equal(html.status,200);assert.equal(html.headers.get('cache-control'),'no-store');assert.ok(html.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));
 const response=await worker.fetch(new Request(env.VALIDATION_ORIGIN+'/api/v2/roster',{headers}),env);assert.equal(response.status,200);assert.equal(reads,1);assert.deepEqual(await response.json(),{safe:true});
});

import { structuredFixture } from './structured-firestore-fixture.ts';
import { NativeFirestore } from '../worker/structured/firestore.ts';
import { NativeAggregates } from '../worker/v2/aggregates.ts';
import { nativeWrite } from '../worker/v2/plans.ts';
import { initialVersion, cloneTemplate } from '../src/domain/models.ts';
import { template } from './template-fixture.ts';
import { generatePlan } from '../src/domain/planner.ts';
import { PlanRepository } from '../worker/v2/plans.ts';
import { indexPlanText } from '../src/infrastructure/plan-text-projection.ts';
async function dataset() {
 const f=await structuredFixture(), credential=JSON.parse(f.env.FIRESTORE_SERVICE_ACCOUNT_JSON);
 Object.assign(credential,{project_id:'pgt-bjj-pro',client_email:env.FIRESTORE_SERVICE_ACCOUNT_EMAIL});
 const configured={...env,FIRESTORE_SERVICE_ACCOUNT_JSON:JSON.stringify(credential)};
 const calls:{url:string,method:string}[]=[], transport=async(url:string,init:RequestInit={})=>{
  calls.push({url,method:init.method||'GET'});
  const response=await f.transport(url.replaceAll('pgt-bjj-pro','pgt-bjj-dev'),{...init,...(typeof init.body==='string'?{body:init.body.replaceAll('projects/pgt-bjj-pro/','projects/pgt-bjj-dev/')}: {})});
  return new Response((await response.text()).replaceAll('projects/pgt-bjj-dev/','projects/pgt-bjj-pro/'),{status:response.status,headers:response.headers});
 };
 const db=new NativeFirestore(configured,transport), store=new NativeAggregates(db,env.VALIDATION_NAMESPACE!);
 const mail=env.VALIDATION_ACTOR_EMAIL!, profile={...initialVersion(),mail,nombre:'Synthetic',apellidos:'Trainer',perfil:'entrenador',peso:null,cinturon:'Blanco',fecha_nacimiento:null,pwd:'private-synthetic-hash'};
 const techniques=cloneTemplate(template), comments={...initialVersion(),comments:[]};
 const competition={planId:crypto.randomUUID(),alumnos:[mail],fecha_comienzo:'2026-01-01',fecha_torneo:'2026-01-03',dias_de_entrenamiento:[1,2,3,4,5,6,7],ejercicios_por_sesion:2,tiempo_por_tecnica_segundos:180,descanso_entre_ciclos_segundos:10,descanso_entre_tecnicas_segundos:20};
 const plan=generatePlan(competition,mail,techniques,comments,'2026-01-01T00:00:00Z');
 await new PlanRepository(db,env.VALIDATION_NAMESPACE!).write(plan,null,crypto.randomUUID());
 await store.publish([
 {ref:{kind:'profile',id:mail},data:profile,expected:null},
 {ref:{kind:'repertoire',id:mail},data:techniques,expected:null},
 {ref:{kind:'comments',id:mail},data:{...initialVersion(),comments:[]},expected:null},
 {ref:{kind:'assignment',id:mail},data:{...initialVersion(),planIds:[plan.planId]},expected:null},
 {ref:{kind:'catalog',id:'competitions'},data:{...initialVersion(),plans:[competition],deletedPlanIds:[]},expected:null},
 {ref:{kind:'roster',id:'users'},data:{users:[{mail,nombre:'Synthetic',perfil:'entrenador'}]},expected:null},
 {ref:{kind:'agenda',id:'calendar'},data:{months:[]},expected:null},
 {ref:{kind:'plan-text',id:plan.planId+'__'+mail},data:indexPlanText(plan),expected:null}
 ],crypto.randomUUID());
 await db.commit([nativeWrite(db,env.VALIDATION_NAMESPACE!,{phase:'verified',active:true,target:'pgt-bjj-pro',bundleChecksum:env.VALIDATION_BUNDLE_CHECKSUM,sourceCommit:env.VALIDATION_SOURCE_COMMIT},null),nativeWrite(db,'pgt_v2/control',{phase:'active',project:'pgt-bjj-pro',database:'(default)',bundleChecksum:env.VALIDATION_BUNDLE_CHECKSUM,namespace:env.VALIDATION_NAMESPACE,sourceCommit:env.VALIDATION_SOURCE_COMMIT},null)]);
 calls.length=0;return {f,configured,transport,calls,mail,plan};
}
test('real read coordinator observes pinned migrated dataset without writes, sessions, maintenance or password exposure',async()=>{
 const d=await dataset(), before=structuredClone([...d.f.docs]);
 const reader=await validationReadApi(d.configured,d.transport);
 for(const path of ['roster','catalog','training-day','users/'+encodeURIComponent(d.mail)+'/profile','users/'+encodeURIComponent(d.mail)+'/repertoire','users/'+encodeURIComponent(d.mail)+'/comments','users/'+encodeURIComponent(d.mail)+'/assignment','users/'+encodeURIComponent(d.mail)+'/snapshot']) {
  const result=await reader.fetch(new Request('https://validation.example.test/api/v2/'+path,{headers:{Authorization:'Bearer '+'V'.repeat(43)}}));assert.equal(result.status,200,path);assert.ok(!(await result.text()).includes('private-synthetic-hash'));
 }
 assert.deepEqual([...d.f.docs],before);assert.ok(d.calls.every(c=>c.method==='GET'||c.url==='https://oauth2.googleapis.com/token'));assert.ok(d.calls.every(c=>!c.url.includes('github.com')));
});
test('validator refuses a different source commit before serving business data',async()=>{
 const d=await dataset();await assert.rejects(validationReadApi({...d.configured,VALIDATION_SOURCE_COMMIT:'d'.repeat(40)},d.transport),/VALIDATION_DATASET_NOT_PINNED/);
});

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
test('Chromium inspector safely navigates users, techniques, comments, competitions, assignments and historical plans',{skip:process.env.PGT_VALIDATION_BROWSER !== '1'},async()=>{
 const d=await dataset(), c=await credentials(), token=await c.token(), before=structuredClone([...d.f.docs]);
 const worker=createValidationWorker(async(url,init)=>url.endsWith('/cdn-cgi/access/certs')?Response.json({keys:[c.jwk]}):d.transport(url,init));
 const browser=await chromium.launch({headless:true});const context=await browser.newContext({serviceWorkers:'block'});const page=await context.newPage();
 const requests:{method:string,url:string}[]=[];
 try{
  await page.route('**/*',async route=>{
   const q=route.request();requests.push({method:q.method(),url:q.url()});
   const response=await worker.fetch(new Request(q.url(),{method:q.method(),headers:{...q.headers(),'Cf-Access-Jwt-Assertion':token}}),d.configured);
   const responseHeaders:Record<string,string>={};response.headers.forEach((v,k)=>responseHeaders[k]=v);
   await route.fulfill({status:response.status,headers:responseHeaders,body:await response.text()});
  });
  await page.goto(env.VALIDATION_ORIGIN!);assert.equal(await page.locator('h1').textContent(),'Validaci\u00f3n de datos migrados');
  for(const [button,key] of [['Usuarios','trainer@example.test'],['Competiciones',d.plan.planId]]){await page.getByRole('button',{name:button,exact:true}).click();await page.waitForFunction(v=>document.querySelector('#result')?.textContent?.includes(v),key);}
  await page.getByRole('textbox',{name:'Correo del alumno o entrenador'}).fill(d.mail);
  for(const [button,key] of [['Perfil','Synthetic'],['T\u00e9cnicas','positions'],['Comentarios','comments'],['Asignaciones',d.plan.planId],['Planes e hist\u00f3rico','2026-01-01']]){await page.getByRole('button',{name:button,exact:true}).click();await page.waitForFunction(v=>document.querySelector('#result')?.textContent?.includes(v),key);}
  const restored=JSON.parse(await page.locator('#result').innerText());assert.deepEqual(restored.plans[0].data,d.plan);assert.ok(!(await page.content()).includes('private-synthetic-hash'));
  await mkdir('.qa/pro-validation-local',{recursive:true});await page.screenshot({path:'.qa/pro-validation-local/inspector-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'.qa/pro-validation-local/inspector-mobile.png',fullPage:true});
  assert.ok(requests.every(q=>q.method==='GET'));assert.deepEqual([...d.f.docs],before);assert.ok(d.calls.every(q=>q.method==='GET'||q.url==='https://oauth2.googleapis.com/token'));
 }finally{await context.close();await browser.close();}
});
