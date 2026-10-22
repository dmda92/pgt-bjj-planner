import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {limitedRuntimePlugin,limitedOutbound} from '../tests/limited-cloudflare-runtime.mjs';
import WebSocket from 'ws';
import {Miniflare,convertV4MiniflareOptions,kCurrentWorker} from 'miniflare';
import {structuredFixture} from '../tests/structured-firestore-fixture.ts';
import {generatePlan} from '../src/domain/planner.ts';
import {madridDate,updateFuturePlanText} from '../src/domain/plan-text-updates.ts';
import {updateFutureDeletions} from '../src/domain/plan-continuity.ts';
const f=await structuredFixture(),origin='https://pgt-github-probe-dev.david-dzm5.workers.dev';
const outbound=limitedOutbound(f.transport);
function checkBudgets(){const highest=Math.max(0,...outbound.counts.values());assert.ok(highest<=32);return highest;}
const bundle=await build({plugins:[limitedRuntimePlugin],entryPoints:['worker/dev.ts'],bundle:true,write:false,external:['cloudflare:workers'],format:'esm',target:'es2022'});
const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-13',durableObjects:{SECURITY:{className:'ProbeSecurity',useSQLite:true},DOMAIN_IO:{className:'DomainIO',useSQLite:true}},bindings:{...f.env,ALLOWED_ORIGINS:origin},outboundService:request=>outbound.fetch(request)}));
let requests=0,maxSubrequests=0;const sockets=[],costs=[];
async function call(path,method='GET',body,token='',status=200){
 const costBefore=f.metrics();const r=await runtime.dispatchFetch('http://localhost'+path,{method,headers:{Origin:origin,'X-PGT-Client':'firestore-dev-structured-v2','CF-Connecting-IP':'synthetic-'+requests++,...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 maxSubrequests=Math.max(maxSubrequests,checkBudgets());
 const v=await r.json();assert.equal(r.status,status,method+' '+path+' '+JSON.stringify(v));costs.push({path,method,reads:f.metrics().estimatedReads-costBefore.estimatedReads,writes:f.metrics().attemptedWrites-costBefore.attemptedWrites,deletes:f.metrics().attemptedDeletes-costBefore.attemptedDeletes,http:f.metrics().httpRequests-costBefore.httpRequests});return v;
}
async function socket(token){
 const {ticket}=await call('/api/app/realtime-ticket','POST',{},token);
 const address=await runtime.ready;const url=new URL('/api/app/realtime?ticket='+ticket,address);url.protocol='ws:';
 const ws=new WebSocket(url,{headers:{Origin:origin}}),messages=[];ws.on('message',data=>messages.push(JSON.parse(String(data))));
 await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});sockets.push(ws);return {ws,messages};
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function changed(w,after){for(let n=0;n<100;n++){if(w.messages.slice(after).some(v=>v.type==='changed'))return;await sleep(20);}assert.fail('Missing realtime change');}
try{
 const manifest=await runtime.dispatchFetch('http://localhost/api/dev/runtime');assert.equal(manifest.status,200);assert.equal((await manifest.json()).revision,'structured-credentials-check-20261021-v1');assert.equal(manifest.headers.get('X-PGT-Worker-Build'),'local');
 const obsolete=await runtime.dispatchFetch('http://localhost/api/app/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});assert.equal(obsolete.status,426);
 const runId=crypto.randomUUID(),password='synthetic-runtime-password-more-than-24';
 await call('/api/dev/structured-bootstrap','POST',{},'synthetic-deployment-token');
 let setup;for(let n=0;n<4;n++){setup=await call('/api/dev/synthetic-fixture','POST',{runId,password},'synthetic-deployment-token');if(setup.status==='SYNTHETIC_FIXTURE_CREATED')break;}assert.equal(setup.status,'SYNTHETIC_FIXTURE_CREATED');
 const verified=await call('/api/dev/synthetic-fixture-check','POST',{runId,password},'synthetic-deployment-token');
 for(const user of verified.users)for(const key of ['profileExists','credentialsExist','hashFormatValid','repositoryRestoresHash','passwordMatches','profileRoleCorrect'])assert.equal(user[key],true,key);
 const [trainer,student,other]=setup.users.map(u=>u.mail),login=mail=>call('/api/app/login','POST',{mail,password});
 await call('/api/app/register','POST',{mail:other,password,confirm:password,nombre:'Registro público',apellidos:'QA'},'',201);
 const t=await login(trainer),s=await login(student),o=await login(other);
 await call('/api/app/domain-io','POST',{entries:[['app-session:forged',{role:'entrenador'}]]},s.token,404);
 const sw=await socket(s.token),tw=await socket(t.token),ow=await socket(o.token);await sleep(10);
 const endpoint='/api/app/users/'+encodeURIComponent(student),snapshot=()=>call(endpoint+'/snapshot','GET',undefined,s.token);
 let old=await snapshot();
 const known=Object.fromEntries(['profile','techniques','comments','index'].map(key=>[key,old[key].sha]));
 const unchanged=await call(endpoint+'/snapshot?known='+encodeURIComponent(JSON.stringify(known)),'GET',undefined,s.token);
 for(const key of ['profile','techniques','comments','index'])assert.equal(unchanged[key].unchanged,true);
 assert.equal(costs.at(-1).writes,0);assert.equal(costs.at(-1).deletes,0);

 const tech=structuredClone(old.techniques.data);tech.positions[0].tecnicas[0].descripcion_del_alumno='Cambio desde alumno';
 const mark=tw.messages.length,privateMark=ow.messages.length;
 await call(endpoint+'/techniques','PUT',{data:tech,sha:old.techniques.sha},s.token);await changed(tw,mark);await sleep(50);assert.equal(ow.messages.length,privateMark);
 const view=await call(endpoint+'/view?section=techniques','GET',undefined,t.token);assert.equal(view.techniques.data.positions[0].tecnicas[0].descripcion_del_alumno,'Cambio desde alumno');
 await call('/api/app/users/'+encodeURIComponent(other)+'/snapshot','GET',undefined,s.token,403);
 await call('/api/app/students','GET',undefined,s.token,403);
 const today=madridDate(),offset=n=>{const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
 const competition={planId:crypto.randomUUID(),fecha_comienzo:offset(-1),fecha_torneo:offset(2),alumnos:[student,trainer],dias_de_entrenamiento:[1,2,3,4,5,6,7],ejercicios_por_sesion:2,tiempo_por_tecnica_segundos:180,descanso_entre_ciclos_segundos:10,descanso_entre_tecnicas_segundos:20};
 const catalog=await call('/api/app/catalog','GET',undefined,t.token);
 await call('/api/app/competition','POST',{competition,sha:catalog.sha},t.token);
 old=await snapshot();const original=old.plans[0].data;competition.planId=original.planId;
 // DEV additions: one small plan, native persistence, authorized realtime and no-op retry.
 const beforeAddition=structuredClone(original),addedTechnique={id:crypto.randomUUID(),tipo:'Nueva técnica runtime',descripcion_del_alumno:''};
 const addedSource=structuredClone(old.techniques.data);addedSource.positions[0].tecnicas.push(addedTechnique);
 // Treat the entire catalogue in each session so the added UUID must fit even in this short plan.
 // Use a separate bounded competition instead of forging server-owned plan fields.
 const additionCompetition={...competition,planId:crypto.randomUUID(),alumnos:[student],fecha_comienzo:offset(1),fecha_torneo:offset(3),ejercicios_por_sesion:40};
 await call('/api/app/competition','POST',{competition:additionCompetition,sha:(await call('/api/app/catalog','GET',undefined,t.token)).sha},t.token);
 additionCompetition.planId=(await call('/api/app/catalog','GET',undefined,t.token)).data.plans.at(-1).planId;
 old=await snapshot();
 const additionNotice=tw.messages.length;
 await call(endpoint+'/techniques','PUT',{data:addedSource,sha:old.techniques.sha},s.token);await changed(tw,additionNotice);
 let additionSnapshot=await snapshot(),additionResult=additionSnapshot.plans.find(p=>p.data.planId===additionCompetition.planId).data;
 assert.ok(additionResult.sessions.flatMap(s=>s.exercises).some(e=>e.techniqueId===addedTechnique.id));
 assert.deepEqual(additionResult.sessions,generatePlan(additionCompetition,student,additionSnapshot.techniques.data,additionSnapshot.comments.data).sessions);
 assert.deepEqual(additionSnapshot.plans.find(p=>p.data.planId===original.planId).data.sessions.filter(s=>s.date<=today),beforeAddition.sessions.filter(s=>s.date<=today));
 const beforeRename=structuredClone(additionResult),renamed=structuredClone(additionSnapshot.techniques.data);
 renamed.positions[0].tecnicas.find(v=>v.id===addedTechnique.id).tipo='Otra mas';
 renamed.positions[0].posicion='Posición renombrada';
 const renameNotice=tw.messages.length;
 await call(endpoint+'/techniques','PUT',{data:renamed,sha:additionSnapshot.techniques.sha},s.token);await changed(tw,renameNotice);
 additionSnapshot=await snapshot();additionResult=additionSnapshot.plans.find(p=>p.data.planId===additionCompetition.planId).data;
 const renamedOccurrences=additionResult.sessions.flatMap(s=>s.exercises).filter(e=>e.techniqueId===addedTechnique.id);
 assert.ok(renamedOccurrences.length);assert.ok(renamedOccurrences.every(e=>e.tipo==='Otra mas'&&e.posicion==='Posición renombrada'));
 const layout=p=>p.sessions.map(s=>({...s,exercises:s.exercises.map(({tipo,posicion,...e})=>e)}));
 assert.deepEqual(layout(additionResult),layout(beforeRename));assert.deepEqual(additionResult.continuity,beforeRename.continuity);
 assert.equal(additionResult.appliedAdditionRevision,beforeRename.appliedAdditionRevision);
 assert.deepEqual(additionSnapshot.plans.find(p=>p.data.planId===original.planId).data.sessions.filter(s=>s.date<=today),beforeAddition.sessions.filter(s=>s.date<=today));
 const stableWrites=f.metrics().attemptedWrites;await snapshot();assert.equal(f.metrics().attemptedWrites,stableWrites,'Reading already repaired labels must not rewrite plans');
 console.log('DEV_PLAN_RENAME_RUNTIME_PASS: Otra mas persisted in every future occurrence, position label propagated, authorized realtime, unchanged scheduling/continuity, protected history, repeated read zero writes. Google intercepted.');
 const emptySource=structuredClone(additionSnapshot.techniques.data),emptyId=crypto.randomUUID();emptySource.positions.push({id:emptyId,posicion:'Posición vacía',prioridad:2,tecnicas:[]});
 const stablePlans=JSON.stringify(additionSnapshot.plans);
 await call(endpoint+'/techniques','PUT',{data:emptySource,sha:additionSnapshot.techniques.sha},s.token);
 additionSnapshot=await snapshot();assert.equal(JSON.stringify(additionSnapshot.plans),stablePlans);
 const populated=structuredClone(additionSnapshot.techniques.data),newPositionTechnique={id:crypto.randomUUID(),tipo:'Técnica nueva posición',descripcion_del_alumno:''};populated.positions.at(-1).tecnicas.push(newPositionTechnique);
 await call(endpoint+'/techniques','PUT',{data:populated,sha:additionSnapshot.techniques.sha},s.token);
 additionSnapshot=await snapshot();additionResult=additionSnapshot.plans.find(p=>p.data.planId===additionCompetition.planId).data;
 assert.ok(additionResult.sessions.flatMap(s=>s.exercises).some(e=>e.techniqueId===newPositionTechnique.id));
 assert.deepEqual(additionResult.sessions,generatePlan(additionCompetition,student,additionSnapshot.techniques.data,additionSnapshot.comments.data).sessions);
 await call(endpoint+'/techniques','PUT',{data:{...additionSnapshot.techniques.data,additionRevision:999999},sha:additionSnapshot.techniques.sha},s.token);
 assert.equal(costs.at(-1).writes,0,'Identical source or forged addition checkpoint must not rewrite plans');
 const finalAddition=await snapshot();assert.equal(JSON.stringify(finalAddition.plans),JSON.stringify(additionSnapshot.plans));
 console.log('DEV_ADDITIONS_RUNTIME_PASS: technique/newly populated position, exact original generator, empty position no-op, history protected, realtime notice and spoof/no-op write rejected; Google intercepted.');
 // Unassign this extra fixture plan to leave the original runtime scenarios unchanged.
 await call('/api/app/assignment','POST',{planId:additionCompetition.planId,alumnos:[],sha:(await call('/api/app/catalog','GET',undefined,t.token)).sha},t.token);
 old=await snapshot();

}finally{for(const ws of sockets)try{ws.close();}catch{}await runtime.dispose();}
