const {AppApi}=await import(process.argv.includes('--legacy-snapshot')?'../worker/.performance-baseline.ts':'../worker/application.ts');
import {generatePlan} from '../src/domain/planner.ts';
import {initialVersion,cloneTemplate} from '../src/domain/models.ts';
import {template} from '../tests/template-fixture.ts';
import {performance} from 'node:perf_hooks';
import {writeFile,mkdir} from 'node:fs/promises';
const files=new Map(),sessions=new Map();let serial=1,delay=12,reads=0,lists=0,planReads=0,jsonMs=0,planCheckMs=0,intervals=[];
const sleep=async()=>{const start=performance.now();await new Promise(r=>setTimeout(r,delay));intervals.push([start,performance.now()]);};
const cloud={verifyPrivate:async()=>{await sleep();},read:async path=>{reads++;if(path.includes("/training_plans/"))planReads++;await sleep();const r=files.get(path);if(!r)return null;const start=performance.now();const result=JSON.parse(JSON.stringify(r));jsonMs+=performance.now()-start;return result;},list:async dir=>{lists++;await sleep();return [...new Set([...files.keys()].filter(p=>p.startsWith(dir+'/')).map(p=>p.slice(dir.length+1).split('/')[0]))].map(name=>({name,type:name.endsWith('.json')?'file':'dir',sha:files.get(dir+'/'+name)?.sha}));},write:async(path,data,sha)=>{if((files.get(path)?.sha??null)!==sha)throw Error('CAS');const next=(++serial).toString(16).padStart(40,'0');files.set(path,{data:structuredClone(data),sha:next});return next;},remove:async p=>files.delete(p)};
const store={get:async k=>sessions.get(k),put:async(k,v)=>sessions.set(k,v),delete:async k=>sessions.delete(k),list:async({prefix})=>new Map([...sessions].filter(([k])=>k.startsWith(prefix)))};
files.set('PGT/master_data/tecnics_base.json',{data:template,sha:'1'.repeat(40)});
const api=new AppApi(store,cloud,()=>new Date('2026-10-14T12:00:00Z'));
const update=api.updatePlanTexts.bind(api);api.updatePlanTexts=async(...args)=>{const start=performance.now();try{return await update(...args);}finally{planCheckMs+=performance.now()-start;}};
const call=async(path,token='',body)=>{const req=new Request('https://fixture'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return api.handle(req,new URL(req.url));};
delay=0;
await call('/api/app/register','',{mail:'coach@example.com',nombre:'Coach',apellidos:'',password:'synthetic-password',confirm:'synthetic-password'});
files.get('PGT/users_data/coach@example.com/user_data.json').data.perfil='entrenador';
const token=(await (await call('/api/app/login','',{mail:'coach@example.com',password:'synthetic-password'})).json()).token;
const t=cloneTemplate(template);for(const p of t.positions)for(const tech of p.tecnicas)tech.descripcion_del_alumno='Técnica extensa, control y ángulo. https://example.com/video '.repeat(130);
t.descriptionUpdates={[t.positions[0].tecnicas[0].id]:'already-applied'};
const mail='pupil@example.com',root='PGT/users_data/'+mail;
const notes={...initialVersion(),comments:[]};
files.set(root+'/user_data.json',{data:{...files.get('PGT/users_data/coach@example.com/user_data.json').data,mail,perfil:'alumno'},sha:'a'.repeat(40)});
files.set(root+'/tecnics.json',{data:t,sha:'b'.repeat(40)});files.set(root+'/trainer_comments.json',{data:notes,sha:'c'.repeat(40)});
const competitions=Array.from({length:20},()=>({planId:crypto.randomUUID(),alumnos:[mail],fecha_comienzo:'2026-10-01',fecha_torneo:'2026-12-13',dias_de_entrenamiento:[2,4],ejercicios_por_sesion:5,tiempo_por_tecnica_segundos:180,descanso_entre_ciclos_segundos:5,descanso_entre_tecnicas_segundos:20}));
files.set('PGT/master_data/plans.json',{data:{...initialVersion(),plans:competitions,deletedPlanIds:[]},sha:'d'.repeat(40)});
files.set(root+'/plans_index.json',{data:{...initialVersion(),planIds:competitions.map(c=>c.planId)},sha:'e'.repeat(40)});
for(const c of competitions){const plan=generatePlan(c,mail,t,notes,'2026-09-01T00:00:00Z');plan.appliedDescriptionUpdates=t.descriptionUpdates;files.set(root+'/training_plans/plan_'+c.planId+'.json',{data:plan,sha:crypto.randomUUID().replaceAll('-','').padEnd(40,'0')});}
const results=[];let known={};
for(const scenario of [{name:'first techniques',section:'techniques',ms:12},{name:'second techniques',section:'techniques',ms:12},{name:'first plans',section:'plans',ms:12},{name:'second plans',section:'plans',ms:12},{name:'first plan detail',section:'plans',planId:competitions[0].planId,ms:12},{name:'second plan detail',section:'plans',planId:competitions[0].planId,ms:12},{name:'slow techniques',section:'techniques',ms:40}]){
 delay=scenario.ms;reads=lists=planReads=jsonMs=planCheckMs=0;intervals=[];const start=performance.now();
 const path=!process.argv.includes('--legacy-snapshot')?`/api/app/users/${mail}/view?section=${scenario.section}&planId=${scenario.planId||""}&known=${encodeURIComponent(JSON.stringify(known))}`:`/api/app/users/${mail}/snapshot`;
 const response=await call(path,token);const bodyStart=performance.now(),body=await response.text(),data=JSON.parse(body);const responseJsonMs=performance.now()-bodyStart;
 if(!response.ok)throw Error(body);
 for(const [key,r] of Object.entries(data))if(r?.sha)known[key]=r.sha;
 for(const r of data.plans||[])known['plan:'+(r.planId||r.data?.planId)]=r.sha;
 const elapsed=performance.now()-start;let injectedIoMs=0,end=0;for(const [a,b] of intervals.sort((a,b)=>a[0]-b[0])){injectedIoMs+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);}
 results.push({scenario:scenario.name,ms:Math.round(elapsed),planCheckMs:Math.round(planCheckMs),workerOutsideInjectedIoMs:Math.round(elapsed-injectedIoMs-responseJsonMs),githubReads:reads,planReads,githubLists:lists,sourceJsonMs:Math.round(jsonMs),responseJsonMs:Math.round(responseJsonMs),bytes:new TextEncoder().encode(body).length});
}
if(!process.argv.includes("--legacy-snapshot")){if(results.find(r=>r.scenario==="first plans").planReads!==0||results.find(r=>r.scenario==="second plan detail").planReads!==0||results.find(r=>r.scenario==="second techniques").bytes>1000)throw Error("Performance regression: redundant downloads");}
await mkdir('.performance-artifacts',{recursive:true});const name=!process.argv.includes('--legacy-snapshot')?'after':'before';await writeFile(`.performance-artifacts/${name}.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
