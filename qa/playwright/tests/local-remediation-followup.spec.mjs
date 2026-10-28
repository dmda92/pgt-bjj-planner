import assert from 'node:assert/strict';
import {caseTest, expect} from '../helpers/case-test.mjs';
import {createLocalAcademy} from '../helpers/local-academy.mjs';
import {competition, operation, userPath, competitionCard} from '../helpers/fault-contracts.mjs';

const local = {environment:'Chromium PWA + Worker/SQLite local + Firestore sintetico',adaptation:'Nueva ejecucion aislada del protocolo. No llamadas Google ni evidencia heredada de otra campana.'};
async function team(page,a){await a.login(page,a.trainer.profile.mail);await page.getByRole('button',{name:'Entrenador',exact:true}).click();await page.getByRole('button',{name:'Equipo',exact:true}).click();}
async function select(page,u){await page.locator('.student-card').filter({hasText:u.profile.nombre+' '+u.profile.apellidos}).click();await expect(page.locator('.student-detail')).toContainText(u.profile.mail);}
async function comment(page){const card=page.locator('.student-detail details.repertoire-position').first();if(!await card.evaluate(e=>e.open))await card.locator('summary').click();const box=page.getByLabel('Comentario',{exact:true}).first();return{box,save:box.locator('..').getByRole('button',{name:'Guardar comentario remoto',exact:true})};}

caseTest('ENT 06',local,async({browser},r)=>{
 const a=await createLocalAcademy(),context=await browser.newContext(),page=await context.newPage();let release=()=>{};
 try{
  const u=await a.register('ent06-followup-a'),v=await a.register('ent06-followup-b');r.result.users=[a.trainer.profile.mail,u.profile.mail,v.profile.mail];
  const beforeA=await a.call(userPath(u,'snapshot'),undefined,u.token),beforeB=await a.call(userPath(v,'snapshot'),undefined,v.token);
  await team(page,a);await select(page,u);let c=await comment(page);const text='ENT06 retained after network failure '+crypto.randomUUID();
  await r.step('Retener guardado fallido, comprobar feedback y conservar texto para reintento',async()=>{
   let entered;const hit=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
   await page.route('**/api/v2/commands/comments',async route=>{entered();await gate;await route.fulfill({status:503,contentType:'application/json',body:'{"error":"QA_NETWORK_FAILURE"}'});},{times:1});
   await c.box.fill(text);const response=page.waitForResponse(x=>x.url().endsWith('/commands/comments'));await c.save.click();await hit;
   await expect(c.save).toBeDisabled();await expect(c.box.locator('..').locator('.hint')).toContainText('Borrador de comentario');await expect(c.box).toHaveValue(text);await r.capture(page,'held-comment-no-success');
   release();assert.equal((await response).status(),503);await expect(c.save).toBeEnabled();await expect(c.box).toHaveValue(text);
   assert.deepEqual(await a.call(userPath(u,'snapshot'),undefined,u.token),beforeA);await r.capture(page,'failed-comment-retained');
   await select(page,v);await select(page,u);c=await comment(page);await expect(c.box).toHaveValue(text);
  });
  const corrected=text+' corrected';
  await r.step('Corregir y reintentar, cambiar a B y entregar respuesta tardia de A sin contaminar seleccion',async()=>{
   await c.box.fill(corrected);let entered;const hit=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
   await page.route('**/api/v2/commands/comments',async route=>{const response=await route.fetch();entered();await gate;await route.fulfill({response});},{times:1});
   const response=page.waitForResponse(x=>x.url().endsWith('/commands/comments'));await c.save.click();await hit;await select(page,v);
   release();assert.equal((await response).status(),200);await expect(page.getByRole('status',{name:'Guardando comentario',exact:true})).toHaveCount(0);
   await expect(page.locator('.student-detail')).toContainText(v.profile.mail);await expect(page.locator('.student-detail')).not.toContainText(u.profile.mail);
   assert.deepEqual(await a.call(userPath(v,'snapshot'),undefined,v.token),beforeB);await r.capture(page,'late-a-response-keeps-b-selected');
   await select(page,u);c=await comment(page);await expect(c.box).toHaveValue(corrected);
   const after=await a.call(userPath(u,'snapshot'),undefined,u.token);assert.ok(after.comments.data.comments.some(n=>n.comment===corrected));
   assert.deepEqual(after.techniques,beforeA.techniques);assert.deepEqual(after.plans,beforeA.plans);await r.json('comment-integrity',{beforeA,after,beforeB,bUnchanged:true});
  });
  r.finish('APROBADO','Respuesta retenida mantiene borrador visible y bloquea doble envio, fallo503 conserva texto y permite reintentar; cambiar A/B conserva borrador. Texto corregido persiste solo en comentarios de A y ACK tardio conserva B seleccionado. Reabrir A muestra comentario confirmado; snapshot completo B y tecnicas/planes A intactos.','Fallo HTTP inyectado en Chromium y persistencia sintetica local. No prueba Google remoto.');
 }finally{release();await context.close().catch(()=>{});await a.close();}
});

caseTest('REN 02',local,async({browser},r)=>{
 const a=await createLocalAcademy({manualMaintenance:true}),context=await browser.newContext(),page=await context.newPage();let release=()=>{};
 try{
  const u=await a.register('ren02-volume'),v=await a.register('ren02-control');r.result.users=[a.trainer.profile.mail,u.profile.mail,v.profile.mail];
  const base=await a.call(userPath(u),undefined,u.token),positions=Array.from({length:12},(_,i)=>({id:crypto.randomUUID(),posicion:'Volume position '+i,prioridad:1+i%4,tecnicas:Array.from({length:8},(_,j)=>({id:crypto.randomUUID(),tipo:'Volume technique '+i+'-'+j,descripcion_del_alumno:('Long description '+i+'-'+j+' ').repeat(300)}))}));
  await a.call('commands/repertoire',operation({...base.data,positions},base.version),u.token);
  for(let n=0;n<12;n++)await competition(a,[u],{days:14+n,exercises:4});
  const before=await a.call(userPath(u,'snapshot'),undefined,u.token),beforeB=await a.call(userPath(v,'snapshot'),undefined,v.token);
  assert.equal(before.plans.length,12);await team(page,a);const maintenanceBefore=a.f.metrics();await a.drainMaintenance();const maintenanceAfter=a.f.metrics(),costBefore=a.f.metrics();
  const requests=[],responses=[];page.on('request',req=>{if(req.url().includes('/api/v2/'))requests.push({path:new URL(req.url()).pathname,method:req.method(),at:Date.now()});});
  page.on('response',res=>{if(res.url().includes('/users/'+encodeURIComponent(u.profile.mail)+'/'))responses.push(res);});
  const sectionCounts=[];const mark=name=>sectionCounts.push({section:name,requests:structuredClone(requests),metrics:a.f.metrics()});
  await r.step('Con 96 tecnicas largas y 12 planes comprobar peticiones paralelas al entrar en Tecnicas',async()=>{
   let entered;const hit=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
   await page.route('**/api/v2/users/'+encodeURIComponent(u.profile.mail)+'/profile',async route=>{entered();await gate;await route.continue();},{times:1});
   await page.locator('.student-card').filter({hasText:u.profile.nombre+' '+u.profile.apellidos}).click();await hit;
   await expect.poll(()=>['repertoire','comments'].every(kind=>requests.some(req=>req.path.endsWith('/'+kind))),{timeout:5000}).toBe(true);
   for(const kind of ['profile','repertoire','comments'])assert.equal(requests.filter(req=>req.path.endsWith('/'+kind)).length,1);
   await r.json('parallel-before-profile-completes',requests);release();await expect(page.locator('.student-detail')).toContainText(u.profile.mail);
   await expect(page.locator('.student-detail .repertoire-progress')).toBeVisible();assert.equal(requests.filter(req=>/\/plans\/[^/]+$/.test(req.path)).length,0);mark('techniques');
  });
  await r.step('Abrir Administracion y lista Planes sin descargar detalles; seleccionar y reutilizar un solo plan',async()=>{
   const sections=page.locator('.student-sections');await sections.getByRole('button',{name:'Administración',exact:true}).click();await expect(page.getByLabel('Rol',{exact:true})).toBeVisible();mark('administration');
   await sections.getByRole('button',{name:'Planes',exact:true}).click();const selector=page.getByLabel('Plan del alumno',{exact:true});await selector.waitFor();assert.equal(await selector.locator('option').count(),13);
   assert.equal(requests.filter(req=>/\/plans\/[^/]+$/.test(req.path)).length,0);mark('plan-list');
   const id=before.plans[0].data.planId;await selector.selectOption(id);await expect(page.locator('.plan-card')).toBeVisible();
   assert.equal(requests.filter(req=>/\/plans\/[^/]+$/.test(req.path)).length,1);assert.ok(requests.find(req=>/\/plans\/[^/]+$/.test(req.path)).path.endsWith('/'+id));mark('selected-plan');
   await sections.getByRole('button',{name:'Técnicas',exact:true}).click();await expect(page.locator('.student-detail .repertoire-progress')).toBeVisible();
   await sections.getByRole('button',{name:'Planes',exact:true}).click();await selector.selectOption(id);await expect(page.locator('.plan-card')).toBeVisible();mark('revisited-selected-plan');
   assert.equal(requests.filter(req=>/\/plans\/[^/]+$/.test(req.path)).length,1);
  });
  await a.drainMaintenance();const costAfter=a.f.metrics();assert.equal(costAfter.estimatedReads-costBefore.estimatedReads,0);assert.equal(costAfter.attemptedWrites-costBefore.attemptedWrites,0);assert.equal(costAfter.attemptedDeletes-costBefore.attemptedDeletes,0);
  assert.equal(requests.filter(req=>req.method!=='GET').length,0);assert.deepEqual(await a.call(userPath(u,'snapshot'),undefined,u.token),before);assert.deepEqual(await a.call(userPath(v,'snapshot'),undefined,v.token),beforeB);
  const downloads=[];for(const response of responses){await response.finished();downloads.push({path:new URL(response.url()).pathname,status:response.status(),bytes:(await response.body()).length});}
  await r.json('volume-navigation-budget',{techniques:96,descriptionCharacters:positions.flatMap(p=>p.tecnicas).reduce((n,t)=>n+t.descripcion_del_alumno.length,0),plans:12,sectionCounts,downloads,setupMaintenance:{before:maintenanceBefore,after:maintenanceAfter},navigationCost:{before:costBefore,after:costAfter},snapshotsUnchanged:true});await r.capture(page,'selected-plan-volume');
  r.finish('APROBADO','96 tecnicas con descripciones largas y 12 planes: perfil retenido no impide iniciar repertorio/comentarios. Tecnicas/Administracion/lista no descargan detalle; elegir descarga solo uno, volver reutiliza sin otra descarga. Llamadas/bytes por seccion registrados; navegacion caliente 0 lecturas/escrituras/borrados sinteticos, sin comandos ni cambios profundos A/B.','Medicion real Chromium/Worker local con transporte Firestore sintetico. Mantenimiento de creacion medido por separado; 0 lecturas corresponde cache caliente, no promesa de coste frio ni medicion Google.');
 }finally{release();await context.close().catch(()=>{});await a.close();}
});

caseTest('COM 10',local,async({browser},r)=>{
 r.includePrevious();
 const a=await createLocalAcademy(),context=await browser.newContext(),context2=await browser.newContext(),page=await context.newPage(),coach=await context2.newPage();
 try{
  const t=a.trainer,u=await a.register('com10-pupil'),v=await a.register('com10-other-coach');
  const profile=await a.call(userPath(v,'profile'),undefined,t.token);await a.call('commands/role',{mail:v.profile.mail,perfil:'entrenador',expected:profile.version,operationId:crypto.randomUUID()},t.token);
  const t2=await a.call('auth/login',{mail:v.profile.mail,password:a.password});r.result.users=[t.profile.mail,u.profile.mail,v.profile.mail];
  const beforeU=await a.call(userPath(u,'snapshot'),undefined,u.token),beforeV=await a.call(userPath(v,'snapshot'),undefined,t2.token);
  await team(page,a);
  const date=n=>{const d=new Date();d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
  const create=async(mails,days)=>{
   await page.getByRole('button',{name:'Competiciones',exact:true}).click();await page.getByRole('button',{name:'Nueva competición',exact:true}).click();const form=page.locator('.competition-create');
   await form.getByLabel('Fecha inicial',{exact:true}).fill(date(-3));await form.getByLabel('Fecha del torneo',{exact:true}).fill(date(days));
   for(let day=1;day<=7;day++)await form.locator('[name=day][value="'+day+'"]').check();
   for(const mail of mails)await form.locator('[name=student][value="'+mail+'"]').check();
   const response=page.waitForResponse(r=>r.url().endsWith('/commands/competition'));await form.getByRole('button',{name:'Crear competición',exact:true}).click();assert.equal((await response).status(),200);const result=await(await response).json();await expect(form).toHaveCount(0);return result.metadata.planId;
  };
  let createId,editId;
  await r.step('Incluir T desde formulario de alta y añadir T desde edicion de participantes',async()=>{
   createId=await create([t.profile.mail],12);editId=await create([u.profile.mail],13);
   const created=(await a.call(userPath(t,'plans/'+createId),undefined,t.token)).data;
   const card=await competitionCard(page,a,editId);await card.locator('[name=student][value="'+t.profile.mail+'"]').check();
   const response=page.waitForResponse(r=>r.url().endsWith('/commands/assignment'));await card.getByRole('button',{name:'Guardar datos',exact:true}).click();assert.equal((await response).status(),200);
   const edited=(await a.call(userPath(t,'plans/'+editId),undefined,t.token)).data;assert.equal(created.mail,t.profile.mail);assert.equal(edited.mail,t.profile.mail);await r.capture(page,'trainer-added-on-edit');
  });
  const baseline=await a.call(userPath(t,'snapshot'),undefined,t.token),target=baseline.techniques.data.positions[0].tecnicas[0].id;
  const protectedPart=p=>p.sessions.filter(s=>s.date<=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
  await r.step('T edita descripcion propia; otro entrenador abre su ficha y guarda comentario',async()=>{
   await page.getByRole('button',{name:'Mis técnicas',exact:true}).click();const position=page.locator('details.repertoire-position').first();await position.locator('summary').click();
   const response=page.waitForResponse(r=>r.url().endsWith('/commands/repertoire'));await page.locator('#technique-'+target).getByLabel('Descripción de técnica o enlace de vídeo').fill('COM10 own trainer description');assert.equal((await response).status(),200);
   await a.login(coach,v.profile.mail);await coach.getByRole('button',{name:'Entrenador',exact:true}).click();await coach.getByRole('button',{name:'Equipo',exact:true}).click();await select(coach,t);
   const c=await comment(coach);await expect(coach.locator('.student-detail textarea[readonly]').first()).toBeVisible();await c.box.fill('COM10 other trainer comment');
   const saved=coach.waitForResponse(r=>r.url().endsWith('/commands/comments'));await c.save.click();assert.equal((await saved).status(),200);await r.capture(coach,'other-trainer-comments-competitor');
  });
  const after=await a.call(userPath(t,'snapshot'),undefined,t.token);
  for(const id of[createId,editId]){
   const original=baseline.plans.find(p=>p.data.planId===id).data,actual=after.plans.find(p=>p.data.planId===id).data;assert.deepEqual(protectedPart(actual),protectedPart(original));
   const {madridDate}=await import('../../../src/domain/plan-text-updates.ts');const affected=actual.sessions.filter(s=>s.date>madridDate()).flatMap(s=>s.exercises).filter(e=>e.techniqueId===target);assert.ok(affected.length>0,'Fixture must exercise future occurrences of the edited UUID');for(const e of affected){assert.equal(e.descripcion_del_alumno,'COM10 own trainer description');assert.equal(e.comment,'COM10 other trainer comment');}
   const distribution=p=>p.sessions.map(s=>({date:s.date,exercises:s.exercises.map(({descripcion_del_alumno,comment,...e})=>e)}));assert.deepEqual(distribution(actual),distribution(original));
  }
  await r.step('Consultar ambos planes propios de T en solo lectura y ficha de T desde otro entrenador',async()=>{
   await page.getByRole('button',{name:/^Mis planes/}).click();for(const id of[createId,editId]){await page.getByLabel('Mi plan',{exact:true}).selectOption(id);await expect(page.locator('.plan-card')).toBeVisible();assert.equal(await page.locator('.plan-card input,.plan-card textarea,.plan-card [contenteditable=true]').count(),0);await expect(page.getByRole('button',{name:'Exportar PDF',exact:true})).toBeVisible();}
   await coach.locator('.student-sections').getByRole('button',{name:'Planes',exact:true}).click();await coach.getByLabel('Plan del alumno',{exact:true}).selectOption(editId);await expect(coach.locator('.plan-card')).toBeVisible();assert.equal(await coach.locator('.plan-card input,.plan-card textarea,.plan-card [contenteditable=true]').count(),0);await r.capture(coach,'trainer-participant-plan-readonly');
  });
  const afterU=await a.call(userPath(u,'snapshot'),undefined,u.token);assert.deepEqual(afterU.techniques,beforeU.techniques);assert.deepEqual(afterU.comments,beforeU.comments);assert.deepEqual(await a.call(userPath(v,'snapshot'),undefined,t2.token),beforeV);
  await r.json('trainer-participant-integrity',{baseline,after,createId,editId,otherCoachUnchanged:true,pupilSourcesUnchanged:true});
  r.finish('APROBADO','T incluido por UI al crear competicion y al editar otra inicialmente de alumno. Recibe dos planes propios; segundo entrenador consulta su ficha y comenta. Descripcion propia y comentario se propagan por UUID solo a futuro; historico profundo/distribucion intactos. Ambos planes propios y vista de segundo entrenador sin controles de editar sesiones. Fuentes alumno y snapshot segundo entrenador intactos.','Chromium/Worker reales locales y Firestore sintetico. Sin afirmar DEV Google ni heredar aprobaciones de campanas anteriores.');
 }finally{await context.close();await context2.close();await a.close();}
});
