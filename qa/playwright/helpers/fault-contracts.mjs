import {readFileSync} from 'node:fs';
export const source = path => readFileSync(path, 'utf8');
export const userPath = (u, kind='repertoire') => `users/${encodeURIComponent(u.profile.mail)}/${kind}`;
export const operation = (data, expected, extra={}) => ({data,expected,operationId:crypto.randomUUID(),...extra});
export async function uiSession(browser,a,user){
 const context=await browser.newContext({serviceWorkers:'allow'}),page=await context.newPage();
 page.on('dialog',d=>d.accept());await a.login(page,user.profile.mail);
 return {context,page,close:()=>context.close()};
}
export async function editor(page){const p=page.locator('details.repertoire-position').first();if(!await p.evaluate(e=>e.open))await p.locator('summary').click();return page.getByLabel('Descripci\u00f3n de t\u00e9cnica o enlace de v\u00eddeo').first();}
export async function realConflict(page,a,u,localText,remoteText){
 const input=await editor(page),base=await a.call(userPath(u),undefined,u.token),data=structuredClone(base.data);
 await input.fill(localText);data.positions[0].tecnicas[0].descripcion_del_alumno=remoteText;
 await a.call('commands/repertoire',operation(data,base.version),u.token);
 await page.getByRole('button',{name:'Reintentar guardado',exact:true}).waitFor();return input;
}
export async function cachedIdentitySummary(page){return page.evaluate(async()=>{
 const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('pgt-active-user-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
 const read=name=>new Promise((resolve,reject)=>{const request=db.transaction(name).objectStore(name).getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
 const entries=await read('entries'),views=await read('trainerViews');db.close();return{entryOwners:[...new Set(entries.map(e=>e.mail))],entryKeys:entries.map(e=>e.key),trainerViewOwners:[...new Set(views.map(e=>e.owner))],trainerViewCount:views.length};
 });}
export async function exportedCopy(page){
 await page.getByRole('button',{name:'Perfil',exact:true}).click();const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Exportar mi copia JSON',exact:true}).click();const stream=await(await pending).createReadStream(),parts=[];for await(const x of stream)parts.push(x);return JSON.parse(Buffer.concat(parts).toString());
}
export async function trainerComment(page,mail,text){
 await page.getByRole('button',{name:'Entrenador',exact:true}).click();const name=await page.evaluate(async mail=>{const i=JSON.parse(localStorage.getItem('pgt-session'));const x=await(await fetch('/api/v2/roster',{headers:{Authorization:'Bearer '+i.token}})).json();const p=x.data.users.find(p=>p.mail===mail);return[p.nombre,p.apellidos].filter(Boolean).join(' ');},mail);await page.locator('.student-card').filter({has:page.getByText(name,{exact:true})}).click();const position=page.locator('.student-detail details.repertoire-position').first();if(!await position.evaluate(e=>e.open))await position.locator('summary').click();await page.getByLabel('Comentario',{exact:true}).first().fill(text);return page.getByRole('button',{name:'Guardar comentario remoto',exact:true}).first();
}
export async function heldCommand(page,kind='repertoire'){
 let release,entered,payload;const gate=new Promise(resolve=>release=resolve),hit=new Promise(resolve=>entered=resolve);let held=false;
 await page.route('**/api/v2/commands/'+kind,async route=>{if(!held){held=true;payload=route.request().postDataJSON();entered();await gate;}await route.continue().catch(()=>{});});return{hit,release,payload:()=>payload};
}
export const protectedSessions = snapshot => snapshot.plans.map(p=>({id:p.data.planId,sessions:p.data.sessions.filter(s=>s.date<=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()))}));
export async function competitionCard(page,a,id){
 await page.getByRole('button',{name:'Entrenador',exact:true}).click();await page.getByRole('button',{name:'Competiciones',exact:true}).click();await page.getByRole('button',{name:'Listado',exact:true}).click();await page.getByLabel('Incluir competiciones pasadas',{exact:false}).check();const catalog=await a.call('catalog',undefined,a.trainer.token),plans=[...catalog.data.plans].sort((a,b)=>a.fecha_torneo.localeCompare(b.fecha_torneo)||a.planId.localeCompare(b.planId)),index=plans.findIndex(p=>p.planId===id);if(index<0)throw Error('QA competition not found');return page.locator('.competition-card').nth(index);
}
export async function publicState(a,u){return a.call(`users/${encodeURIComponent(u.profile.mail)}/snapshot`,undefined,u.token);}
export function safeState(s){return structuredClone(s);}
export async function competition(a,users,options={}){
 const date=n=>{const d=new Date();d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
 const catalog=await a.call('catalog',undefined,a.trainer.token);
 const result=await a.call('commands/competition',{competition:{fecha_comienzo:date(-3),fecha_torneo:date(options.days??12),alumnos:users.map(u=>u.profile.mail),dias_de_entrenamiento:[1,2,3,4,5,6,7],ejercicios_por_sesion:options.exercises??3,tiempo_por_tecnica_segundos:180,descanso_entre_ciclos_segundos:10,descanso_entre_tecnicas_segundos:20},expected:catalog.version,operationId:crypto.randomUUID()},a.trainer.token);
 return (await a.call('catalog',undefined,a.trainer.token)).data.plans.find(p=>p.planId===result.metadata?.planId)|| (await a.call('catalog',undefined,a.trainer.token)).data.plans.at(-1);
}
export function sizedTechniques(base,target){
 const data=structuredClone(base);data.positions=[];
 for(let i=0;i<45;i++)data.positions.push({id:crypto.randomUUID(),posicion:'Boundary '+i,prioridad:1,tecnicas:[{id:crypto.randomUUID(),tipo:'Technique '+i,descripcion_del_alumno:''}]});
 let remain=target-Buffer.byteLength(JSON.stringify(data));
 for(const p of data.positions){const n=Math.min(100000,remain);p.tecnicas[0].descripcion_del_alumno='x'.repeat(n);remain-=n;}
 if(remain!==0)throw Error('Cannot construct requested boundary');
 return data;
}
export function resizeTechniques(value,target,filler='x'){
 const data=structuredClone(value),tech=data.positions.flatMap(p=>p.tecnicas);for(const t of tech)t.descripcion_del_alumno='';
 let remain=target-Buffer.byteLength(JSON.stringify(data));
 for(const t of tech){const n=Math.min(100000,remain);if(n<0)throw Error('Target too small');t.descripcion_del_alumno=filler.repeat(n);remain-=n;}
 if(remain!==0)throw Error('Cannot resize requested boundary');return data;
}
export async function nearLimitCatalogue(a,user){
 let old=await a.call(userPath(user),undefined,user.token),seed=sizedTechniques(old.data,4100000);for(const p of seed.positions)if(!p.tecnicas[0].descripcion_del_alumno)p.tecnicas[0].descripcion_del_alumno='x';await a.call('commands/repertoire',operation(seed,old.version),user.token);old=await a.call(userPath(user),undefined,user.token);const warm=structuredClone(old.data);for(const p of warm.positions)p.tecnicas[0].descripcion_del_alumno='y'.repeat(p.tecnicas[0].descripcion_del_alumno.length);await a.call('commands/repertoire',operation(warm,old.version),user.token);old=await a.call(userPath(user),undefined,user.token);const near=resizeTechniques(old.data,4192304,'k');await a.call('commands/repertoire',operation(near,old.version),user.token);const record=await a.call(userPath(user),undefined,user.token),index=record.data.positions.findIndex(p=>{const n=p.tecnicas[0].descripcion_del_alumno.length;return n>5000&&n<95000;});if(index<0)throw Error('QA partial large text not found');return{record,index,text:record.data.positions[index].tecnicas[0].descripcion_del_alumno};
}
