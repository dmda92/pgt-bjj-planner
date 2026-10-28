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
import type { Roster } from '../worker/v2/users.ts';

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
    const trainerSession: QuerySession = { mail: trainer.mail, role: 'entrenador', pwdFingerprint: await fingerprint(trainer.pwd!), sessionEpoch: 'v2-initial' };
    const registration = { mail: 'pupil@example.test', password, confirm: password, nombre: 'Pupil', apellidos: 'Synthetic' };
    const sessionOf = async (token: string) => (await sessions.get<QuerySession>('pgt-v2-session:' + await fingerprint(token)))!;
    return { f, store, q, sessions, users, trainer, trainerSession, registration, sessionOf, password };
}

test('Trainer belt command updates only the student belt and roster atomically without revoking sessions', async () => {
    const s = await setup(), registered = await s.users.register(s.registration), pupil = await s.sessionOf(registered.token);
    const ref = { kind: 'profile' as const, id: pupil.mail }, before = (await s.store.read<Profile>(ref))!;
    const command = { mail: pupil.mail, cinturon: 'Azul', expected: before.version, operationId: crypto.randomUUID() };
    await s.users.change(s.trainerSession, 'belt', command);
    const after = (await s.store.read<Profile>(ref))!;
    assert.equal(after.data.cinturon, 'Azul'); assert.equal(after.data.revision, before.data.revision + 1);
    assert.deepEqual({ ...after.data, cinturon: before.data.cinturon, revision: before.data.revision, updatedAt: before.data.updatedAt }, before.data);
    const roster = (await s.store.read<Roster>({ kind: 'roster', id: 'users' }))!;
    assert.equal(roster.data.users.find(p => p.mail === pupil.mail)!.cinturon, 'Azul');
    assert.equal(((await s.q.user(pupil, { kind: 'profile', owner: pupil.mail }))!.data as Profile).cinturon, 'Azul');
    const writes = s.f.metrics().attemptedWrites;
    await s.users.change(s.trainerSession, 'belt', command); assert.equal(s.f.metrics().attemptedWrites, writes);
    await assert.rejects(s.users.change(s.trainerSession, 'belt', { ...command, cinturon: 'Morado', operationId: crypto.randomUUID() }), /VERSION_CONFLICT/);
});

test('Belt permission does not grant foreign profile editing, role changes or invalid/student-originated writes', async () => {
    const s = await setup(), registered = await s.users.register(s.registration), pupil = await s.sessionOf(registered.token);
    const profile = (await s.store.read<Profile>({ kind: 'profile', id: pupil.mail }))!;
    const command = { mail: pupil.mail, cinturon: 'Azul', expected: profile.version, operationId: crypto.randomUUID() };
    const writes = s.f.metrics().attemptedWrites;
    await assert.rejects(s.users.change(pupil, 'belt', command), /TRAINER_REQUIRED/);
    await assert.rejects(s.users.change(s.trainerSession, 'belt', { ...command, perfil: 'entrenador' }), /UNEXPECTED_FIELD/);
    await assert.rejects(s.users.change(s.trainerSession, 'belt', { ...command, cinturon: 'Naranja' }), /PROFILE_INVALID/);
    await assert.rejects(s.users.change(s.trainerSession, 'profile', { mail: pupil.mail, data: profile.data, expected: profile.version, operationId: crypto.randomUUID() }), /OWN_PROFILE_ONLY/);
    const trainer = (await s.store.read<Profile>({ kind: 'profile', id: s.trainer.mail }))!;
    await assert.rejects(s.users.change(s.trainerSession, 'belt', { ...command, mail: s.trainer.mail, expected: trainer.version }), /STUDENT_REQUIRED/);
    assert.equal(s.f.metrics().attemptedWrites, writes);
});
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
test('Password commands change only credentials and revoke all existing device sessions without enumeration', async () => {
    const s = await setup(), a = await s.users.register(s.registration), session = await s.sessionOf(a.token);
    const ref = { kind: 'profile' as const, id: a.profile.mail }, before = (await s.store.read<Profile>(ref))!;
    await s.users.change(s.trainerSession, 'password', { mail: a.profile.mail, expected: before.version,
        password: 'new-synthetic-password', confirm: 'new-synthetic-password', operationId: crypto.randomUUID() });
    const after = (await s.store.read<Profile>(ref))!;
    assert.notEqual(after.data.pwd, before.data.pwd);
    assert.deepEqual({ ...after.data, pwd: undefined, sessionEpoch: undefined }, { ...before.data, pwd: undefined, sessionEpoch: undefined });
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
    const input = { data: { ...a.profile, peso: 81.2345, nombre: 'Changed', perfil: 'entrenador', pwd: 'forged', sessionEpoch: 'forged' },
        expected: '1', operationId: crypto.randomUUID() };
    const saved = await s.users.change(session, 'profile', input);
    assert.equal((saved as { data: Profile }).data.peso, 81.2345);
    assert.equal((saved as { data: Profile }).data.perfil, 'alumno');
    assert.ok(!('sessionEpoch' in (saved as { data: Profile }).data));
    assert.equal((await s.sessionOf(a.token)).sessionEpoch,
        (await s.store.read<{ sessionEpoch: string }>({ kind: 'profile', id: session.mail }))!.data.sessionEpoch);
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

test('SEC-01 role cycles never revive earlier device sessions, including warm and restarted authorization caches', async () => {
    const s = await setup(), a = await s.users.register(s.registration), old = await s.sessionOf(a.token);
    const other = await s.sessionOf((await s.users.login({ mail: old.mail, password: s.password })).token);
    await s.q.user(old, { kind: 'profile', owner: old.mail });
    const ref = { kind: 'profile' as const, id: old.mail };
    const changeRole = async (perfil: Profile['perfil']) => s.users.change(s.trainerSession, 'role', {
        mail: old.mail, perfil, expected: (await s.store.read(ref))!.version, operationId: crypto.randomUUID()
    });
    await changeRole('entrenador');
    const promoted = await s.sessionOf((await s.users.login({ mail: old.mail, password: s.password })).token);
    await s.q.shared(promoted, { kind: 'roster' });
    await changeRole('alumno');
    // Never touch either old student session between transitions: an HTTP 401
    // deleting a token must not be what prevents resurrection.
    for (const session of [old, other, promoted])
        await assert.rejects(s.q.user(session, { kind: 'profile', owner: old.mail }), /SESSION_REVOKED/);
    const restarted = new QueryCoordinator(s.store, new PlanViews(new PlanRepository(s.store.db), s.store));
    await assert.rejects(restarted.user(old, { kind: 'profile', owner: old.mail }), /SESSION_REVOKED/);
    await changeRole('entrenador');
    await assert.rejects(s.q.shared(promoted, { kind: 'roster' }), /SESSION_REVOKED/);
    const fresh = await s.sessionOf((await s.users.login({ mail: old.mail, password: s.password })).token);
    const before = s.f.metrics();
    for (let i = 0; i < 5; i++) await s.q.user(fresh, { kind: 'profile', owner: fresh.mail });
    assert.equal(s.f.metrics().estimatedReads, before.estimatedReads);
});

test('SEC-01 pre-epoch session format fails closed while migrated accounts can freshly log in without password reset', async () => {
    const s = await setup(), a = await s.users.login({ mail: s.trainer.mail, password: s.password });
    const fresh = await s.sessionOf(a.token), legacy = { mail: fresh.mail, role: fresh.role, pwdFingerprint: fresh.pwdFingerprint };
    await assert.rejects(s.q.user(legacy, { kind: 'profile', owner: fresh.mail }), /SESSION_REVOKED/);
    await s.q.user(fresh, { kind: 'profile', owner: fresh.mail });
});
