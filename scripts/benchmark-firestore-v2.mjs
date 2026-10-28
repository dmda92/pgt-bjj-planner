import assert from 'node:assert/strict';
import {NativeAggregates} from '../worker/v2/aggregates.ts';
import {PlanRepository} from '../worker/v2/plans.ts';
import {NativeFirestore} from '../worker/structured/firestore.ts';
import {structuredFixture} from '../tests/structured-firestore-fixture.ts';
import {cloneTemplate,initialVersion} from '../src/domain/models.ts';
import {template} from '../tests/template-fixture.ts';
import {generatePlan} from '../src/domain/planner.ts';
import {buildMonthlyAgenda} from '../src/infrastructure/trainer-agenda.ts';
globalThis.fetch=async()=>{throw Error('BENCHMARK_REAL_NETWORK_FORBIDDEN');};
const c={planId:crypto.randomUUID(),alumnos:['benchmark@example.test'],fecha_comienzo:'2026-01-01',fecha_torneo:'2026-07-02',
    dias_de_entrenamiento:[1,2,3,4,5,6,7],ejercicios_por_sesion:5,tiempo_por_tecnica_segundos:180,
    descanso_entre_ciclos_segundos:10,descanso_entre_tecnicas_segundos:20};
const base=generatePlan(c,c.alumnos[0],cloneTemplate(template),{...initialVersion(),comments:[]},'2026-01-01T00:00:00Z');
const results=[];
for(const [students,currentReads] of [[10,1878],[30,5618],[100,18708]]){
    const plans=Array.from({length:students},(_,i)=>({...structuredClone(base),mail:'member'+i+'@example.test',alumnos:['member'+i+'@example.test']}));
    const month=buildMonthlyAgenda(plans,'2026-02'),f=await structuredFixture(),db=new NativeFirestore(f.env,f.transport),r=new NativeAggregates(db);
    await r.write({kind:'agenda',id:'2026-02'},month,null,crypto.randomUUID());
    const before=f.metrics();db.beginOperation();await r.read({kind:'agenda',id:'2026-02'});db.endOperation();
    const after=f.metrics(),reads=after.estimatedReads-before.estimatedReads;assert.equal(reads,1);
    results.push({operation:'shared-month-storage',students,currentBaselineReads:currentReads,v2Reads:reads,
        http:after.httpRequests-before.httpRequests,writes:after.attemptedWrites-before.attemptedWrites});
}
const f=await structuredFixture(),db=new NativeFirestore(f.env,f.transport),r=new PlanRepository(db);
await r.write(base,null,crypto.randomUUID());
for(const date of [undefined,'2026-03-20']){
    const before=f.metrics();db.beginOperation();await r.read(base.mail,base.planId,date);db.endOperation();
    const after=f.metrics();assert.equal(after.estimatedReads-before.estimatedReads,date?2:8);
    results.push({operation:date?'own-date-storage':'full-plan-storage',sessions:182,v2Reads:after.estimatedReads-before.estimatedReads,
        http:after.httpRequests-before.httpRequests,writes:after.attemptedWrites-before.attemptedWrites});
}
console.log(JSON.stringify({evidence:'isolated-component-benchmark',googleRequests:0,scope:'Persistence only; excludes API, authorization, roster and frontend. V2 is not activated.',results},null,2));
