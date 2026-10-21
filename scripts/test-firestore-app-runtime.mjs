import assert from 'node:assert/strict';
import {build} from 'esbuild';
import WebSocket from 'ws';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {structuredFixture} from '../tests/structured-firestore-fixture.ts';
import {generatePlan} from '../src/domain/planner.ts';
import {madridDate,updateFuturePlanText} from '../src/domain/plan-text-updates.ts';
import {updateFutureDeletions} from '../src/domain/plan-continuity.ts';
const f=await structuredFixture(),origin='https://pgt-github-probe-dev.david-dzm5.workers.dev';
const bundle=await build({entryPoints:['worker/dev.ts'],bundle:true,write:false,format:'esm',target:'es2022'});
const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-13',durableObjects:{SECURITY:{className:'ProbeSecurity',useSQLite:true}},bindings:{...f.env,ALLOWED_ORIGINS:origin},outboundService:async request=>f.transport(request.url,{method:request.method,headers:request.headers,body:['GET','HEAD'].includes(request.method)?undefined:await request.text()})}));
let requests=0;const sockets=[];
async function call(path,method='GET',body,token='',status=200){
 const started=f.calls.length;
 const r=await runtime.dispatchFetch('http://localhost'+path,{method,headers:{Origin:origin,'X-PGT-Client':'firestore-dev-structured-v2','CF-Connecting-IP':'synthetic-'+requests++,...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 assert.ok(f.calls.length-started<=50,'DEV runtime exceeded 50 subrequests ('+(f.calls.length-started)+'): '+method+' '+path);
 const v=await r.json();assert.equal(r.status,status,method+' '+path+' '+JSON.stringify(v));return v;
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
 const obsolete=await runtime.dispatchFetch('http://localhost/api/app/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});assert.equal(obsolete.status,426);
 const runId=crypto.randomUUID(),password='synthetic-runtime-password-more-than-24';
 await call('/api/dev/structured-bootstrap','POST',{},'synthetic-deployment-token');
 let setup;for(let n=0;n<4;n++){setup=await call('/api/dev/synthetic-fixture','POST',{runId,password},'synthetic-deployment-token');if(setup.status==='SYNTHETIC_FIXTURE_CREATED')break;}assert.equal(setup.status,'SYNTHETIC_FIXTURE_CREATED');
 const [trainer,student,other]=setup.users.map(u=>u.mail),login=mail=>call('/api/app/login','POST',{mail,password});
 await call('/api/app/register','POST',{mail:other,password,confirm:password,nombre:'Registro público',apellidos:'QA'},'',201);
 const [t,s,o]=await Promise.all([login(trainer),login(student),login(other)]);
 const sw=await socket(s.token),tw=await socket(t.token),ow=await socket(o.token);await sleep(10);
 const endpoint='/api/app/users/'+encodeURIComponent(student),snapshot=()=>call(endpoint+'/snapshot','GET',undefined,s.token);
 let old=await snapshot();
 const tech=structuredClone(old.techniques.data);tech.positions[0].tecnicas[0].descripcion_del_alumno='Cambio desde alumno';
 const mark=tw.messages.length,privateMark=ow.messages.length;
 await call(endpoint+'/techniques','PUT',{data:tech,sha:old.techniques.sha},s.token);await changed(tw,mark);await sleep(50);assert.equal(ow.messages.length,privateMark);
 const view=await call(endpoint+'/view?section=techniques','GET',undefined,t.token);assert.equal(view.techniques.data.positions[0].tecnicas[0].descripcion_del_alumno,'Cambio desde alumno');
 await call('/api/app/users/'+encodeURIComponent(other)+'/snapshot','GET',undefined,s.token,403);
 await call('/api/app/students','GET',undefined,s.token,403);
 const today=madridDate(),offset=n=>{const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
 const competition={planId:crypto.randomUUID(),fecha_comienzo:offset(-5),fecha_torneo:offset(20),alumnos:[student,trainer],dias_de_entrenamiento:[1,2,3,4,5,6,7],ejercicios_por_sesion:5,tiempo_por_tecnica_segundos:180,descanso_entre_ciclos_segundos:10,descanso_entre_tecnicas_segundos:20};
 const catalog=await call('/api/app/catalog','GET',undefined,t.token);
 await call('/api/app/competition','POST',{competition,sha:catalog.sha},t.token);
 old=await snapshot();const original=old.plans[0].data;competition.planId=original.planId;
 const day=await call('/api/app/training-day?date='+offset(1),'GET',undefined,t.token);assert.equal(day.groups.reduce((n,g)=>n+g.students.length,0),2);
 await call('/api/app/training-day?date='+offset(1),'GET',undefined,s.token,403);
 const oracle=generatePlan(competition,student,old.techniques.data,old.comments.data,original.generatedAt);oracle.appliedDescriptionUpdates={...old.techniques.data.descriptionUpdates};oracle.appliedCommentUpdates={...old.comments.data.commentUpdates};
 assert.deepEqual(original,oracle);
 const comments={...old.comments.data,comments:[{techniqueId:tech.positions[0].tecnicas[0].id,comment:'Comentario remoto'}]};
 const commentMark=sw.messages.length;await call(endpoint+'/comments','PUT',{data:comments,sha:old.comments.sha},t.token);await changed(sw,commentMark);
 let updated=await snapshot(),expected=updateFuturePlanText(original,updated.techniques.data,updated.comments.data,today);
 assert.deepEqual(updated.plans[0].data.sessions,expected.sessions);assert.deepEqual(updated.plans[0].data.sessions.filter(v=>v.date<=today),original.sessions.filter(v=>v.date<=today));
 const deletion=structuredClone(updated.techniques.data);deletion.positions[0].tecnicas.shift();
 await call(endpoint+'/techniques','PUT',{data:deletion,sha:updated.techniques.sha},s.token);
 const after=await snapshot(),recalculated=updateFuturePlanText(updateFutureDeletions(updated.plans[0].data,after.techniques.data,after.comments.data,today),after.techniques.data,after.comments.data,today);
 assert.deepEqual(after.plans[0].data.sessions,recalculated.sessions);assert.deepEqual(after.plans[0].data.continuity,recalculated.continuity);
 const data=structuredClone(after.techniques.data);data.positions[0].posicion+=' edit';
 const results=await Promise.all([call(endpoint+'/techniques','PUT',{data,sha:after.techniques.sha},s.token),call(endpoint+'/techniques','PUT',{data,sha:after.techniques.sha},s.token,409)]);assert.ok(results);
 const c=await call('/api/app/catalog','GET',undefined,t.token);await call('/api/app/assignment','POST',{planId:competition.planId,alumnos:[trainer],sha:c.sha},t.token);assert.equal((await snapshot()).plans.length,0);
 const reused=(await call('/api/app/realtime-ticket','POST',{},s.token)).ticket;
 const once=await runtime.dispatchFetch('http://localhost/api/app/realtime?ticket='+reused,{headers:{Origin:origin,Upgrade:'websocket'}});once.webSocket.accept();sockets.push(once.webSocket);
 const twice=await runtime.dispatchFetch('http://localhost/api/app/realtime?ticket='+reused,{headers:{Origin:origin,Upgrade:'websocket'}});assert.equal(twice.status,401);
 let closed=false;sw.ws.on('close',()=>closed=true);await call('/api/app/logout','POST',{},s.token);for(let i=0;i<40&&!closed;i++)await sleep(20);assert.ok(closed||sw.ws.readyState>=2,"revoked socket must close; state="+sw.ws.readyState);
 await call('/api/app/realtime-ticket','POST',{},s.token,401);
 for(let n=0;n<100;n++){const c=await call('/api/dev/synthetic-fixture-cleanup','POST',{runId,password},'synthetic-deployment-token');if(c.status==='SYNTHETIC_FIXTURE_CLEANED')break;assert.equal(c.status,'SYNTHETIC_FIXTURE_CLEANING');if(n===99)throw Error('QA cleanup did not finish');}
 await call('/api/app/students','GET',undefined,t.token,401);
 assert.ok(!JSON.stringify([...f.docs]).includes(runId),'QA user/credential/revision remains');
 assert.ok(!JSON.stringify([...f.docs]).includes(competition.planId),'QA plan reference/tombstone remains');
 assert.ok(f.calls.every(c=>!c.url.includes('api.github.com'))); // Only the separately intercepted fixed reference import reads GitHub.
 console.log('DEV workerd + SQLite + Firestore protocol: login/roles/isolation, two authorized sockets, no third-user leak, exact generated plan, text/deletion recalculation and protected history, CAS, unassignment, one-use tickets/logout revocation PASS. Google transport intercepted; not remote Firestore.');
}finally{for(const ws of sockets)try{ws.close();}catch{}await runtime.dispose();}
