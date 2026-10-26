import { test } from 'node:test';
import assert from 'node:assert/strict';
import { structuredFixture } from './structured-firestore-fixture.ts';
import { template } from './template-fixture.ts';
import { NativeFirestore } from '../worker/structured/firestore.ts';
import { NativeAggregates } from '../worker/v2/aggregates.ts';
import { PlanRepository } from '../worker/v2/plans.ts';
import { PlanViews } from '../worker/v2/plan-views.ts';
import { QueryCoordinator, type QuerySession } from '../worker/v2/query-coordinator.ts';
import { UserService, type SessionStorage } from '../worker/v2/users.ts';
import { V2Api } from '../worker/v2/api.ts';
import { fingerprint, passwordHash } from '../worker/security.ts';
import { initialVersion, type Profile, type Techniques } from '../src/domain/models.ts';

async function setup() {
    const f = await structuredFixture(), store = new NativeAggregates(new NativeFirestore(f.env, f.transport));
    const q = new QueryCoordinator(store, new PlanViews(new PlanRepository(store.db), store)), values = new Map<string, unknown>();
    const sessions: SessionStorage = { async get<T>(key: string) { return values.get(key) as T | undefined; },
        async put<T>(key: string, value: T) { values.set(key, structuredClone(value)); }, async delete(key: string) { return values.delete(key); } };
    await store.write({ kind: 'template', id: 'official' }, template, null, crypto.randomUUID());
    const users = new UserService(q, sessions), password = 'synthetic-user-password';
    const trainer: Profile = { ...initialVersion(), mail: 'trainer@example.test', nombre: 'Trainer', apellidos: 'Synthetic',
        fecha_nacimiento: null, peso: 80.123, cinturon: 'Blanco', perfil: 'entrenador', pwd: await passwordHash(password) };
    await store.write({ kind: 'profile', id: trainer.mail }, trainer, null, crypto.randomUUID());
    const trainerSession: QuerySession = { mail: trainer.mail, role: 'entrenador', pwdFingerprint: await fingerprint(trainer.pwd!) };
    const registration = { mail: 'pupil@example.test', password, confirm: password, nombre: 'Pupil', apellidos: 'Synthetic' };
    const sessionOf = async (token: string) => (await sessions.get<QuerySession>('pgt-v2-session:' + await fingerprint(token)))!;
    return { f, store, q, sessions, users, trainer, trainerSession, registration, sessionOf, password };
}
test('Registration atomically creates the entire account, independent UUIDs and student-only role', async () => {
    const s = await setup(), a = await s.users.register(s.registration);
    const b = await s.users.register({ ...s.registration, mail: 'other@example.test' });
    assert.equal(a.profile.perfil, 'alumno'); assert.ok(!('pwd' in a.profile));
    const ta = (await s.store.read<Techniques>({ kind: 'repertoire', id: a.profile.mail }))!.data;
    const tb = (await s.store.read<Techniques>({ kind: 'repertoire', id: b.profile.mail }))!.data;
    const ids = new Set(ta.positions.flatMap(p => [p.id, ...p.tecnicas.map(t => t.id)]));
    assert.ok(tb.positions.flatMap(p => [p.id, ...p.tecnicas.map(t => t.id)]).every(id => !ids.has(id)));
    assert.ok(await s.store.read({ kind: 'comments', id: a.profile.mail }));
    assert.ok(await s.store.read({ kind: 'assignment', id: a.profile.mail }));
    const before = s.f.metrics(); await s.users.register(s.registration);
    assert.equal(s.f.metrics().attemptedWrites, before.attemptedWrites);
    assert.throws(() => s.users.register({ ...s.registration, perfil: 'entrenador' }), /UNEXPECTED_FIELD/);
    await assert.rejects(s.users.register({ ...s.registration, password: 'different-password', confirm: 'different-password' }), /USER_EXISTS/);
});
test('Password commands change only pwd and revoke all existing device sessions without enumeration', async () => {
    const s = await setup(), a = await s.users.register(s.registration), session = await s.sessionOf(a.token);
    const ref = { kind: 'profile' as const, id: a.profile.mail }, before = (await s.store.read<Profile>(ref))!;
    await s.users.change(s.trainerSession, 'password', { mail: a.profile.mail, expected: before.version,
        password: 'new-synthetic-password', confirm: 'new-synthetic-password', operationId: crypto.randomUUID() });
    const after = (await s.store.read<Profile>(ref))!;
    assert.notEqual(after.data.pwd, before.data.pwd);
    assert.deepEqual({ ...after.data, pwd: undefined }, { ...before.data, pwd: undefined });
    await assert.rejects(s.q.user(session, { kind: 'profile', owner: session.mail }), /SESSION_REVOKED/);
    await assert.rejects(s.users.login({ mail: session.mail, password: s.password }), /LOGIN_FAILED/);
    assert.ok((await s.users.login({ mail: session.mail, password: 'new-synthetic-password' })).token);
});
test('Role commands enforce trainer and CAS, update roster, and invalidate earlier sessions', async () => {
    const s = await setup(), a = await s.users.register(s.registration), session = await s.sessionOf(a.token);
    await assert.rejects(s.users.change(session, 'role', { mail: session.mail, expected: '1', perfil: 'entrenador' }), /TRAINER_REQUIRED/);
    await assert.rejects(s.users.change(s.trainerSession, 'role', { mail: s.trainer.mail, expected: '1', perfil: 'alumno' }), /SELF_DEMOTION/);
    await s.users.change(s.trainerSession, 'role', { mail: session.mail, expected: '1', perfil: 'entrenador', operationId: crypto.randomUUID() });
    await assert.rejects(s.q.user(session, { kind: 'profile', owner: session.mail }), /SESSION_REVOKED/);
    assert.equal((await s.users.login({ mail: session.mail, password: s.password })).profile.perfil, 'entrenador');
    const roster = (await s.store.read<{ users: Profile[] }>({ kind: 'roster', id: 'users' }))!.data;
    assert.equal(roster.users.find(p => p.mail === session.mail)!.perfil, 'entrenador');
    assert.ok(!JSON.stringify(roster).includes('pbkdf2'));
});
test('Own profile commands preserve protected fields, exact weight, validate before writing, and replay safely', async () => {
    const s = await setup(), a = await s.users.register(s.registration), session = await s.sessionOf(a.token);
    const input = { data: { ...a.profile, peso: 81.2345, nombre: 'Changed', perfil: 'entrenador', pwd: 'forged' },
        expected: '1', operationId: crypto.randomUUID() };
    const saved = await s.users.change(session, 'profile', input);
    assert.equal((saved as { data: Profile }).data.peso, 81.2345);
    assert.equal((saved as { data: Profile }).data.perfil, 'alumno');
    const before = s.f.metrics(); await s.users.change(session, 'profile', input);
    assert.equal(s.f.metrics().attemptedWrites, before.attemptedWrites);
    await assert.rejects(s.users.change(session, 'profile', { ...input, operationId: crypto.randomUUID(), expected: '2', data: { ...input.data, peso: 500 } }), /PROFILE_INVALID/);
    assert.equal(s.f.metrics().attemptedWrites, before.attemptedWrites);
});
test('HTTP auth issues server sessions, wrong password is denied, and logout deletes only its token', async () => {
    const s = await setup(), api = new V2Api(s.sessions, s.q);
    const call = (route: string, body: unknown, token = '') => api.fetch(new Request('https://synthetic.test/api/v2/auth/' + route, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body)
    }));
    const registered = await call('register', s.registration); assert.equal(registered.status, 201);
    const auth = await registered.json() as { token: string };
    assert.equal((await call('login', { mail: s.registration.mail, password: 'incorrect-password' })).status, 401);
    const other = await s.users.login({ mail: s.registration.mail, password: s.password });
    assert.equal((await call('logout', {}, auth.token)).status, 200);
    assert.equal(await s.sessions.get('pgt-v2-session:' + await fingerprint(auth.token)), undefined);
    assert.ok(await s.sessions.get('pgt-v2-session:' + await fingerprint(other.token)));
});
