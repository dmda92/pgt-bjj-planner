import {test} from '@playwright/test';
import assert from 'node:assert/strict';
import {caseTest,expect} from '../helpers/case-test.mjs';
import {getWorld} from '../helpers/remote-world.mjs';
import {createCompetition,competitionCard,selectStudent,awaitCommand,plan,datePlus} from '../helpers/remote-actions.mjs';
let w;
test.beforeAll(async()=>{w=await getWorld();await w.login('T');await w.login('A');});
test.afterAll(async()=>w?.close());

caseTest('COM 10',{environment:'DEV real Chromium; Firestore mediado por API autorizada',users:['T','A','B entrenador temporal'],adaptation:'Dos competiciones nuevas de esta campana; no se modifican repertorio ni comentarios del entrenador existente ni sus planes anteriores.'},async({},r)=>{
 r.includePrevious();
 const path=(role,kind)=>'users/'+encodeURIComponent(w.users[role].mail)+'/'+kind;
 const read=async(actor,role,kind)=>{const response=await w.api(actor,path(role,kind));expect(response.status).toBe(200);return response.data;};
 const setBRole=async role=>{
  const profile=await read('T','B','profile');if(profile.data.perfil===role)return;
  const p=await selectStudent(w,'B','Administración');await awaitCommand(p,'role',()=>p.getByLabel('Rol',{exact:true}).selectOption(role));
  await expect(p.getByLabel('Rol',{exact:true})).toHaveValue(role);w.users.B.role=role;w.persist();
 };
 const reloginB=async()=>{const page=await w.page('B');await page.goto(w.baseURL);const exit=page.getByRole('button',{name:'Salir',exact:true});if(await exit.count()){await exit.click();await page.getByLabel('Correo',{exact:true}).waitFor();}return w.login('B');};
 const sourceBefore={repertoire:await read('T','T','repertoire'),comments:await read('T','T','comments')};
 let createId,editId,baseline;
 try{
  await r.step('Crear torneo con T participante y añadir T a otro torneo por Guardar datos',async()=>{
   createId=await createCompetition(w,{start:datePlus(-3),end:datePlus(17),days:[1,2,3,4,5,6,7],roles:['T','A']});
   editId=await createCompetition(w,{start:datePlus(-3),end:datePlus(18),days:[1,2,3,4,5,6,7],roles:['A']});
   assert.ok(w.state.planIds.includes(createId)&&w.state.planIds.includes(editId));
   const {p,card}=await competitionCard(w,editId);await card.locator('[name=student][value="'+w.users.T.mail+'"]').check();await awaitCommand(p,'assignment',()=>card.getByRole('button',{name:'Guardar datos',exact:true}).click());
   baseline={};for(const id of[createId,editId]){baseline[id]=await plan(w,'T',id);expect(baseline[id].mail).toBe(w.users.T.mail);expect(baseline[id].sessions.length).toBeGreaterThan(0);}
   await r.capture(p,'trainer-included-at-edit');
  });
  await r.step('T consulta ambos planes propios completos y solo lectura',async()=>{
   const p=await w.login('T');await p.getByRole('button',{name:/^Mis planes/}).click();
   for(const id of[createId,editId]){
    await p.getByLabel('Mi plan',{exact:true}).selectOption(id);await expect(p.locator('.plan-card')).toBeVisible();await expect(p.locator('.plan-card details.session')).toHaveCount(baseline[id].sessions.length);
    expect(await p.locator('.plan-card input,.plan-card textarea,.plan-card [contenteditable=true]').count()).toBe(0);await expect(p.getByRole('button',{name:'Exportar PDF',exact:true})).toBeVisible();
   }await r.capture(p,'trainer-own-plan-readonly');
  });
  await r.step('B entrenador temporal consulta ficha y compara profundamente ambos planes de T',async()=>{
   await setBRole('entrenador');const p=await reloginB();await p.getByRole('button',{name:'Entrenador',exact:true}).click();await p.getByRole('button',{name:'Equipo',exact:true}).click();
   await p.getByLabel('Buscar alumnos',{exact:false}).fill(w.users.T.mail);const cards=p.locator('.student-card');await expect(cards).toHaveCount(1);await cards.click();await expect(p.locator('.student-detail')).toContainText(w.users.T.mail);
   await p.locator('.student-sections').getByRole('button',{name:'Planes',exact:true}).click();
   for(const id of[createId,editId]){
    const fromB=await read('B','T','plans/'+id);assert.deepEqual(fromB.data,baseline[id]);
    await p.getByLabel('Plan del alumno',{exact:true}).selectOption(id);const rows=p.locator('.plan-card details.session');await expect(rows).toHaveCount(baseline[id].sessions.length);
    expect(await p.locator('.plan-card input,.plan-card textarea,.plan-card [contenteditable=true]').count()).toBe(0);
    for(let n=0;n<baseline[id].sessions.length;n++){
     const row=rows.nth(n),session=baseline[id].sessions[n];if(!await row.evaluate(e=>e.open))await row.locator('summary').click();await expect(row.locator('.exercise')).toHaveCount(session.exercises.length);
     for(let j=0;j<session.exercises.length;j++){const card=row.locator('.exercise').nth(j),exercise=session.exercises[j];await expect(card).toContainText(exercise.tipo);await expect(card).toContainText(exercise.posicion);await expect(card.locator('.plan-description')).toHaveText(exercise.descripcion_del_alumno);if(exercise.comment)await expect(card.locator('.note')).toContainText(exercise.comment);}
    }
   }await r.capture(p,'second-trainer-full-plan-readonly');
  });
  const unchanged={repertoire:await read('T','T','repertoire'),comments:await read('T','T','comments')};assert.deepEqual(unchanged,sourceBefore);
  for(const id of[createId,editId])assert.deepEqual(await plan(w,'T',id),baseline[id]);
  await r.json('trainer-participant-dev-integrity',{createId,editId,baseline,sourceUnchanged:true,secondTrainerDeepComparison:true,scope:'No se han editado fuentes T ni consultado/modificado planes ajenos a esta campana.'});
  r.finish('APROBADO','T incluido al crear y al editar participantes de dos torneos propios nuevos. Recibe y consulta ambos planes de solo lectura. B entrenador temporal consulta ficha T; respuestas completas y todas las sesiones/ejercicios visibles coinciden con instantaneas T por UUID, texto y estructura. Consulta conserva literalmente planes y fuentes T.','Firestore comprobado mediante API autorizada, no lectura independiente Google. No se modifican textos T para evitar propagacion sobre sus planes anteriores; la propagacion por UUID e historico con entrenador participante se verifica separadamente en el suplemento local nuevo de esta campana.');
 }finally{
  await setBRole('alumno');await reloginB();const restored=await read('T','B','profile');expect(restored.data.perfil).toBe('alumno');await r.json('temporary-trainer-restored',{mail:w.users.B.mail,role:restored.data.perfil});
 }
});
