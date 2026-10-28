import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NativeAggregates} from '../worker/v2/aggregates.ts';
import {NativeFirestore} from '../worker/structured/firestore.ts';
import {structuredFixture} from './structured-firestore-fixture.ts';
import {PlanRepository} from '../worker/v2/plans.ts';
import {generatePlan} from '../src/domain/planner.ts';
import {cloneTemplate, initialVersion, type Competition} from '../src/domain/models.ts';
import {template} from './template-fixture.ts';

// The server refreshes source metadata on every save. Restoring old text therefore
// needs both old immutable blocks and new metadata/tree blocks in one stage batch.
const source = (text: string, revision: number) => ({revision,
    positions: Array.from({length: 20}, (_, id) => ({id, text: text.repeat(60000)}))});

for (const method of ['write', 'publish'] as const) {
    test(`${method}: fresh CAS restores previous large content with new source metadata`, async () => {
        const f = await structuredFixture();
        const rejected: {existing: number; missing: number}[] = [];
        const db = new NativeFirestore(f.env, async (url, init) => {
            const response = await f.transport(url, init);
            if (url.endsWith('/documents:commit') && response.status === 400) {
                const writes = JSON.parse(String(init?.body)).writes;
                rejected.push({existing: writes.filter((w: any) => f.docs.has(w.update.name)).length,
                    missing: writes.filter((w: any) => !f.docs.has(w.update.name)).length});
            }
            return response;
        });
        const store = new NativeAggregates(db), ref = {kind: 'repertoire' as const, id: 'reuse@example.test'};
        const save = async (data: unknown, expected: string | null, operationId = crypto.randomUUID()) => {
            if (method === 'write') return store.write(ref, data, expected, operationId);
            return (await store.publish([{ref, data, expected}], operationId)).versions[0];
        };
        await save(source('a', 1), null);
        await save(source('b', 2), '1');
        assert.equal((await store.read(ref))!.version, '2');
        db.beginOperation(); // Also exercise NativeFirestore operation-local caching.
        try {
            const data = source('a', 3), operationId = crypto.randomUUID();
            let version: string;
            try { version = await save(data, '2', operationId); }
            catch (error) {
                assert.ok(rejected.some(batch => batch.existing > 0 && batch.missing > 0),
                    'Reproduction must reject a mixed existing/missing block batch');
                throw error;
            }
            assert.equal(version, '3');
            assert.deepEqual((await store.read(ref))!.data, data);
            const before = f.metrics().attemptedWrites;
            assert.equal(await save(data, '2', operationId), '3');
            assert.equal(f.metrics().attemptedWrites, before, 'ACK replay performs no writes');
            await assert.rejects(save(source('c', 4), '2'), /VERSION_CONFLICT/);
            assert.equal(f.metrics().attemptedWrites, before, 'Real stale CAS stages no blocks');
        } finally { db.endOperation(); }
    });
}

for (const method of ['write', 'prepare'] as const) {
    test(`plans.${method}: reuse an older month together with a newly changed month`, async () => {
        const f = await structuredFixture(), db = new NativeFirestore(f.env, f.transport), plans = new PlanRepository(db);
        const competition: Competition = {planId: crypto.randomUUID(), alumnos: ['reuse@example.test'],
            fecha_comienzo: '2026-01-01', fecha_torneo: '2026-04-02', dias_de_entrenamiento: [1,2,3,4,5,6,7],
            ejercicios_por_sesion: 5, tiempo_por_tecnica_segundos: 180,
            descanso_entre_ciclos_segundos: 10, descanso_entre_tecnicas_segundos: 20};
        const original = generatePlan(competition, competition.alumnos[0], cloneTemplate(template),
            {...initialVersion(), comments: []}, '2026-01-01T00:00:00Z');
        const changed = structuredClone(original);
        for (const session of changed.sessions) session.exercises[0].tipo = 'B';
        const restored = structuredClone(original);
        restored.sessions.at(-1)!.exercises[0].tipo = 'C';
        const save = async (plan: typeof original, expected: string | null) => {
            if (method === 'write') return plans.write(plan, expected, crypto.randomUUID());
            const pending = await plans.prepare(plan, expected, crypto.randomUUID());
            await db.commit(pending.writes);
            return pending.version;
        };
        await save(original, null);
        await save(changed, '1');
        assert.equal(await save(restored, '2'), '3');
        assert.deepEqual((await plans.read(restored.mail, restored.planId))!.data, restored);
    });
}
