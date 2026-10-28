import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { structuredFixture } from '../tests/structured-firestore-fixture.ts';
import { CachedFirestore } from '../worker/v2/cached-firestore.ts';
import { NativeAggregates } from '../worker/v2/aggregates.ts';
import { PlanRepository } from '../worker/v2/plans.ts';
import { PlanViews } from '../worker/v2/plan-views.ts';
import { QueryCoordinator } from '../worker/v2/query-coordinator.ts';
import { BusinessCommands } from '../worker/v2/business.ts';
import { cloneTemplate, initialVersion } from '../src/domain/models.ts';
import { template } from '../tests/template-fixture.ts';
import { fingerprint } from '../worker/security.ts';
globalThis.fetch = async () => { throw Error('BENCHMARK_REAL_NETWORK_FORBIDDEN'); };
const results = [];
for (const count of [10, 30, 100]) {
    const f = await structuredFixture(); let bytes = 0;
    const db = new CachedFirestore(f.env, async (url, init = {}) => {
        bytes += new TextEncoder().encode(String(init.body ?? '')).length;
        const response = await f.transport(url, init);
        bytes += (await response.clone().arrayBuffer()).byteLength; return response;
    }), store = new NativeAggregates(db), views = new PlanViews(new PlanRepository(db), store);
    let q = new QueryCoordinator(store, views, 32 * 1024 * 1024);
    const b = new BusinessCommands(q, views, () => new Date('2026-10-26T12:00:00Z')), actors = [];
    for (let i = 0; i < count; i++) {
        const mail = 'cost' + i + '@example.test', p = { ...initialVersion(), mail, nombre: 'Synthetic', apellidos: String(i), perfil: i ? 'alumno' : 'entrenador',
            peso: null, cinturon: 'Blanco', fecha_nacimiento: null, pwd: 'synthetic-hash' };
        await store.publish([
            { ref: { kind: 'profile', id: mail }, data: p, expected: null },
            { ref: { kind: 'repertoire', id: mail }, data: cloneTemplate(template), expected: null },
            { ref: { kind: 'comments', id: mail }, data: { ...initialVersion(), comments: [] }, expected: null },
            { ref: { kind: 'assignment', id: mail }, data: { ...initialVersion(), planIds: [] }, expected: null }
        ], crypto.randomUUID());
        actors.push({ mail, role: p.perfil, pwdFingerprint: await fingerprint(p.pwd), sessionEpoch: 'v2-initial' });
    }
    await store.write({kind:'roster',id:'users'},{users:actors.map(a=>({mail:a.mail,nombre:'Synthetic',apellidos:'',perfil:a.role}))},null,crypto.randomUUID());
    const metrics = () => ({ ...f.metrics(), wireBytes: bytes });
    const measure = async (operation, action) => {
        const before = metrics(); await action(); const after = metrics();
        const delta = Object.fromEntries(Object.keys(after).map(key => [key, after[key] - before[key]]));
        results.push({ users: count, operation, ...delta }); return delta;
    };
    await measure('create-31-day-competition', () => b.competition(actors[0], 'competition', { expected: null, operationId: crypto.randomUUID(), competition: {
        alumnos: actors.map(a => a.mail), fecha_comienzo: '2026-10-20', fecha_torneo: '2026-11-20', dias_de_entrenamiento: [1,2,3,4,5,6,7],
        ejercicios_por_sesion: 5, tiempo_por_tecnica_segundos: 180, descanso_entre_ciclos_segundos: 10, descanso_entre_tecnicas_segundos: 20 } }));
    const known = new Map();
    await measure('all-users-first-own-snapshot', async () => {
        for (const actor of actors) {
            const s = await q.snapshot(actor, actor.mail), versions = Object.fromEntries(['profile','techniques','comments','index'].map(k=>[k,s[k].sha]));
            for (const p of s.plans) versions['plan:' + p.data.planId] = p.sha;
            known.set(actor.mail, versions);
        }
    });
    const nav = await measure('10-screen-visits-per-user', async () => {
        for (let i=0;i<10;i++) for(const actor of actors) await q.snapshot(actor,actor.mail,known.get(actor.mail));
    }); assert.equal(nav.estimatedReads,0); assert.equal(nav.attemptedWrites,0);
    await measure('trainer-first-day',()=>q.trainingDay(actors[0],'2026-11-01','2026-10-26'));
    const day=await measure('100-trainer-day-refreshes',async()=>{for(let i=0;i<100;i++)await q.trainingDay(actors[0],'2026-11-01','2026-10-26');});assert.equal(day.estimatedReads,0);
    const actor=actors.at(-1), t=await q.user(actor,{kind:'repertoire',owner:actor.mail});t.data.positions[0].tecnicas[0].descripcion_del_alumno='Changed text';
    await measure('description-command-one-active-plan',()=>b.repertoire(actor,{data:t.data,expected:t.version,operationId:crypto.randomUUID()}));
    const ack=await measure('own-snapshot-after-ACK',()=>q.snapshot(actor,actor.mail,known.get(actor.mail)));assert.equal(ack.estimatedReads,0);
    await q.snapshot(actor,actor.mail); // current versions for reconnect
    const snapshot=await q.snapshot(actor,actor.mail), versions=Object.fromEntries(['profile','techniques','comments','index'].map(k=>[k,snapshot[k].sha]));
    for(const p of snapshot.plans)versions['plan:'+p.data.planId]=p.sha;
    q=new QueryCoordinator(store,views,32*1024*1024);
    const restart=await measure('coordinator-restart-version-handshake',()=>q.snapshot(actor,actor.mail,versions));assert.ok(restart.estimatedReads<=8);
}
await mkdir('.browser-artifacts',{recursive:true});
await writeFile('.browser-artifacts/v2-application-cost.json',JSON.stringify({evidence:'synthetic-application-coordinator',googleRequests:0,scope:'Business commands and authorized queries; excludes HTTP frontend, authentication KDF, SQLite alarms and real billing.',results},null,2));
console.log(JSON.stringify(results,null,2));
