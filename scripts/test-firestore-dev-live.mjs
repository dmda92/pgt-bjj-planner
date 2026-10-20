import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
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
const response=await fetch(origin+'/api/dev/synthetic-fixture',{method:'POST',headers:{Origin:realOrigin,Authorization:'Bearer '+(local?'synthetic-deployment-token':process.env.CLOUDFLARE_API_TOKEN),'Content-Type':'application/json'},body:JSON.stringify({runId,password})});
const fixture=await response.json();assert.equal(response.status,200,JSON.stringify(fixture));
const [trainer,student,other]=fixture.users.map(u=>u.mail);
const browser=await chromium.launch({headless:true});
const contexts=[],errors=[],samples=[],checks=[],network={requests:0,mutations:0,snapshots:0,websocketMessages:0};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function poll(fn,message,timeout=20000){const until=Date.now()+timeout;let last;while(Date.now()<until){try{last=await fn();if(last)return last;}catch(e){last=e.message;}await wait(100);}throw Error(message+': '+String(last));}
async function login(mail,mobile=false){
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},serviceWorkers:'block'});contexts.push(context);const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{const path=new URL(r.url()).pathname;if(path.startsWith('/api/app/')){network.requests++;if(!['GET','HEAD'].includes(r.method()))network.mutations++;if(path.endsWith('/snapshot'))network.snapshots++;}});page.on('websocket',ws=>ws.on('framereceived',()=>network.websocketMessages++));
 await page.goto(origin,{waitUntil:'networkidle'});await page.getByLabel('Correo',{exact:true}).fill(mail);await page.getByLabel('Contraseña',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.getByRole('button',{name:'Salir',exact:true}).waitFor({timeout:30000});
 const token=await page.evaluate(()=>JSON.parse(localStorage.getItem('pgt-session')).token);console.log('::add-mask::'+token);return {context,page,token,mail};
}
let http=0;async function call(actor,path,method='GET',body,status=200){http++;const result=await actor.page.evaluate(async({path,method,body,token})=>{const r=await fetch(path,{method,headers:{'X-PGT-Client':'firestore-dev-v1',Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};},{path,method,body,token:actor.token});assert.equal(result.status,status,method+' '+path+' '+JSON.stringify(result.body));return result.body;}
const endpoint=mail=>'/api/app/users/'+encodeURIComponent(mail);
try{
 const t=await login(trainer),s=await login(student,true),o=await login(other);
 await t.page.getByRole('button',{name:'Entrenador',exact:true}).click();await t.page.locator('.student-card').filter({hasText:student}).click();
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
 checks.push('12 real UI autosaves -> trainer without refresh');
 const snapshot=()=>call(s,endpoint(student)+'/snapshot');let before=await snapshot();
 await call(s,endpoint(other)+'/snapshot','GET',undefined,403);await call(s,'/api/app/students','GET',undefined,403);checks.push('Student cross-user and trainer endpoints denied');
 const today=madridDate(),date=n=>{const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
 const input={fecha_comienzo:date(-5),fecha_torneo:date(21),alumnos:[student,trainer],dias_de_entrenamiento:[1,2,3,4,5,6,7],ejercicios_por_sesion:5,tiempo_por_tecnica_segundos:180,descanso_entre_ciclos_segundos:10,descanso_entre_tecnicas_segundos:20};
 await t.page.getByRole('button',{name:'Entrenamiento del día',exact:true}).click();
 let catalog=await call(t,'/api/app/catalog');await call(t,'/api/app/competition','POST',{competition:input,sha:catalog.sha});
 // IndexedDB is observed, never mutated by this test: proves the live client accepted events.
 async function cached(actor,key){return actor.page.evaluate(async key=>{const request=indexedDB.open('pgt-active-user-v1');const db=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});try{return await new Promise((resolve,reject)=>{const r=db.transaction('entries').objectStore('entries').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}},key);}
 let assigned=await snapshot(),plan=assigned.plans.find(p=>p.data.fecha_torneo===input.fecha_torneo).data;const competition={...input,planId:plan.planId};
 await poll(()=>cached(s,'plan:'+plan.planId),'Assigned plan appears automatically in student cache');
 const oracle=generatePlan(competition,student,assigned.techniques.data,assigned.comments.data,plan.generatedAt);oracle.appliedDescriptionUpdates={...assigned.techniques.data.descriptionUpdates};oracle.appliedCommentUpdates={...assigned.comments.data.commentUpdates};assert.deepEqual(plan,oracle);checks.push('Exact full generated plan equals existing domain oracle');
 await poll(()=>t.page.locator('.student-count').allTextContents().then(v=>v.some(text=>text.includes('2 alumnos'))),'Assignment updates training day automatically');checks.push('Automatic training-day update after assignment');
 const comments={...assigned.comments.data,comments:[{techniqueId:assigned.techniques.data.positions[0].tecnicas[0].id,comment:'QA comentario '+runId.slice(0,8)}]};
 await call(t,endpoint(student)+'/comments','PUT',{data:comments,sha:assigned.comments.sha});await poll(()=>cached(s,'comments').then(v=>v?.data.comments.some(c=>c.comment===comments.comments[0].comment)),'Comment arrives automatically');
 let updated=await snapshot(),expected=updateFuturePlanText(plan,updated.techniques.data,updated.comments.data,today);assert.deepEqual(updated.plans.find(p=>p.data.planId===plan.planId).data.sessions,expected.sessions);checks.push('Automatic comment reception and exact future text update');
 const oldPlan=updated.plans.find(p=>p.data.planId===plan.planId).data,deleted=structuredClone(updated.techniques.data);deleted.positions[0].tecnicas.shift();
 await call(s,endpoint(student)+'/techniques','PUT',{data:deleted,sha:updated.techniques.sha});updated=await snapshot();const after=updated.plans.find(p=>p.data.planId===plan.planId).data;
 const recalc=updateFuturePlanText(updateFutureDeletions(oldPlan,updated.techniques.data,updated.comments.data,today),updated.techniques.data,updated.comments.data,today);assert.deepEqual(after.sessions,recalc.sessions);assert.deepEqual(after.continuity,recalc.continuity);assert.deepEqual(after.sessions.filter(v=>v.date<=today),plan.sessions.filter(v=>v.date<=today));checks.push('Exact deletion recalculation and protected past/today');
 // Stale write must fail; it cannot overwrite the confirmed source.
 await call(s,endpoint(student)+'/techniques','PUT',{data:deleted,sha:assigned.techniques.sha},409);checks.push('Stale write rejected');
 // Network interruption: no durable mutation can be queued; reconnect reloads truth.
 await s.context.setOffline(true);await poll(()=>s.page.getByText('Sin conexión · copia local de consulta',{exact:true}).isVisible(),'Offline state');
 const previous=await editor.inputValue();await editor.fill('MUST_NOT_BE_STORED');await wait(1000);await s.context.setOffline(false);
 await poll(()=>cached(s,'techniques').then(v=>v&&!JSON.stringify(v.data).includes('MUST_NOT_BE_STORED')),'No offline replay');checks.push('Offline mutation rejected; reconnect reloads authoritative state');
 catalog=await call(t,'/api/app/catalog');await call(t,'/api/app/assignment','POST',{planId:plan.planId,alumnos:[trainer],sha:catalog.sha});await poll(()=>cached(s,'plan:'+plan.planId).then(v=>!v),'Unassignment removes cached plan automatically');checks.push('Automatic unassignment removal');
 await poll(()=>t.page.locator('.day-groups').textContent().then(text=>!text.includes('Alumno de prueba')),'Training-day removes unassigned student automatically');
 catalog=await call(t,'/api/app/catalog');await call(t,'/api/app/delete-competition','POST',{planId:plan.planId,sha:catalog.sha});
 await call(s,'/api/app/logout','POST',{});await poll(()=>s.page.getByText('La sesión ha cambiado. Vuelve a entrar.',{exact:true}).isVisible(),'Revoked socket/session');await call(s,'/api/app/realtime-ticket','POST',{},401);checks.push('Logout revokes subscription and tickets');
 assert.deepEqual(errors,[]);
 const sorted=[...samples].sort((a,b)=>a-b),p=n=>sorted[Math.min(sorted.length-1,Math.ceil(n*sorted.length)-1)];
 const report={status:local?'FIRESTORE_LOCAL_BROWSER_QA_VERIFIED':'FIRESTORE_DEV_LIVE_QA_VERIFIED',googleTransport:local?'INTERCEPTED':'REAL',project:'pgt-bjj-dev',database:'(default)',worker:'pgt-github-probe-dev',commit:process.env.GITHUB_SHA,runId,synthetic:true,contexts:3,roles:['entrenador','alumno','alumno'],samplesMs:samples,p50Ms:p(.5),p95Ms:p(.95),latencyIncludes:'700ms autosave debounce + Worker commit + WebSocket + authorized re-read + render',checks,httpTestCalls:http,clientNetwork:network,limits:'Chromium desktop and mobile viewport, not physical devices or Safari; billing counters not queried'};
 await mkdir('artifacts',{recursive:true});await writeFile(local?'artifacts/firestore-local-browser.json':'artifacts/firestore-dev-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 assert.ok(report.p95Ms<10000,'DEV propagation exceeds 10 seconds including autosave and complete refresh');
}finally{for(const context of contexts)await context.close();await browser.close();}
