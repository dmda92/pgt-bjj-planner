import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NativeAggregates } from '../worker/v2/aggregates.ts';
import { NativeFirestore } from '../worker/structured/firestore.ts';
import { structuredFixture } from './structured-firestore-fixture.ts';
import { buildMonthlyAgenda, queryMonthlyAgenda } from '../src/infrastructure/trainer-agenda.ts';
import { generatePlan } from '../src/domain/planner.ts';
import { cloneTemplate, initialVersion, type Competition } from '../src/domain/models.ts';
import { template } from './template-fixture.ts';
test('A normal repertoire is one native document; cached reads and identical writes produce no mutations', async () => {
    const f = await structuredFixture(), db = new NativeFirestore(f.env, f.transport), r = new NativeAggregates(db), ref = { kind: 'repertoire' as const, id: 'native@example.test' }, data = cloneTemplate(template);
    const version = await r.write(ref, data, null, crypto.randomUUID()), before = f.metrics();
    db.beginOperation();
    assert.deepEqual((await r.read(ref))!.data, data);
    assert.deepEqual((await r.read(ref))!.data, data);
    db.endOperation();
    assert.equal(f.metrics().estimatedReads - before.estimatedReads, 1);
    const old = f.metrics();
    assert.equal(await r.write(ref, data, version, crypto.randomUUID()), version);
    assert.equal(f.metrics().attemptedWrites, old.attemptedWrites);
});
test('Native packing retains sources above one MiB and large maps without JSON string blobs', async () => {
    const f = await structuredFixture(), r = new NativeAggregates(new NativeFirestore(f.env, f.transport));
    const data = { entries: Array.from({ length: 1000 }, (_, i) => ({ id: i, text: 'á'.repeat(1000) })) };
    await r.write({ kind: 'comments', id: 'large@example.test' }, data, null, crypto.randomUUID());
    assert.deepEqual((await r.read({ kind: 'comments', id: 'large@example.test' }))!.data, data);
    for (const d of f.docs.values())
        assert.ok(!('bytesValue' in d.fields));
});
test('A shared month for 100 pupils is one cold document, independent of 182 sessions per pupil', async () => {
    const c: Competition = { planId: crypto.randomUUID(), alumnos: ['agenda@example.test'], fecha_comienzo: '2026-01-01', fecha_torneo: '2026-07-02',
        dias_de_entrenamiento: [1, 2, 3, 4, 5, 6, 7], ejercicios_por_sesion: 5, tiempo_por_tecnica_segundos: 180, descanso_entre_ciclos_segundos: 10, descanso_entre_tecnicas_segundos: 20 };
    const base = generatePlan(c, c.alumnos[0], cloneTemplate(template), { ...initialVersion(), comments: [] }, '2026-01-01T00:00:00Z');
    const plans = Array.from({ length: 100 }, (_, i) => ({ ...structuredClone(base), mail: 'member' + i + '@example.test', alumnos: ['member' + i + '@example.test'] }));
    const agenda = buildMonthlyAgenda(plans, '2026-02'), f = await structuredFixture(), db = new NativeFirestore(f.env, f.transport), r = new NativeAggregates(db), ref = { kind: 'agenda' as const, id: '2026-02' };
    await r.write(ref, agenda, null, crypto.randomUUID());
    const before = f.metrics();
    db.beginOperation();
    const actual = (await r.read<typeof agenda>(ref))!.data;
    db.endOperation();
    assert.equal(f.metrics().estimatedReads - before.estimatedReads, 1);
    assert.deepEqual(queryMonthlyAgenda(actual, '2026-02-10', '2026-01-31', new Map()), queryMonthlyAgenda(agenda, '2026-02-10', '2026-01-31', new Map()));
    assert.equal(f.metrics().attemptedWrites, before.attemptedWrites);
});
test('Arbitrary paths and wrong namespaces are rejected before any transport request', async () => {
    const f = await structuredFixture(), db = new NativeFirestore(f.env, f.transport), r = new NativeAggregates(db);
    assert.throws(() => new NativeAggregates(db, 'users/production'), /NAMESPACE/);
    await assert.rejects(r.read({ kind: 'profile', id: '../another' }), /REF_INVALID/);
    assert.equal(f.metrics().httpRequests, 0);
});

test('Command publication atomically updates source and projections, and retries recover the original ACK', async () => {
    const f = await structuredFixture(), r = new NativeAggregates(new NativeFirestore(f.env, f.transport));
    const source = { kind: 'comments' as const, id: 'atomic@example.test' };
    const projection = { kind: 'plan-text' as const, id: 'atomic@example.test' };
    const id = crypto.randomUUID(), changes = [
        { ref: source, data: { text: 'first' }, expected: null },
        { ref: projection, data: { text: 'first', protectedDate: '2026-10-26' }, expected: null }
    ];
    const ack = await r.publish(changes, id);
    assert.deepEqual(ack, { versions: ['1', '1'], changed: [true, true] });
    await r.publish(changes.map(c => ({ ...c, data: { text: 'second' }, expected: '1' })), crypto.randomUUID());
    const before = f.metrics();
    assert.deepEqual(await r.publish(changes, id), ack);
    assert.equal(f.metrics().attemptedWrites, before.attemptedWrites);
    assert.deepEqual((await r.read(source))!.data, { text: 'second' });
    await assert.rejects(r.publish([{ ...changes[0], data: { text: 'reused' } }], id), /PAYLOAD_MISMATCH/);
});

test('A stale projection CAS rejects the whole command before any staging writes', async () => {
    const f = await structuredFixture(), r = new NativeAggregates(new NativeFirestore(f.env, f.transport));
    const a = { kind: 'repertoire' as const, id: 'cas@example.test' }, b = { kind: 'plan-text' as const, id: 'cas@example.test' };
    await r.publish([a, b].map(ref => ({ ref, data: { value: 1 }, expected: null })), crypto.randomUUID());
    const before = f.metrics();
    await assert.rejects(r.publish([
        { ref: a, data: { value: 2 }, expected: '1' },
        { ref: b, data: { value: 2 }, expected: 'stale' }
    ], crypto.randomUUID()), /VERSION_CONFLICT/);
    assert.equal(f.metrics().attemptedWrites, before.attemptedWrites);
    assert.deepEqual((await r.read(a))!.data, { value: 1 });
});

test('Lost command ACK is recovered without publishing partial heads or repeating writes', async () => {
    const f = await structuredFixture();
    let lose = true;
    const transport: typeof f.transport = async (url, init) => {
        const response = await f.transport(url, init);
        if (lose && url.endsWith(':commit') && String(init?.body).includes('/operations/c_')) {
            lose = false;
            throw Error('Lost command ACK');
        }
        return response;
    };
    const r = new NativeAggregates(new NativeFirestore(f.env, transport)), ref = { kind: 'comments' as const, id: 'ack@example.test' };
    assert.deepEqual(await r.publish([{ ref, data: { value: 1 }, expected: null }], crypto.randomUUID()), {
        versions: ['1'], changed: [true]
    });
    assert.deepEqual((await r.read(ref))!.data, { value: 1 });
});

test('Concurrent publications cannot split source and dependent heads', async () => {
    const f = await structuredFixture(), r = new NativeAggregates(new NativeFirestore(f.env, f.transport));
    const refs = [{ kind: 'comments' as const, id: 'race@example.test' }, { kind: 'plan-text' as const, id: 'race@example.test' }];
    await r.publish(refs.map(ref => ({ ref, data: { value: 0 }, expected: null })), crypto.randomUUID());
    const results = await Promise.allSettled([1, 2].map(value => r.publish(refs.map(ref => ({ ref, data: { value }, expected: '1' })), crypto.randomUUID())));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.deepEqual((await r.read(refs[0]))!.data, (await r.read(refs[1]))!.data);
});

test('Unchanged command writes only its durable receipt and never rewrites business heads', async () => {
    const f = await structuredFixture(), r = new NativeAggregates(new NativeFirestore(f.env, f.transport));
    const ref = { kind: 'comments' as const, id: 'noop@example.test' }, data = { value: 1 };
    await r.write(ref, data, null, crypto.randomUUID());
    const before = f.metrics(), id = crypto.randomUUID(), changes = [{ ref, data, expected: '1' }];
    const ack = await r.publish(changes, id);
    assert.deepEqual(ack, { versions: ['1'], changed: [false] });
    assert.equal(f.metrics().attemptedWrites - before.attemptedWrites, 1);
    await r.write(ref, { value: 2 }, '1', crypto.randomUUID());
    assert.deepEqual(await r.publish(changes, id), ack);
});
