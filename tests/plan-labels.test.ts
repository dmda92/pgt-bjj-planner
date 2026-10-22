import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generatePlan} from '../src/domain/planner.ts';
import {initialVersion,type Techniques} from '../src/domain/models.ts';
import {updateFuturePlanLabels} from '../src/domain/plan-labels.ts';
function fixture(){
 const t:Techniques={...initialVersion(),positions:[{id:crypto.randomUUID(),posicion:'Nueva posición',prioridad:1,tecnicas:[{id:crypto.randomUUID(),tipo:'Nueva técnica',descripcion_del_alumno:'Description'}]}]};
 const plan=generatePlan({planId:crypto.randomUUID(),alumnos:['labels@example.test'],fecha_comienzo:'2026-10-01',fecha_torneo:'2026-10-08',dias_de_entrenamiento:[1,2,3,4,5,6,7],ejercicios_por_sesion:2,tiempo_por_tecnica_segundos:180,descanso_entre_ciclos_segundos:10,descanso_entre_tecnicas_segundos:20},'labels@example.test',t,{...initialVersion(),comments:[{techniqueId:t.positions[0].tecnicas[0].id,comment:'Trainer'}]},'2026-09-01T00:00:00Z');
 return {t,plan};
}
test('Creation placeholder renamed to Otra mas refreshes every future occurrence by UUID, keeping today/past and all scheduling fields exact',()=>{
 const {t,plan}=fixture(),before=structuredClone(plan);t.positions[0].tecnicas[0].tipo='Otra mas';
 const result=updateFuturePlanLabels(plan,t,'2026-10-03');
 assert.deepEqual(result.sessions.filter(s=>s.date<='2026-10-03'),plan.sessions.filter(s=>s.date<='2026-10-03'));
 assert.ok(result.sessions.filter(s=>s.date>'2026-10-03').every(s=>s.exercises.every(e=>e.tipo==='Otra mas')));
 const restored={...result,sessions:result.sessions.map(s=>({...s,exercises:s.exercises.map(e=>({...e,tipo:'Nueva técnica'}))}))};
 assert.deepEqual(restored,plan);assert.deepEqual(plan,before);assert.equal(result.continuity,plan.continuity);assert.equal(updateFuturePlanLabels(result,t,'2026-10-03'),result);
});
test('Positions renamed after creation refresh future display names without changing priority or the movement cursor',()=>{
 const {t,plan}=fixture();t.positions[0].posicion='Guardia propia';
 const result=updateFuturePlanLabels(plan,t,'2026-10-03');
 assert.ok(result.sessions.filter(s=>s.date>'2026-10-03').every(s=>s.exercises.every(e=>e.posicion==='Guardia propia'&&e.prioridad===1)));
 assert.equal(result.continuity,plan.continuity);assert.deepEqual(result.sessions.slice(0,3),plan.sessions.slice(0,3));
});
test('No-op, ended competition, structural block, removed UUID and another position never rewrite the plan',()=>{
 const {t,plan}=fixture();assert.equal(updateFuturePlanLabels(plan,t,'2026-10-03'),plan);t.positions[0].tecnicas[0].tipo='Otra mas';
 assert.equal(updateFuturePlanLabels(plan,t,plan.fecha_torneo),plan);
 const blocked={...plan,structuralUpdateError:'Invalid cursor'};assert.equal(updateFuturePlanLabels(blocked,t,'2026-10-03'),blocked);
 t.positions[0].id=crypto.randomUUID();assert.equal(updateFuturePlanLabels(plan,t,'2026-10-03'),plan);
 t.positions=[];assert.equal(updateFuturePlanLabels(plan,t,'2026-10-03'),plan);
});
