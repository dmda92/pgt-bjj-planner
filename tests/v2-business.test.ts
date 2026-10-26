import { test } from 'node:test';
import assert from 'node:assert/strict';
import { structuredFixture } from './structured-firestore-fixture.ts';
import { template } from './template-fixture.ts';
import { NativeFirestore } from '../worker/structured/firestore.ts';
import { NativeAggregates } from '../worker/v2/aggregates.ts';
import { PlanRepository } from '../worker/v2/plans.ts';
import { PlanViews } from '../worker/v2/plan-views.ts';
import { QueryCoordinator, type QuerySession } from '../worker/v2/query-coordinator.ts';
import { BusinessCommands } from '../worker/v2/business.ts';
import { fingerprint } from '../worker/security.ts';
import { cloneTemplate, initialVersion, type Profile, type Techniques, type Competition } from '../src/domain/models.ts';
import { queryMonthlyAgenda, type MonthlyAgenda } from '../src/infrastructure/trainer-agenda.ts';
const clock = () => new Date('2026-10-26T12:00:00Z');
async function setup(count = 2) {
    const f = await structuredFixture(), paths: string[] = [], db = new NativeFirestore(f.env, async (url, init) => { paths.push(new URL(url).pathname); return f.transport(url, init); });
    const store = new NativeAggregates(db), views = new PlanViews(new PlanRepository(db), store), q = new QueryCoordinator(store, views), business = new BusinessCommands(q, views, clock);
    const sessions: QuerySession[] = [], repertoires: Techniques[] = [];
    for (let i = 0; i < count; i++) {
        const mail = 'member' + i + '@example.test', profile: Profile = { ...initialVersion(), mail, nombre: 'Member', apellidos: String(i),
            perfil: i === 0 ? 'entrenador' : 'alumno', peso: null, fecha_nacimiento: null, cinturon: 'Blanco', pwd: 'synthetic-hash-' + i };
        const t = cloneTemplate(template); repertoires.push(t);
        await store.publish([
            { ref: { kind: 'profile', id: mail }, data: profile, expected: null },
            { ref: { kind: 'repertoire', id: mail }, data: t, expected: null },
            { ref: { kind: 'comments', id: mail }, data: { ...initialVersion(), comments: [] }, expected: null },
            { ref: { kind: 'assignment', id: mail }, data: { ...initialVersion(), planIds: [] }, expected: null }
        ], crypto.randomUUID());
        sessions.push({ mail, role: profile.perfil, pwdFingerprint: await fingerprint(profile.pwd!) });
    }
    const competition: Competition = { planId: crypto.randomUUID(), alumnos: sessions.map(s => s.mail), fecha_comienzo: '2026-10-20', fecha_torneo: '2026-11-20',
        dias_de_entrenamiento: [1, 2, 3, 4, 5, 6, 7], ejercicios_por_sesion: 5, tiempo_por_tecnica_segundos: 180,
        descanso_entre_ciclos_segundos: 10, descanso_entre_tecnicas_segundos: 20 };
    return { f, paths, store, views, q, business, sessions, repertoires, competition };
}

test('Empty position or technique names remain invalid on the server before any database IO', async () => {
    const s = await setup(1);
    for (const kind of ['position', 'technique']) {
        const data = structuredClone(s.repertoires[0]);
        if (kind === 'position') data.positions[0].posicion = ' ';
        else data.positions[0].tecnicas[0].tipo = '';
        const before = s.f.metrics();
        assert.throws(() => s.business.repertoire(s.sessions[0], { data, expected: '1', operationId: crypto.randomUUID() }),
            (error: any) => error.status === 400 && error.message === 'PAYLOAD_INVALID');
        assert.equal(s.f.metrics().estimatedReads, before.estimatedReads);
        assert.equal(s.f.metrics().attemptedWrites, before.attemptedWrites);
    }
});
test('Competition, participant plans, indexes and shared agenda publish together including a competing trainer', async () => {
    const s = await setup(), input = { competition: s.competition, expected: null, operationId: crypto.randomUUID() };
    const ack = await s.business.competition(s.sessions[0], 'competition', input), id = ack.metadata!.planId;
    assert.equal(ack.plans!.length, 2);
    for (const actor of s.sessions) assert.ok(await s.q.plan(actor, actor.mail, id));
    const agenda = (await s.store.read<MonthlyAgenda>({ kind: 'agenda', id: '2026-11' }))!;
    assert.equal(new Set(queryMonthlyAgenda(agenda.data, '2026-11-01', '2026-10-26', new Map()).groups.flatMap(g => g.students.map(s => s.mail))).size, 2);
    const before = s.f.metrics(); assert.deepEqual(await s.business.competition(s.sessions[0], 'competition', input), ack);
    assert.equal(s.f.metrics().attemptedWrites, before.attemptedWrites);
});
test('Unassignment deletes only its individual plan; reassignment creates a fresh generation with no stale text binding', async () => {
    const s = await setup(), created = await s.business.competition(s.sessions[0], 'competition', { competition: s.competition, expected: null, operationId: crypto.randomUUID() }), id = created.metadata!.planId;
    const first = (await s.views.read(s.sessions[1].mail, id))!.data;
    await s.business.competition(s.sessions[0], 'assignment', { planId: id, alumnos: [s.sessions[0].mail], expected: '1', operationId: crypto.randomUUID() });
    await assert.rejects(s.q.plan(s.sessions[1], s.sessions[1].mail, id), /NOT_ASSIGNED/);
    assert.equal(await s.views.plans.head(s.sessions[1].mail, id), null);
    assert.ok(await s.views.plans.head(s.sessions[0].mail, id));
    await s.business.competition(s.sessions[0], 'assignment', { planId: id, alumnos: s.sessions.map(a => a.mail), expected: '2', operationId: crypto.randomUUID() });
    assert.deepEqual((await s.q.plan(s.sessions[1], s.sessions[1].mail, id))!.data.sessions, first.sessions);
});
test('Structural additions and deletions preserve exact protected sessions and cursor signatures', async () => {
    const s = await setup(), created = await s.business.competition(s.sessions[0], 'competition', { competition: s.competition, expected: null, operationId: crypto.randomUUID() }), id = created.metadata!.planId;
    const before = (await s.views.read(s.sessions[1].mail, id))!.data, next = structuredClone(s.repertoires[1]);
    next.positions[0].tecnicas.push({ id: crypto.randomUUID(), tipo: 'Added', descripcion_del_alumno: '' });
    const added = await s.business.repertoire(s.sessions[1], { data: next, expected: '1', operationId: crypto.randomUUID() });
    assert.equal(added.plans!.length, 1);
    const after = (await s.views.read(s.sessions[1].mail, id))!.data;
    assert.deepEqual(after.sessions.filter(x => x.date <= '2026-10-26'), before.sessions.filter(x => x.date <= '2026-10-26'));
    assert.equal(after.sessions.length, before.sessions.length);
    const current = (await s.store.read<Techniques>({ kind: 'repertoire', id: s.sessions[1].mail }))!;
    current.data.positions.splice(0, 1);
    await s.business.repertoire(s.sessions[1], { data: current.data, expected: current.version, operationId: crypto.randomUUID() });
    assert.deepEqual((await s.views.read(s.sessions[1].mail, id))!.data.sessions.filter(x => x.date <= '2026-10-26'), before.sessions.filter(x => x.date <= '2026-10-26'));
});
test('Full repertoire saves containing only description edits do not read any distribution blocks', async () => {
    const s = await setup(); await s.business.competition(s.sessions[0], 'competition', { competition: s.competition, expected: null, operationId: crypto.randomUUID() });
    const next = structuredClone(s.repertoires[1]); next.positions[0].tecnicas[0].descripcion_del_alumno = 'Description';
    const start = s.paths.length;
    await s.business.repertoire(s.sessions[1], { data: next, expected: '1', operationId: crypto.randomUUID() });
    assert.ok(!s.paths.slice(start).some(p => p.includes('/plans/')));
});
test('Only trainers create competitions and invalid rest/date/participants cause no business mutations', async () => {
    const s = await setup(), before = s.f.metrics();
    await assert.rejects(s.business.competition(s.sessions[1], 'competition', { competition: s.competition, expected: null, operationId: crypto.randomUUID() }), /TRAINER_REQUIRED/);
    await assert.rejects(s.business.competition(s.sessions[0], 'competition', { competition: { ...s.competition, descanso_entre_ciclos_segundos: 0 }, expected: null, operationId: crypto.randomUUID() }), /INVALID/);
    assert.equal(s.f.metrics().attemptedWrites, before.attemptedWrites);
    assert.throws(() => s.business.comments(s.sessions[0], { data: { comments: [null] }, operationId: crypto.randomUUID() }), /COMMENTS_INVALID/);
    assert.equal(s.f.metrics().attemptedWrites, before.attemptedWrites);
});

test('A 100-participant two-year competition publishes without splitting its visible catalog, assignments or plans', async () => {
    const s = await setup(100);
    s.competition.fecha_torneo = '2028-10-19';
    const result = await s.business.competition(s.sessions[0], 'competition', { competition: s.competition, expected: null, operationId: crypto.randomUUID() });
    assert.equal(result.plans!.length, 100);
    assert.equal(result.plans!.filter(p => p.changed).length, 100);
    const report = await s.q.trainingDay(s.sessions[0], '2026-11-01', '2026-10-26');
    assert.equal(new Set(report.groups.flatMap(g => g.students.map(s => s.mail))).size, 100);
    const before = s.f.metrics(); await s.q.trainingDay(s.sessions[0], '2026-11-01', '2026-10-26');
    assert.equal(s.f.metrics().estimatedReads, before.estimatedReads);
    assert.equal(s.f.metrics().attemptedWrites, before.attemptedWrites);
    const last = s.sessions.at(-1)!;
    assert.equal((await s.q.plan(last, last.mail, result.metadata!.planId, '2028-10-18'))!.data.sessions[0].exercises.length, 5);
});

test('Correcting an empty repertoire generates its assigned missing plan and removes the pending agenda marker', async () => {
    const s = await setup(1), actor = s.sessions[0];
    await s.store.write({ kind: 'catalog', id: 'competitions' }, { ...initialVersion(), plans: [], deletedPlanIds: [] }, null, crypto.randomUUID());
    await s.business.repertoire(actor, { data: { ...s.repertoires[0], positions: [] }, expected: '1', operationId: crypto.randomUUID() });
    const created = await s.business.competition(actor, 'competition', { competition: s.competition, expected: '1', operationId: crypto.randomUUID() });
    assert.equal(created.plans?.length ?? 0, 0);
    const pending = await s.q.snapshot(actor, actor.mail); assert.equal(pending.pendingPlanIds.length, 1);
    const restored = await s.business.repertoire(actor, { data: s.repertoires[0], expected: '2', operationId: crypto.randomUUID() });
    assert.equal(restored.plans!.length, 1);
    assert.equal((await s.q.snapshot(actor, actor.mail)).pendingPlanIds.length, 0);
    assert.equal((await s.q.trainingDay(actor, '2026-11-01', '2026-10-26')).missing, 0);
});
