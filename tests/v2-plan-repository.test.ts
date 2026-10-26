import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PlanRepository } from '../worker/v2/plans.ts';
import { NativeFirestore } from '../worker/structured/firestore.ts';
import { structuredFixture } from './structured-firestore-fixture.ts';
import { generatePlan } from '../src/domain/planner.ts';
import { cloneTemplate, initialVersion, type Competition, type TrainingPlan } from '../src/domain/models.ts';
import { template } from './template-fixture.ts';
import { cursorSignature } from '../src/domain/plan-continuity.ts';
import { PlanViews } from '../worker/v2/plan-views.ts';
import { NativeAggregates } from '../worker/v2/aggregates.ts';
import { indexPlanText, projectPlanText, materializePlanText } from '../src/infrastructure/plan-text-projection.ts';
function plan() {
    const c: Competition = { planId: crypto.randomUUID(), alumnos: ['v2@example.test'], fecha_comienzo: '2026-01-01', fecha_torneo: '2026-07-02',
        dias_de_entrenamiento: [1, 2, 3, 4, 5, 6, 7], ejercicios_por_sesion: 5, tiempo_por_tecnica_segundos: 180,
        descanso_entre_ciclos_segundos: 10, descanso_entre_tecnicas_segundos: 20 };
    return generatePlan(c, c.alumnos[0], cloneTemplate(template), { ...initialVersion(), comments: [] }, '2026-01-01T00:00:00Z');
}
test('V2 full restore reads head plus seven months; one date reads two documents and writes nothing', async () => {
    const f = await structuredFixture(), db = new NativeFirestore(f.env, f.transport), r = new PlanRepository(db), p = plan();
    await r.write(p, null, crypto.randomUUID());
    let before = f.metrics();
    db.beginOperation();
    assert.deepEqual((await r.read(p.mail, p.planId))!.data, p);
    db.endOperation();
    let after = f.metrics();
    assert.equal(after.estimatedReads - before.estimatedReads, 8);
    assert.equal(after.attemptedWrites - before.attemptedWrites, 0);
    before = f.metrics();
    db.beginOperation();
    assert.deepEqual((await r.read(p.mail, p.planId, '2026-03-20'))!.data.sessions, p.sessions.filter(s => s.date === '2026-03-20'));
    db.endOperation();
    after = f.metrics();
    assert.equal(after.estimatedReads - before.estimatedReads, 2);
    assert.equal(after.attemptedWrites - before.attemptedWrites, 0);
});

test('Compact fan-out heads restore the entire long plan and selected date without changing cursor signatures', async () => {
    const f = await structuredFixture(), db = new NativeFirestore(f.env, f.transport), r = new PlanRepository(db), p = plan();
    const prepared = await r.prepare(p, null, crypto.randomUUID(), true);
    await db.commit(prepared.writes);
    assert.deepEqual((await r.read(p.mail, p.planId))!.data, p);
    assert.deepEqual((await r.read(p.mail, p.planId, '2026-03-20'))!.data.sessions, p.sessions.filter(s => s.date === '2026-03-20'));
});
test('V2 retries return the same receipt; mismatched operation and stale version cannot overwrite', async () => {
    const f = await structuredFixture(), db = new NativeFirestore(f.env, f.transport), r = new PlanRepository(db), p = plan(), id = crypto.randomUUID();
    const v = await r.write(p, null, id), before = f.metrics();
    assert.equal(await r.write(p, null, id), v);
    assert.equal(f.metrics().attemptedWrites, before.attemptedWrites);
    const next = structuredClone(p);
    next.sessions[0].exercises[0].tipo = 'Changed';
    await assert.rejects(r.write(next, v, id), /PAYLOAD_MISMATCH/);
    await assert.rejects(r.write(next, 'stale', crypto.randomUUID()), /VERSION_CONFLICT/);
    assert.deepEqual((await r.read(p.mail, p.planId))!.data, p);
});
test('V2 native storage preserves literal timestamps instead of normalizing business strings', async () => {
    const f = await structuredFixture(), r = new PlanRepository(new NativeFirestore(f.env, f.transport)), p = plan();
    p.generatedAt = '2026-01-01T01:00:00+01:00';
    p.updatedAt = p.generatedAt;
    await r.write(p, null, crypto.randomUUID());
    assert.deepEqual((await r.read(p.mail, p.planId))!.data, p);
});
test('V2 staging failure cannot publish a partial or empty plan', async () => {
    const f = await structuredFixture();
    let fail = false;
    const transport: typeof f.transport = async (url, init) => {
        if (fail && url.endsWith(':commit'))
            return Response.json({ error: { status: 'UNAVAILABLE' } }, { status: 503 });
        return f.transport(url, init);
    };
    const r = new PlanRepository(new NativeFirestore(f.env, transport)), p = plan();
    const v = await r.write(p, null, crypto.randomUUID());
    fail = true;
    const next = structuredClone(p);
    next.sessions.at(-1)!.exercises[0].pass += 1;
    await assert.rejects(r.write(next, v, crypto.randomUUID()), /503/);
    fail = false;
    assert.deepEqual((await r.read(p.mail, p.planId))!.data, p);
});
test('V2 stores every frozen generated and recalculated plan without changing historical content', async () => {
    const baseline = JSON.parse(readFileSync(new URL('./fixtures/firestore/domain-baseline.json', import.meta.url), 'utf8')) as {
        fixtures: {
            expected: {
                generated: TrainingPlan;
                result?: TrainingPlan;
            };
        }[];
    };
    for (const fixture of baseline.fixtures)
        for (const p of [fixture.expected.generated, ...(fixture.expected.result ? [fixture.expected.result] : [])]) {
            const f = await structuredFixture(), r = new PlanRepository(new NativeFirestore(f.env, f.transport));
            await r.write(p, null, crypto.randomUUID());
            const restored = (await r.read(p.mail, p.planId))!.data;
            assert.deepEqual(restored, p);
            for (const [i, b] of (p.continuity?.boundaries ?? []).entries())
                assert.equal(cursorSignature(restored.continuity!.boundaries[i].cursor), cursorSignature(b.cursor));
        }
});
test('V2 preserves cursor checksum order and unknown properties across Firestore map sorting', async () => {
    const f = await structuredFixture(), r = new PlanRepository(new NativeFirestore(f.env, f.transport)), p = plan();
    const b = p.continuity!.boundaries[0], c = b.cursor;
    b.cursor = { pending: c.pending.map(item => ({ complete: item.complete, techniqueId: item.techniqueId,
        positionId: item.positionId, extension: 'kept' })), passes: { '9000000002': 2, '9000000001': 1 },
        move: c.move, priority: c.priority, priorities: c.priorities, extension: 'kept' } as typeof c;
    Object.assign(b, { extension: 'boundary' });
    const signature = cursorSignature(b.cursor);
    await r.write(p, null, crypto.randomUUID());
    const restored = (await r.read(p.mail, p.planId))!.data;
    assert.deepEqual(restored, p);
    assert.equal(cursorSignature(restored.continuity!.boundaries[0].cursor), signature);
});
test('V2 lost publication ACK is recovered from atomic receipt without replay or data loss', async () => {
    const f = await structuredFixture();
    let lose = false;
    const transport: typeof f.transport = async (url, init) => {
        const response = await f.transport(url, init);
        if (lose && url.endsWith(':commit') && String(init?.body).includes('/operations/')) {
            lose = false;
            throw Error('lost ACK');
        }
        return response;
    };
    const r = new PlanRepository(new NativeFirestore(f.env, transport)), p = plan(), id = crypto.randomUUID();
    lose = true;
    const first = await r.write(p, null, id);
    const changed = structuredClone(p);
    changed.updatedAt = '2026-01-02T00:00:00Z';
    await r.write(changed, first, crypto.randomUUID());
    const before = f.metrics();
    assert.equal(await r.write(p, null, id), first);
    assert.equal(f.metrics().attemptedWrites, before.attemptedWrites);
    assert.deepEqual((await r.read(p.mail, p.planId))!.data, changed);
});
test('Literal business metadata that looks like a block reference is never treated as an IO capability', async () => {
    const f = await structuredFixture(), db = new NativeFirestore(f.env, f.transport), r = new PlanRepository(db), p = plan();
    Object.assign(p, { extension: { type: 'ref', id: 'not-a-block', blocks: ['not-a-block'] } });
    await r.write(p, null, crypto.randomUUID());
    assert.deepEqual((await r.read(p.mail, p.planId))!.data, p);
    const before = f.metrics();
    await assert.rejects(r.read(p.mail, p.planId, '2026-02-30'), /DATE_INVALID/);
    assert.equal(f.metrics().httpRequests, before.httpRequests);
});

test('An identical plan write retains the logical version rather than exposing Firestore updateTime', async () => {
    const f = await structuredFixture(), r = new PlanRepository(new NativeFirestore(f.env, f.transport)), p = plan();
    const version = await r.write(p, null, crypto.randomUUID()), before = f.metrics();
    assert.equal(await r.write(p, version, crypto.randomUUID()), version);
    assert.equal(f.metrics().attemptedWrites, before.attemptedWrites);
});

test('One date materializes future texts from the pinned base with three reads and no historical distribution reads', async () => {
    const f = await structuredFixture(), db = new NativeFirestore(f.env, f.transport), r = new PlanRepository(db),
        aggregates = new NativeAggregates(db), views = new PlanViews(r, aggregates), p = plan();
    const techniques = cloneTemplate(template), exercise = p.sessions.find(s => s.date === '2026-03-20')!.exercises[0];
    // Use the same technique identities as the stored base plan.
    techniques.positions[0].id = exercise.positionId;
    techniques.positions[0].tecnicas[0].id = exercise.techniqueId;
    const changed = techniques.positions[0].tecnicas[0];
    changed.descripcion_del_alumno = 'Changed after protected date';
    techniques.descriptionUpdates = { [changed.id]: 'server-version' };
    const text = projectPlanText(indexPlanText(p), techniques, { ...initialVersion(), comments: [] }, '2026-03-01');
    await r.write(p, null, crypto.randomUUID());
    await aggregates.write({ kind: 'plan-text', id: p.planId + '__' + p.mail }, text, null, crypto.randomUUID());
    const before = f.metrics();
    db.beginOperation();
    const day = await views.read(p.mail, p.planId, '2026-03-20');
    db.endOperation();
    assert.deepEqual(day!.data.sessions, materializePlanText(p, text).sessions.filter(s => s.date === '2026-03-20'));
    assert.equal(day!.data.sessions[0].exercises[0].descripcion_del_alumno, changed.descripcion_del_alumno);
    assert.deepEqual(day!.version, { distribution: '1', text: '1' });
    assert.equal(f.metrics().estimatedReads - before.estimatedReads, 3);
    assert.equal(f.metrics().attemptedWrites, before.attemptedWrites);
    const bad = { ...text, baseHash: '0'.repeat(64) };
    await aggregates.write({ kind: 'plan-text', id: p.planId + '__' + p.mail }, bad, '1', crypto.randomUUID());
    await assert.rejects(views.read(p.mail, p.planId, '2026-03-20'), /REVISION_MISMATCH/);
});
