import { test } from 'node:test';
import assert from 'node:assert/strict';
import { structuredFixture } from './structured-firestore-fixture.ts';
import { template } from './template-fixture.ts';
import { NativeFirestore } from '../worker/structured/firestore.ts';
import { NativeAggregates } from '../worker/v2/aggregates.ts';
import { PlanRepository } from '../worker/v2/plans.ts';
import { PlanViews } from '../worker/v2/plan-views.ts';
import { QueryCoordinator, type QuerySession } from '../worker/v2/query-coordinator.ts';
import { TextCommands, type TextCommand } from '../worker/v2/text-commands.ts';
import { fingerprint } from '../worker/security.ts';
import { cloneTemplate, initialVersion, type Profile, type Competition, type Comments, type Techniques } from '../src/domain/models.ts';
import { generatePlan } from '../src/domain/planner.ts';
import { indexPlanText } from '../src/infrastructure/plan-text-projection.ts';
import { V2Api } from '../worker/v2/api.ts';

async function setup(repeatOneTechnique = false) {
    const f = await structuredFixture(), paths: string[] = [];
    const db = new NativeFirestore(f.env, async (url, init) => { paths.push(new URL(url).pathname); return f.transport(url, init); }), store = new NativeAggregates(db), plans = new PlanRepository(db);
    const owner = 'pupil@example.test', trainer = 'trainer@example.test', sessions: QuerySession[] = [];
    for (const [mail, perfil] of [[owner, 'alumno'], [trainer, 'entrenador']] as const) {
        const p: Profile = { ...initialVersion(), mail, nombre: 'Server', apellidos: perfil, perfil,
            fecha_nacimiento: null, peso: null, cinturon: 'Blanco', pwd: 'synthetic-private-' + mail };
        await store.write({ kind: 'profile', id: mail }, p, null, crypto.randomUUID());
        sessions.push({ mail, role: perfil, pwdFingerprint: await fingerprint(p.pwd!) });
    }
    const techniques = cloneTemplate(template), comments: Comments = { ...initialVersion(), comments: [] };
    const c: Competition = { planId: crypto.randomUUID(), alumnos: [owner], fecha_comienzo: '2026-10-01', fecha_torneo: '2026-11-15',
        dias_de_entrenamiento: [1, 2, 3, 4, 5, 6, 7], ejercicios_por_sesion: 5, tiempo_por_tecnica_segundos: 180,
        descanso_entre_ciclos_segundos: 10, descanso_entre_tecnicas_segundos: 20 };
    const plan = generatePlan(c, owner, techniques, comments, '2026-10-01T00:00:00Z');
    if (repeatOneTechnique) {
        const exercise = plan.sessions[0].exercises[0];
        for (const session of plan.sessions) session.exercises = session.exercises.map(() => structuredClone(exercise));
    }
    await store.write({ kind: 'repertoire', id: owner }, techniques, null, crypto.randomUUID());
    await store.write({ kind: 'comments', id: owner }, comments, null, crypto.randomUUID());
    await store.write({ kind: 'catalog', id: 'competitions' }, { ...initialVersion(), plans: [c], deletedPlanIds: [] }, null, crypto.randomUUID());
    await store.write({ kind: 'assignment', id: owner }, { ...initialVersion(), planIds: [c.planId], deletedPlanIds: [] }, null, crypto.randomUUID());
    await plans.write(plan, null, crypto.randomUUID());
    await store.write({ kind: 'plan-text', id: c.planId + '__' + owner }, indexPlanText(plan), null, crypto.randomUUID());
    const views = new PlanViews(plans, store), coordinator = new QueryCoordinator(store, views);
    let time = '2026-10-26T12:00:00Z';
    const commands = new TextCommands(coordinator, () => new Date(time));
    const command: TextCommand = { kind: 'description', owner, techniqueId: techniques.positions[0].tecnicas[0].id,
        text: 'Future description', expected: '1', operationId: crypto.randomUUID() };
    return { f, paths, store, plans, views, coordinator, commands, command, sessions, plan, setTime(v: string) { time = v; } };
}

test('A description command publishes source and temporal projection atomically without reading distribution', async () => {
    const s = await setup(), before = s.f.metrics(), pathCount = s.paths.length;
    const ack = await s.commands.execute(s.sessions[0], s.command);
    assert.deepEqual(ack.versions, ['2', '2']);
    assert.equal(s.f.metrics().attemptedWrites - before.attemptedWrites, 3);
    assert.ok(!s.paths.slice(pathCount).some(path => path.includes('/plans/')));
    const actual = (await s.views.read(s.command.owner, s.plan.planId))!.data;
    assert.deepEqual(actual.sessions.filter(x => x.date <= '2026-10-26'), s.plan.sessions.filter(x => x.date <= '2026-10-26'));
    assert.ok(actual.sessions.some(x => x.date > '2026-10-26' && x.exercises.some(e => e.techniqueId === s.command.techniqueId && e.descripcion_del_alumno === s.command.text)));
    assert.equal(actual.revision, s.plan.revision + 1);
    const source = (await s.store.read<Techniques>({ kind: 'repertoire', id: s.command.owner }))!.data;
    assert.equal(source.descriptionUpdates![s.command.techniqueId], ack.metadata!.textVersion);
    assert.notEqual(ack.metadata!.textVersion, s.command.operationId);
});

test('A warm text command with one active plan costs four reads and three writes independent of historical sessions', async () => {
    const s = await setup();
    await s.commands.execute(s.sessions[0], s.command);
    const before = s.f.metrics(), pathCount = s.paths.length;
    await s.commands.execute(s.sessions[0], { ...s.command, operationId: crypto.randomUUID(), expected: '2', text: 'Second edit' });
    assert.equal(s.f.metrics().estimatedReads - before.estimatedReads, 4);
    assert.equal(s.f.metrics().attemptedWrites - before.attemptedWrites, 3);
    assert.ok(!s.paths.slice(pathCount).some(path => path.includes('/plans/')));
});

test('Oversized projection preserves the last valid plan and source, persists a recoverable issue, then clears it after correction', async () => {
    const s = await setup(true);
    await s.commands.execute(s.sessions[0], { ...s.command, text: 'x'.repeat(100000) });
    const source = (await s.store.read<Techniques>({ kind: 'repertoire', id: s.command.owner }))!;
    assert.equal(source.data.positions[0].tecnicas[0].descripcion_del_alumno.length, 100000);
    const assignment = (await s.store.read<{ projectionIssues: Record<string, { code: string }> }>({ kind: 'assignment', id: s.command.owner }))!;
    assert.equal(assignment.data.projectionIssues[s.plan.planId].code, 'PLAN_TOO_LARGE');
    assert.deepEqual((await s.views.read(s.command.owner, s.plan.planId))!.data, s.plan);
    await s.commands.execute(s.sessions[0], { ...s.command, operationId: crypto.randomUUID(), text: 'Short correction', expected: source.version });
    assert.equal((await s.store.read<{ projectionIssues?: unknown }>({ kind: 'assignment', id: s.command.owner }))!.data.projectionIssues, undefined);
    const restored = (await s.views.read(s.command.owner, s.plan.planId))!.data;
    assert.deepEqual(restored.sessions.filter(x => x.date <= '2026-10-26'), s.plan.sessions.filter(x => x.date <= '2026-10-26'));
    assert.ok(restored.sessions.filter(x => x.date > '2026-10-26').every(x => x.exercises.every(e => e.descripcion_del_alumno === 'Short correction')));
});

test('A retry after midnight recovers the exact ACK before restamping or moving protected dates', async () => {
    const s = await setup(), ack = await s.commands.execute(s.sessions[0], s.command), before = s.f.metrics();
    s.setTime('2026-10-28T00:05:00Z');
    assert.deepEqual(await s.commands.execute(s.sessions[0], s.command), ack);
    assert.equal(s.f.metrics().attemptedWrites, before.attemptedWrites);
    await assert.rejects(s.commands.execute(s.sessions[0], { ...s.command, text: 'Different input' }), /PAYLOAD_MISMATCH/);
});

test('Comment authors and versions come from the authenticated trainer and unchanged text retains its author', async () => {
    const s = await setup(), command: TextCommand = { ...s.command, kind: 'comment', text: 'Advice' };
    await s.commands.execute(s.sessions[1], command);
    const before = s.f.metrics();
    await s.commands.execute(s.sessions[1], { ...command, expected: '2', operationId: crypto.randomUUID() });
    assert.equal(s.f.metrics().attemptedWrites - before.attemptedWrites, 1); // durable receipt only
    const notes = (await s.store.read<Comments>({ kind: 'comments', id: command.owner }))!.data;
    assert.equal(notes.comments[0].trainerName, 'Server entrenador');
    await s.commands.execute(s.sessions[1], { ...command, text: null, expected: '2', operationId: crypto.randomUUID() });
    assert.equal((await s.store.read<Comments>({ kind: 'comments', id: command.owner }))!.data.comments.length, 0);
});

test('Text commands reject privilege changes, foreign descriptions and stale CAS without business mutations', async () => {
    const s = await setup(), before = s.f.metrics();
    assert.throws(() => s.commands.execute(s.sessions[0], { ...s.command, kind: 'comment' }), /TRAINER_REQUIRED/);
    assert.throws(() => s.commands.execute(s.sessions[1], s.command), /OWN_TECHNIQUES_ONLY/);
    await assert.rejects(s.commands.execute(s.sessions[0], { ...s.command, expected: '999' }), /VERSION_CONFLICT/);
    assert.throws(() => s.commands.execute(s.sessions[0], { ...s.command, text: 'x'.repeat(100001) }), /INVALID/);
    assert.equal(s.f.metrics().attemptedWrites, before.attemptedWrites);
});

test('The specific HTTP command uses server sessions and rejects injected authors or checkpoints', async () => {
    const s = await setup(), token = 't'.repeat(43), key = 'pgt-v2-session:' + await fingerprint(token);
    const values = new Map<string, unknown>([[key, s.sessions[0]]]);
    const api = new V2Api({ async get<T>(k: string) { return values.get(k) as T | undefined; },
        async delete(k: string) { return values.delete(k); } }, s.coordinator, s.commands);
    const send = (body: unknown, auth = true) => api.fetch(new Request('https://synthetic.test/api/v2/commands/text', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body)
    }));
    const before = s.f.metrics();
    assert.equal((await send(s.command, false)).status, 401);
    assert.equal((await send({ ...s.command, trainerName: 'Forged', descriptionUpdates: {} })).status, 400);
    assert.equal(s.f.metrics().attemptedWrites, before.attemptedWrites);
    const response = await send(s.command), ack = await response.json() as { versions: string[] };
    assert.equal(response.status, 200);
    assert.deepEqual(ack.versions, ['2', '2']);
    const repeated = await send(s.command); assert.equal(repeated.status, 200); assert.deepEqual(await repeated.json(), ack);
});
