import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
const exact=(actual,expected,label='Native persisted data differs from the domain oracle')=>{if(!isDeepStrictEqual(actual,expected))throw Error(label);};
import {randomBytes,createHash} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {generatePlan} from '../src/domain/planner.ts';
import {madridDate,updateFuturePlanText} from '../src/domain/plan-text-updates.ts';
import {updateFutureDeletions} from '../src/domain/plan-continuity.ts';
const realOrigin='https://pgt-github-probe-dev.david-dzm5.workers.dev';
const local=process.env.PGT_LOCAL_QA_ORIGIN;
if(local&&!/^http:\/\/127\.0\.0\.1:\d+$/.test(local))throw Error('LOCAL_QA_TARGET_INVALID');
const origin=local||realOrigin;
if(!local&&(process.env.GITHUB_REF!=='refs/heads/develop'||!process.env.CLOUDFLARE_API_TOKEN))throw Error('LIVE_QA_REQUIRES_AUTHORIZED_DEV_PIPELINE');
const runId=crypto.randomUUID(),password=randomBytes(32).toString('base64url');
console.log('::add-mask::'+password);
if(local){const b=await fetch(origin+'/api/dev/structured-bootstrap',{method:'POST',headers:{Origin:realOrigin,Authorization:'Bearer synthetic-deployment-token','Content-Type':'application/json'},body:'{}'});assert.equal(b.status,200,await b.text());}
let fixture;
for(let n=0;n<4;n++){const response=await fetch(origin+'/api/dev/synthetic-fixture',{method:'POST',headers:{Origin:realOrigin,Authorization:'Bearer '+(local?'synthetic-deployment-token':process.env.CLOUDFLARE_API_TOKEN),'Content-Type':'application/json'},body:JSON.stringify({runId,password})});fixture=await response.json();assert.equal(response.status,200,JSON.stringify(fixture));if(fixture.status==='SYNTHETIC_FIXTURE_CREATED')break;}assert.equal(fixture.status,'SYNTHETIC_FIXTURE_CREATED');
const [trainer,student,other]=fixture.users.map(u=>u.mail);
const browser=await chromium.launch({headless:true});
let finalReport,failureReport;
const contexts=[],errors=[],samples=[],checks=[],network={requests:0,mutations:0,snapshots:0,websocketMessages:0,failedResponses:[]};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function poll(fn,message,timeout=20000){const until=Date.now()+timeout;let last;while(Date.now()<until){try{last=await fn();if(last)return last;}catch(e){last=e.message;}await wait(100);}throw Error(message+': '+String(last));}
async function login(mail,mobile=false,register=false){
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},serviceWorkers:'block'});contexts.push(context);const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{const path=new URL(r.url()).pathname;if(path.startsWith('/api/app/')){network.requests++;if(!['GET','HEAD'].includes(r.method()))network.mutations++;if(path.endsWith('/snapshot'))network.snapshots++;}});page.on('response',async r=>{if(r.status()>=400&&new URL(r.url()).pathname.startsWith('/api/app/')){let code='HTTP_ERROR';try{const v=await r.json();if(typeof v.error==='string'&&/^[A-Z0-9_]+$/.test(v.error))code=v.error.slice(0,100);}catch{}network.failedResponses.push({status:r.status(),path:new URL(r.url()).pathname.replace(/\/users\/[^/]+/,'/users/:user'),code});}});page.on('websocket',ws=>ws.on('framereceived',()=>network.websocketMessages++));
 await page.goto(origin,{waitUntil:'networkidle'});if(register){await page.getByRole('button',{name:'Registrarme',exact:true}).click();await page.getByLabel('Nombre',{exact:true}).fill('Alta pública');await page.getByLabel('Apellidos',{exact:true}).fill('QA');await page.getByLabel('Repetir contraseña',{exact:true}).fill(password);}await page.getByLabel('Correo',{exact:true}).fill(mail);await page.getByLabel('Contraseña',{exact:true}).fill(password);await page.getByRole('button',{name:register?'Crear cuenta de alumno':'Entrar',exact:true}).click();await page.getByRole('button',{name:'Salir',exact:true}).waitFor({timeout:30000});
 const token=await page.evaluate(()=>JSON.parse(localStorage.getItem('pgt-session')).token);console.log('::add-mask::'+token);return {context,page,token,mail};
}
let http=0;async function call(actor,path,method='GET',body,status=200){http++;const result=await actor.page.evaluate(async({path,method,body,token})=>{const r=await fetch(path,{method,headers:{'X-PGT-Client':'firestore-dev-structured-v2',Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};},{path,method,body,token:actor.token});assert.equal(result.status,status,method+' '+path+' '+(result.body?.error||'UNEXPECTED_STATUS'));return result.body;}
const endpoint=mail=>'/api/app/users/'+encodeURIComponent(mail);
try{
 const t=await login(trainer),s=await login(student,true),o=await login(other,false,true);
 const seeded=await call(s,endpoint(student)+'/snapshot');
 const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):v;
 const structure=seeded.techniques.data.positions.map(p=>({posicion:p.posicion,prioridad:p.prioridad,tecnicas:p.tecnicas.map(t=>({tipo:t.tipo}))}));
 assert.equal(createHash('sha256').update(JSON.stringify(canonical(structure))).digest('hex').slice(0,40),fixture.catalogStructureChecksum);checks.push('New student receives the exact reference names, priorities, technique types and array order');
 const registered=await call(o,endpoint(other)+'/snapshot');assert.equal(registered.profile.data.perfil,'alumno');exact(registered.techniques.data.positions.map(p=>p.posicion),seeded.techniques.data.positions.map(p=>p.posicion));
 const editedProfile={...registered.profile.data,nombre:'Perfil persistido',peso:72.25,perfil:'entrenador'};await call(o,endpoint(other)+'/profile','PUT',{data:editedProfile,sha:registered.profile.sha});let verified=await call(o,endpoint(other)+'/snapshot');assert.equal(verified.profile.data.nombre,'Perfil persistido');assert.equal(verified.profile.data.peso,72.25);assert.equal(verified.profile.data.perfil,'alumno');
 await call(o,'/api/app/role','POST',{mail:other,perfil:'entrenador',sha:verified.profile.sha},403);await call(t,'/api/app/role','POST',{mail:other,perfil:'entrenador',sha:verified.profile.sha});await call(o,endpoint(other)+'/snapshot','GET',undefined,401);
 o.token=(await call(o,'/api/app/login','POST',{mail:other,password})).token;verified=await call(o,endpoint(other)+'/snapshot');assert.equal(verified.profile.data.nombre,'Perfil persistido');assert.equal(verified.profile.data.perfil,'entrenador');await call(o,'/api/app/students');
 await call(t,'/api/app/role','POST',{mail:other,perfil:'alumno',sha:verified.profile.sha});await call(o,'/api/app/students','GET',undefined,401);checks.push('Public UI registration, profile persistence, privilege injection denied, role grant/revoke, invalidated session and fresh trainer authentication');

 await t.page.getByRole('button',{name:'Entrenador',exact:true}).click();await t.page.getByLabel('Buscar alumnos',{exact:true}).fill(student);await t.page.locator('.student-card').first().click();
 await t.page.locator('.student-detail details summary').first().click();
 await s.page.locator('details.position summary').first().click();
 assert.equal(await s.page.getByRole('button',{name:'Sincronizar',exact:true}).count(),0);
 const editor=s.page.getByLabel('Descripción de técnica o enlace de vídeo').first(),remote=t.page.getByLabel('Descripción del alumno',{exact:true}).first();
 // 12 paced samples through the actual autosave UI, with no reload or refresh.
 for(let i=0;i<12;i++){
  if(i)await wait(2500);
  const text='QA '+runId.slice(0,8)+' cambio '+i,start=Date.now();
  await editor.fill(text);await poll(()=>remote.inputValue().then(v=>v===text),'Automatic trainer update');samples.push(Date.now()-start);
 }
 await mkdir('artifacts',{recursive:true});
 // Keep the private original catalogue out of public Actions artifacts. The
 // paired description crops show the same synthetic edit; JSON carries timing.
 await editor.screenshot({path:'artifacts/firestore-student.png'});await remote.screenshot({path:'artifacts/firestore-trainer.png'});
 checks.push('12 real UI autosaves -> trainer without refresh');
 // A failed save stays a visible, exportable draft and is never retried silently.
 let blockedAttempts=0;
 await s.page.route('**/api/app/users/**/techniques',async route=>{if(route.request().method()==='PUT'){blockedAttempts++;await route.abort();}else await route.continue();});
 const failedText='QA borrador fallido '+runId.slice(0,8);await editor.fill(failedText);
 await s.page.getByRole('button',{name:'Reintentar guardado',exact:true}).waitFor();await wait(800);assert.equal(blockedAttempts,1);
 const download=s.page.waitForEvent('download');await s.page.getByRole('button',{name:'Exportar mi copia JSON',exact:true}).click();
 const backup=JSON.parse(await readFile(await (await download).path(),'utf8'));assert.equal(backup.entries.find(e=>e.key==='techniques').data.positions[0].tecnicas[0].descripcion_del_alumno,failedText);
 await s.page.unroute('**/api/app/users/**/techniques');await s.page.getByRole('button',{name:'Reintentar guardado',exact:true}).click();
 await poll(()=>remote.inputValue().then(v=>v===failedText),'Explicit draft retry reaches trainer');checks.push('Failed online draft exported; one failed attempt; explicit retry required');

 const snapshot=()=>call(s,endpoint(student)+'/snapshot');let before=await snapshot();
 await call(s,endpoint(other)+'/snapshot','GET',undefined,403);await call(s,'/api/app/students','GET',undefined,403);checks.push('Student cross-user and trainer endpoints denied');
 const today=madridDate(),date=n=>{const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
 const input={fecha_comienzo:date(-5),fecha_torneo:date(21),alumnos:[student,trainer],dias_de_entrenamiento:[1,2,3,4,5,6,7],ejercicios_por_sesion:5,tiempo_por_tecnica_segundos:180,descanso_entre_ciclos_segundos:10,descanso_entre_tecnicas_segundos:20};
 await t.page.getByRole('button',{name:'Entrenamiento del día',exact:true}).click();
 let transientReads=0;const transientRoute='**/api/app/users/'+encodeURIComponent(student)+'/snapshot?*';await s.page.route(transientRoute,async route=>{if(!transientReads++){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'QA_TRANSIENT_READ'})});}else await route.continue();});
 let catalog=await call(t,'/api/app/catalog');await call(t,'/api/app/competition','POST',{competition:input,sha:catalog.sha});
 // IndexedDB is observed, never mutated by this test: proves the live client accepted events.
 async function cached(actor,key){return actor.page.evaluate(async key=>{const request=indexedDB.open('pgt-active-user-v1');const db=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});try{return await new Promise((resolve,reject)=>{const r=db.transaction('entries').objectStore('entries').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}},key);}
 let assigned=await snapshot(),plan=assigned.plans.find(p=>p.data.fecha_torneo===input.fecha_torneo).data;const competition={...input,planId:plan.planId};
 await poll(()=>cached(s,'plan:'+plan.planId),'Assigned plan appears automatically in student cache');await s.page.unroute(transientRoute);assert.ok(transientReads>=2,'Transient snapshot must recover through a new GET');checks.push('Assignment automatically recovers from an injected transient GET 503 without replaying a mutation');
 const oracle=generatePlan(competition,student,assigned.techniques.data,assigned.comments.data,plan.generatedAt);oracle.appliedDescriptionUpdates={...assigned.techniques.data.descriptionUpdates};oracle.appliedCommentUpdates={...assigned.comments.data.commentUpdates};exact(plan,oracle);checks.push('Exact full generated plan equals existing domain oracle');
 await s.page.getByRole('button',{name:/^Mis planes/}).click();await s.page.getByLabel('Mi plan',{exact:true}).selectOption(plan.planId);const pdfDownload=s.page.waitForEvent('download');await s.page.getByRole('button',{name:'Exportar PDF',exact:true}).click();const pdf=await readFile(await(await pdfDownload).path());assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.ok(pdf.length>10000);checks.push('PDF exported in browser from native persisted plan');await s.page.getByRole('button',{name:'Mis técnicas',exact:true}).click();const firstPosition=s.page.locator('details.position').first();if(!await firstPosition.evaluate(node=>node.open))await firstPosition.locator('summary').click();
 await poll(()=>t.page.locator('.student-count').allTextContents().then(v=>v.some(text=>text.includes('2 alumnos'))),'Assignment updates training day automatically');checks.push('Automatic training-day update after assignment');
 const comments={...assigned.comments.data,comments:[{techniqueId:assigned.techniques.data.positions[0].tecnicas[0].id,comment:'QA comentario '+runId.slice(0,8)}]};
 await call(t,endpoint(student)+'/comments','PUT',{data:comments,sha:assigned.comments.sha});await poll(()=>cached(s,'comments').then(v=>v?.data.comments.some(c=>c.comment===comments.comments[0].comment)),'Comment arrives automatically');
 let updated=await snapshot(),expected=updateFuturePlanText(plan,updated.techniques.data,updated.comments.data,today);exact(updated.plans.find(p=>p.data.planId===plan.planId).data.sessions,expected.sessions);checks.push('Automatic comment reception and exact future text update');
 const oldPlan=updated.plans.find(p=>p.data.planId===plan.planId).data,deleted=structuredClone(updated.techniques.data);deleted.positions[0].tecnicas.shift();
 await call(s,endpoint(student)+'/techniques','PUT',{data:deleted,sha:updated.techniques.sha});updated=await snapshot();const after=updated.plans.find(p=>p.data.planId===plan.planId).data;
 const recalc=updateFuturePlanText(updateFutureDeletions(oldPlan,updated.techniques.data,updated.comments.data,today),updated.techniques.data,updated.comments.data,today);exact(after.sessions,recalc.sessions);exact(after.continuity,recalc.continuity);exact(after.sessions.filter(v=>v.date<=today),plan.sessions.filter(v=>v.date<=today));checks.push('Exact deletion recalculation and protected past/today');
 // Stale write must fail; it cannot overwrite the confirmed source.
 await call(s,endpoint(student)+'/techniques','PUT',{data:deleted,sha:assigned.techniques.sha},409);checks.push('Stale write rejected');
 // Network interruption: no durable mutation can be queued; reconnect reloads truth.
 await s.context.setOffline(true);await poll(()=>s.page.getByText('Sin conexión · copia local de consulta',{exact:true}).isVisible(),'Offline state');
 const previous=await editor.inputValue();await editor.fill('MUST_NOT_BE_STORED');await wait(1000);await s.context.setOffline(false);
 await poll(()=>cached(s,'techniques').then(v=>v&&!JSON.stringify(v.data).includes('MUST_NOT_BE_STORED')),'No offline replay');assert.ok(!JSON.stringify((await snapshot()).techniques.data).includes('MUST_NOT_BE_STORED'));checks.push('Offline mutation rejected; reconnect reloads authoritative state');
 catalog=await call(t,'/api/app/catalog');await call(t,'/api/app/assignment','POST',{planId:plan.planId,alumnos:[trainer],sha:catalog.sha});await poll(()=>cached(s,'plan:'+plan.planId).then(v=>!v),'Unassignment removes cached plan automatically');checks.push('Automatic unassignment removal');
 await poll(()=>t.page.locator('.day-groups').textContent().then(text=>!text.includes('Alumno de prueba')),'Training-day removes unassigned student automatically');
 catalog=await call(t,'/api/app/catalog');await call(t,'/api/app/delete-competition','POST',{planId:plan.planId,sha:catalog.sha});
 await call(s,'/api/app/logout','POST',{});await poll(()=>s.page.getByRole('button',{name:'Entrar',exact:true}).isVisible(),'Revoked socket/session');await call(s,'/api/app/realtime-ticket','POST',{},401);checks.push('Logout revokes subscription and tickets');
 exact(errors,[]);
 const sorted=[...samples].sort((a,b)=>a-b),p=n=>sorted[Math.min(sorted.length-1,Math.ceil(n*sorted.length)-1)];
 const report={status:local?'FIRESTORE_LOCAL_BROWSER_QA_VERIFIED':'FIRESTORE_DEV_LIVE_QA_VERIFIED',googleTransport:local?'INTERCEPTED':'REAL',project:'pgt-bjj-dev',database:'(default)',worker:'pgt-github-probe-dev',commit:process.env.GITHUB_SHA,runId,synthetic:true,contexts:3,roles:['entrenador','alumno','alumno'],samplesMs:samples,p50Ms:p(.5),p95Ms:p(.95),latencyIncludes:'700ms autosave debounce + Worker commit + WebSocket + authorized re-read + render',checks,httpTestCalls:http,clientNetwork:network,limits:'Chromium desktop and mobile viewport, not physical devices or Safari; billing counters not queried'};
 assert.ok(report.p95Ms<10000,'DEV propagation exceeds 10 seconds including autosave and complete refresh');
 finalReport=report;
}catch(error){failureReport={status:'QA_FAILED',googleTransport:local?'INTERCEPTED':'REAL',project:'pgt-bjj-dev',commit:process.env.GITHUB_SHA,completedChecks:checks,samplesMs:samples,clientNetwork:network,pageErrors:errors.map(()=>true)};console.log(JSON.stringify(failureReport));await mkdir('artifacts',{recursive:true});for(const [index,role] of [[0,'trainer'],[1,'student']]){const page=contexts[index]?.pages()[0];if(page&&local)await page.screenshot({path:'artifacts/firestore-'+role+'.png',fullPage:true}).catch(()=>{});}throw error;}finally{for(const context of contexts)await context.close();await browser.close();
 let cleanup;for(let attempt=0;attempt<100;attempt++){const cleaned=await fetch(origin+'/api/dev/synthetic-fixture-cleanup',{method:'POST',headers:{Origin:realOrigin,Authorization:'Bearer '+(local?'synthetic-deployment-token':process.env.CLOUDFLARE_API_TOKEN),'Content-Type':'application/json'},body:JSON.stringify({runId,password})});
 cleanup=await cleaned.json();if(!cleaned.ok)throw Error('Synthetic cleanup failed: '+JSON.stringify(cleanup));if(cleanup.status==='SYNTHETIC_FIXTURE_CLEANED')break;if(cleanup.status!=='SYNTHETIC_FIXTURE_CLEANING'||attempt===99)throw Error('Synthetic cleanup did not finish');}
 const recorded=finalReport||failureReport;if(recorded){recorded.fixtureCleanup=true;await mkdir('artifacts',{recursive:true});await writeFile(local?'artifacts/firestore-local-browser.json':'artifacts/firestore-dev-live.json',JSON.stringify(recorded,null,2));console.log(JSON.stringify(recorded));}
}
