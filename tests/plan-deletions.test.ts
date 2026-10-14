import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generatePlan, priorityCycle, tabata} from '../src/domain/planner.ts';
import {catalogOf, initialCursor, nextExercise, deletedUUIDs, updateFutureDeletions} from '../src/domain/plan-continuity.ts';
import {updateFuturePlanText} from '../src/domain/plan-text-updates.ts';
import {initialVersion, type Techniques, type TrainingPlan} from '../src/domain/models.ts';
function sample() {
  const t:Techniques={...initialVersion(),positions:[1,2,3].flatMap(priority=>[0,1].map(n=>({id:crypto.randomUUID(),posicion:`P${priority}-${n}`,prioridad:priority,tecnicas:[0,1,2].map(i=>({id:crypto.randomUUID(),tipo:`T${i}`,descripcion_del_alumno:`Texto ${priority}-${n}-${i}`}))})))};
  const notes={...initialVersion(),comments:[]};
  const p=generatePlan({planId:crypto.randomUUID(),alumnos:['a@example.com'],fecha_comienzo:'2026-10-01',fecha_torneo:'2026-12-30',dias_de_entrenamiento:[1,2,3,4,5,6,7],ejercicios_por_sesion:2,tiempo_por_tecnica_segundos:180,descanso_entre_ciclos_segundos:5,descanso_entre_tecnicas_segundos:20},'a@example.com',t,notes,'2026-09-01T00:00:00Z');
  return {t,notes,p};
}
function deletion(t:Techniques, change:(t:Techniques)=>void) {
  const next=structuredClone(t);change(next);next.deletedIds=deletedUUIDs(t,next);return next;
}
function future(p:TrainingPlan,today:string){return p.sessions.filter(s=>s.date>today).flatMap(s=>s.exercises);}
function invariants(p:TrainingPlan,n:TrainingPlan,today:string){
  assert.equal(n.structuralUpdateError,undefined);
  assert.deepEqual(n.sessions.filter(s=>s.date<=today),p.sessions.filter(s=>s.date<=today));
  assert.deepEqual(n.sessions.map(s=>s.date),p.sessions.map(s=>s.date));
  assert.ok(n.sessions.every(s=>s.exercises.length===p.ejercicios_por_sesion));
  assert.deepEqual(tabata(n),tabata(p));
}
test('New cursor engine preserves the original circular generator including nonconsecutive and single priorities',()=>{
  for(const priorities of [[1],[1,4],[2,7,11],[1,3,5,9]]){
    const {t,notes}=sample();t.positions=t.positions.slice(0,priorities.length);t.positions.forEach((p,i)=>{p.prioridad=priorities[i];p.tecnicas=p.tecnicas.slice(0,1);});

    const catalog=catalogOf(t),cursor=initialCursor(catalog),cycle=priorityCycle(priorities);
    for(let i=0;i<40;i++) assert.equal(nextExercise(cursor,catalog,t,notes).prioridad,cycle.next().value);
  }
});
for(const [name,change] of [
  ['pending technique', (t:Techniques)=>t.positions[0].tecnicas.splice(2,1)],
  ['historically trained technique', (t:Techniques)=>t.positions[0].tecnicas.splice(0,1)],
  ['partially trained position', (t:Techniques)=>t.positions.splice(0,1)],
  ['completely trained position', (t:Techniques)=>t.positions.splice(0,1)],
] as const) test(`Deletion of ${name} preserves history and follows the original pending stream without artificial repeats`,()=>{
  const {t,p,notes}=sample(),today=name==='completely trained position'?'2026-10-02':'2026-10-01';
  const next=deletion(t,change),updated=updateFutureDeletions(p,next,notes,today);invariants(p,updated,today);
  const removed=new Set(next.deletedIds);
  assert.ok(future(updated,today).every(e=>!removed.has(e.positionId)&&!removed.has(e.techniqueId)));
  const expected=future(p,today).filter(e=>!removed.has(e.positionId)&&!removed.has(e.techniqueId));
  assert.deepEqual(future(updated,today).slice(0,expected.length).map(e=>[e.techniqueId,e.prioridad,e.pass]),expected.map(e=>[e.techniqueId,e.prioridad,e.pass]));
  assert.equal(updateFutureDeletions(updated,next,notes,today),updated);
  assert.deepEqual(updateFutureDeletions(p,next,notes,today),updated);
});
test('Partially trained position continues at next surviving technique; deleting its last pending technique advances position',()=>{
  const {t,p,notes}=sample();
  const next=deletion(t,t=>t.positions[0].tecnicas.splice(2,1));
  const n=updateFutureDeletions(p,next,notes,'2026-10-01');
  assert.equal(future(n,'2026-10-01')[0].techniqueId,t.positions[1].tecnicas[0].id);
  const later=deletion(t,t=>t.positions[0].tecnicas.splice(1,1));
  const plan=structuredClone(p);plan.ejercicios_por_sesion=1;
  // Use a genuine one-exercise boundary, rather than forging saved cursor state.
  const one=generatePlan(plan,plan.mail,t,notes,plan.generatedAt);
  assert.equal(future(updateFutureDeletions(one,later,notes,'2026-10-01'),'2026-10-01')[0].techniqueId,t.positions[0].tecnicas[2].id);
});
test('Deleting entire current priority keeps movement phase; surviving ring continues without resetting to P1',()=>{
  const {t,p,notes}=sample();
  const next=deletion(t,t=>{t.positions=t.positions.filter(p=>p.prioridad!==1);});
  const n=updateFutureDeletions(p,next,notes,'2026-10-01');invariants(p,n,'2026-10-01');
  const stream=future(n,'2026-10-01');
  assert.deepEqual([stream[0].prioridad,stream[6].prioridad,stream[12].prioridad,stream[18].prioridad],[2,3,3,2]);
  assert.ok(stream.every(e=>e.prioridad!==1));
});
test('Removing an upcoming priority and all but one priority preserves exact session counts',()=>{
  for(const keep of [[1,3],[2]]){
    const {t,p,notes}=sample(),next=deletion(t,t=>{t.positions=t.positions.filter(p=>keep.includes(p.prioridad));});
    const n=updateFutureDeletions(p,next,notes,'2026-10-01');invariants(p,n,'2026-10-01');
    assert.ok(future(n,'2026-10-01').every(e=>keep.includes(e.prioridad)));
  }
});
test('No trainable techniques blocks update, retains complete previous sessions and retries idempotently',()=>{
  const {t,p,notes}=sample(),next=deletion(t,t=>{t.positions=[];});
  const n=updateFutureDeletions(p,next,notes,'2026-10-01');
  assert.match(n.structuralUpdateError!,/No quedan técnicas/);assert.deepEqual(n.sessions,p.sessions);
  assert.equal(updateFutureDeletions(n,next,notes,'2026-10-01'),n);
  const recovered=updateFutureDeletions(n,{...t,deletedIds:next.deletedIds},notes,'2026-10-01');
  invariants(p,recovered,'2026-10-01');
});
test('Today and ended competitions are completely protected, and deletions apply independently to every active plan',()=>{
  const {t,p,notes}=sample(),next=deletion(t,t=>t.positions.splice(0,1));
  assert.equal(updateFutureDeletions(p,next,notes,p.fecha_torneo),p);
  assert.equal(updateFutureDeletions(p,next,notes,'2027-01-01'),p);
  for(const id of [crypto.randomUUID(),crypto.randomUUID()]){const n=updateFutureDeletions({...p,planId:id},next,notes,'2026-10-01');invariants(p,n,'2026-10-01');assert.equal(n.planId,id);}
});
test('Legacy complete generated plans reconstruct cursor; ambiguous or modified plans remain intact with recoverable error',()=>{
  const {t,p,notes}=sample(),next=deletion(t,t=>t.positions.splice(0,1));delete p.continuity;
  invariants(p,updateFutureDeletions(p,next,notes,'2026-10-01'),'2026-10-01');
  const bad=structuredClone(p);bad.sessions[0].exercises.reverse();
  const blocked=updateFutureDeletions(bad,next,notes,'2026-10-01');assert.ok(blocked.structuralUpdateError);assert.deepEqual(blocked.sessions,bad.sessions);
  const short={...p,sessions:p.sessions.slice(0,3)};
  const n=updateFutureDeletions(short,next,notes,'2026-10-01');assert.match(n.structuralUpdateError!,/antiguo/);assert.deepEqual(n.sessions,short.sessions);
});
test('Subsequent offline deletions continue from newly protected boundary, not original plan start',()=>{
  const {t,p,notes}=sample();let next=deletion(t,t=>t.positions[0].tecnicas.splice(2,1));
  const first=updateFutureDeletions(p,next,notes,'2026-10-01');
  const second=deletion(next,t=>t.positions.splice(0,1));second.deletedIds=[...new Set([...next.deletedIds!,...second.deletedIds!])];
  const updated=updateFutureDeletions(first,second,notes,'2026-10-04');invariants(first,updated,'2026-10-04');
  assert.ok(future(updated,'2026-10-04').every(e=>e.positionId!==t.positions[0].id));
  assert.equal(updateFutureDeletions(updated,second,notes,'2026-10-04'),updated);
});

 test('A corrupted saved movement phase is rejected instead of changing history or silently restarting',()=>{
  const {t,p,notes}=sample(),next=deletion(t,t=>t.positions.splice(0,1));
  p.continuity!.boundaries[0].cursor.move='forward';
  const result=updateFutureDeletions(p,next,notes,'2026-10-01');
  assert.ok(result.structuralUpdateError);assert.deepEqual(result.sessions,p.sessions);
 });
 test('A deletion absent from every future session records its checkpoint without regenerating any exercises',()=>{
  const {t,p,notes}=sample();p.sessions=p.sessions.slice(0,2);p.continuity!.boundaries=p.continuity!.boundaries.slice(0,2);
  const next=deletion(t,t=>t.positions.pop());
  const result=updateFutureDeletions(p,next,notes,'2026-10-01');
  assert.deepEqual(result.sessions,p.sessions);assert.equal(updateFutureDeletions(result,next,notes,'2026-10-01'),result);
 });

 test('A blocked structural update also preserves future texts until its distribution can be repaired',()=>{
  const {t,p,notes}=sample();const blocked={...p,structuralUpdateError:'Requiere revisión'};
  const id=t.positions[0].tecnicas[0].id;t.descriptionUpdates={[id]:'changed'};t.positions[0].tecnicas[0].descripcion_del_alumno='Nuevo';
  assert.equal(updateFuturePlanText(blocked,t,notes,'2026-10-01'),blocked);
 });

 test('A short legacy plan can recover reliably from the pre-deletion catalogue only when its entire schedule matches',()=>{
  const {t,p,notes}=sample();delete p.continuity;p.sessions=p.sessions.slice(0,3);
  const next=deletion(t,t=>t.positions.splice(0,1));next.deletionCatalog=catalogOf(t);
  invariants(p,updateFutureDeletions(p,next,notes,'2026-10-01'),'2026-10-01');
  p.sessions[1].exercises.reverse();const blocked=updateFutureDeletions(p,next,notes,'2026-10-01');
  assert.ok(blocked.structuralUpdateError);assert.deepEqual(blocked.sessions,p.sessions);
 });

 test('Deleting the same UUID again after recovery is a new removal event, not an already-applied checkpoint',()=>{
  const {t,p,notes}=sample();const removed=deletion(t,t=>{t.positions=[];});removed.deletionRevision=1;
  const blocked=updateFutureDeletions(p,removed,notes,'2026-10-01');
  const recovered=updateFutureDeletions(blocked,{...t,deletedIds:removed.deletedIds,deletionRevision:1},notes,'2026-10-01');
  assert.equal(recovered.structuralUpdateError,undefined);
  const repeated=updateFutureDeletions(recovered,{...removed,deletionRevision:2},notes,'2026-10-01');
  assert.match(repeated.structuralUpdateError!,/No quedan técnicas/);assert.deepEqual(repeated.sessions,recovered.sessions);
 });
