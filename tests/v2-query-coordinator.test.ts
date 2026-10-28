import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NativeFirestore } from '../worker/structured/firestore.ts';
import { NativeAggregates } from '../worker/v2/aggregates.ts';
import { PlanRepository } from '../worker/v2/plans.ts';
import { PlanViews } from '../worker/v2/plan-views.ts';
import { QueryCoordinator, type QuerySession } from '../worker/v2/query-coordinator.ts';
import { fingerprint } from '../worker/security.ts';
import { structuredFixture } from './structured-firestore-fixture.ts';
import { initialVersion, type Profile } from '../src/domain/models.ts';
import { V2ReadApi, type SessionLookup } from '../worker/v2/read-api.ts';

async function setup() {
    const f = await structuredFixture(), db = new NativeFirestore(f.env, f.transport), store = new NativeAggregates(db);
    const sessions: QuerySession[] = [];
    for (const [mail, perfil] of [['trainer@example.test', 'entrenador'], ['one@example.test', 'alumno'], ['two@example.test', 'alumno']] as const) {
        const p: Profile = { ...initialVersion(), mail, nombre: 'Synthetic', apellidos: mail, perfil,
            fecha_nacimiento: null, peso: null, cinturon: 'Blanco', pwd: 'synthetic-private-hash-' + mail };
        await store.write({ kind: 'profile', id: mail }, p, null, crypto.randomUUID());
        await store.write({ kind: 'comments', id: mail }, { ...initialVersion(), comments: [] }, null, crypto.randomUUID());
        sessions.push({ mail, role: perfil, pwdFingerprint: await fingerprint(p.pwd!), sessionEpoch: 'v2-initial' });
    }
    const create = () => new QueryCoordinator(store, new PlanViews(new PlanRepository(db), store));
    return { f, db, store, sessions, coordinator: create(), create };
}

test('Invalid calendar dates are rejected before any database operation', async () => {
    const s = await setup(), before = s.f.metrics();
    await assert.rejects(s.coordinator.trainingDay(s.sessions[0], '2026-02-30'), /DATE_INVALID/);
    await assert.rejects(s.coordinator.plan(s.sessions[1], s.sessions[1].mail, crypto.randomUUID(), 'not-a-date'), /DATE_INVALID/);
    assert.equal(s.f.metrics().httpRequests, before.httpRequests);
});

test('Authorized source navigation performs two cold reads then zero reads/writes without TTL refresh', async () => {
    const { f, coordinator, sessions } = await setup(), pupil = sessions[1], before = f.metrics();
    const first = await coordinator.user(pupil, { kind: 'comments', owner: pupil.mail });
    assert.equal(f.metrics().estimatedReads - before.estimatedReads, 2);
    const warm = f.metrics();
    for (let i = 0; i < 25; i++) {
        const value = await coordinator.user(pupil, { kind: 'comments', owner: pupil.mail });
        assert.deepEqual(value, first);
    }
    assert.equal(f.metrics().estimatedReads, warm.estimatedReads);
    assert.equal(f.metrics().attemptedWrites, before.attemptedWrites);
    assert.ok(!JSON.stringify(await coordinator.user(pupil, { kind: 'profile', owner: pupil.mail })).includes('synthetic-private-hash'));
});

test('A warm shared cache never authorizes another pupil and rejects a forged role', async () => {
    const { coordinator, sessions } = await setup();
    await coordinator.user(sessions[0], { kind: 'comments', owner: sessions[1].mail });
    await assert.rejects(coordinator.user(sessions[2], { kind: 'comments', owner: sessions[1].mail }), /OTHER_USER_FORBIDDEN/);
    await assert.rejects(coordinator.user({ ...sessions[2], role: 'entrenador' }, { kind: 'comments', owner: sessions[1].mail }), /SESSION_REVOKED/);
    await assert.rejects(coordinator.shared(sessions[1], { kind: 'roster' }), /TRAINER_REQUIRED/);
});

test('A published role change invalidates a warm actor profile before its next query', async () => {
    const { coordinator, sessions, store } = await setup(), trainer = sessions[0];
    await coordinator.user(trainer, { kind: 'comments', owner: sessions[1].mail });
    const prior = (await store.read<Profile>({ kind: 'profile', id: trainer.mail }))!;
    await coordinator.command(trainer, async actor => ({ operationId: crypto.randomUUID(), changes: [{
        ref: { kind: 'profile', id: actor.mail }, expected: prior.version, data: { ...prior.data, perfil: 'alumno' }
    }] }));
    await assert.rejects(coordinator.user(trainer, { kind: 'comments', owner: sessions[1].mail }), /SESSION_REVOKED/);
});

test('Publication invalidates only changed data and returns independent cached objects', async () => {
    const { f, coordinator, sessions } = await setup(), pupil = sessions[1];
    const source = (await coordinator.user(pupil, { kind: 'comments', owner: pupil.mail }))!;
    const ref = { kind: 'comments' as const, id: pupil.mail }, value = { comments: [{ text: 'new' }] };
    await coordinator.command(pupil, async () => ({ operationId: crypto.randomUUID(), changes: [{ ref, data: value, expected: source.version }] }));
    const before = f.metrics(), read = (await coordinator.user(pupil, { kind: 'comments', owner: pupil.mail }))!;
    assert.deepEqual(read.data, value);
    assert.equal(f.metrics().estimatedReads - before.estimatedReads, 0);
    (read.data as typeof value).comments[0].text = 'local-only';
    assert.deepEqual((await coordinator.user(pupil, { kind: 'comments', owner: pupil.mail }))!.data, value);
    assert.equal(f.metrics().estimatedReads - before.estimatedReads, 0);
});

test('An old replay receipt cannot repopulate the cache with values superseded by a later command', async () => {
    const { coordinator, sessions } = await setup(), pupil = sessions[1];
    const source = (await coordinator.user(pupil, { kind: 'comments', owner: pupil.mail }))!;
    const ref = { kind: 'comments' as const, id: pupil.mail }, firstId = crypto.randomUUID();
    const first = { ref, data: { text: 'first' }, expected: source.version };
    const ack = await coordinator.command(pupil, async () => ({ operationId: firstId, changes: [first] }));
    await coordinator.command(pupil, async () => ({ operationId: crypto.randomUUID(), changes: [{
        ref, data: { text: 'second' }, expected: ack.versions[0]
    }] }));
    assert.deepEqual(await coordinator.command(pupil, async () => ({ operationId: firstId, changes: [first] })), ack);
    assert.deepEqual((await coordinator.user(pupil, { kind: 'comments', owner: pupil.mail }))!.data, { text: 'second' });
});

test('Restart discards all business cache and reauthorizes from current Firestore values', async () => {
    const { coordinator, create, sessions, store } = await setup(), pupil = sessions[1];
    await coordinator.user(pupil, { kind: 'comments', owner: pupil.mail });
    const ref = { kind: 'profile' as const, id: pupil.mail }, prior = (await store.read<Profile>(ref))!;
    // Simulate a controlled publication while this instance is stopped.
    await store.write(ref, { ...prior.data, pwd: 'changed-private-hash' }, prior.version, crypto.randomUUID());
    await assert.rejects(create().user(pupil, { kind: 'comments', owner: pupil.mail }), /SESSION_REVOKED/);
});

test('V2 HTTP queries require server-issued sessions, isolate owners and expose no generic persistence route', async () => {
    const { coordinator, sessions, f } = await setup(), token = 'a'.repeat(43), key = 'pgt-v2-session:' + await fingerprint(token);
    const values = new Map<string, unknown>([[key, sessions[1]]]);
    const lookup: SessionLookup = {
        async get<T>(key: string) { return values.get(key) as T | undefined; },
        async delete(key: string) { return values.delete(key); }
    };
    const api = new V2ReadApi(lookup, coordinator), own = '/api/v2/users/one%40example.test/comments';
    const call = (path: string, auth = true, method = 'GET') => api.fetch(new Request('https://synthetic.test' + path, {
        method, headers: auth ? { Authorization: 'Bearer ' + token } : {}
    }));
    assert.equal((await call(own, false)).status, 401);
    const first = await call(own); assert.equal(first.status, 200); assert.equal(first.headers.get('Cache-Control'), 'no-store');
    const before = f.metrics();
    assert.equal((await call(own)).status, 200);
    assert.equal(f.metrics().estimatedReads, before.estimatedReads);
    assert.equal((await call('/api/v2/users/two%40example.test/comments')).status, 403);
    assert.equal((await call('/api/v2/roster')).status, 403);
    assert.equal((await call(own + '?path=private')).status, 400);
    assert.equal((await call(own, true, 'PUT')).status, 405);
    assert.equal((await call('/api/v2/aggregates/profile')).status, 404);
    assert.equal(f.metrics().attemptedWrites, before.attemptedWrites);
});

test('Atomic receipts retain selective event references for delivery recovery without source or distribution reloads', async () => {
    const { coordinator, sessions, f } = await setup(), pupil = sessions[1], pending = new Set<string>(), id = crypto.randomUUID();
    let delivered = false;
    coordinator.beforePublish = operation => { pending.add(operation); };
    coordinator.onPublish = (_changes, _plans, operation) => { if (delivered) pending.delete(operation); };
    await coordinator.command(pupil, async () => ({ operationId: id, changes: [{ ref: { kind: 'comments', id: pupil.mail }, data: { comments: [] }, expected: '1' }] }));
    assert.ok(pending.has(id)); delivered = true;
    const before = f.metrics();
    assert.equal(await coordinator.deliverOperation(id), true);
    assert.equal(pending.has(id), false);
    assert.equal(f.metrics().estimatedReads - before.estimatedReads, 1);
    assert.equal(f.metrics().attemptedWrites, before.attemptedWrites);
});
