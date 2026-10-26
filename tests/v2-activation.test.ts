import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotFromFiles } from '../tools/migration/github-source.ts';
import { convertSnapshot } from '../tools/migration/convert.ts';
import { stageMigration } from '../tools/migration/stage.ts';
import { activateDevMigration } from '../tools/migration/activate.ts';
import { NativeFirestore } from '../worker/structured/firestore.ts';
import { FirestoreUsage } from '../worker/structured/usage.ts';
import { NativeAggregates } from '../worker/v2/aggregates.ts';
import { structuredFixture } from './structured-firestore-fixture.ts';
import { template } from './template-fixture.ts';
import { cloneTemplate, initialVersion, type Profile } from '../src/domain/models.ts';
import { passwordMatches } from '../worker/security.ts';
import { runDevMigration } from '../tools/migration/run-dev.ts';
import type { BudgetKV, BudgetStorage } from '../worker/structured/execution-budget.ts';
function bundle() {
    const mail = 'import-trainer@example.test', root = 'PGT/users_data/' + mail + '/';
    const entries: [string, unknown][] = [
        ['PGT/master_data/tecnics_base.json', template], ['PGT/master_data/plans.json', { ...initialVersion(), plans: [], deletedPlanIds: [] }],
        [root + 'user_data.json', { ...initialVersion(), mail, nombre: 'Imported', apellidos: 'Synthetic', perfil: 'entrenador',
            cinturon: 'Blanco', fecha_nacimiento: null, peso: 80.123, pwd: 'pbkdf2-sha256$600000$source$hash' }],
        [root + 'tecnics.json', cloneTemplate(template)], [root + 'trainer_comments.json', { ...initialVersion(), comments: [] }],
        [root + 'plans_index.json', { ...initialVersion(), planIds: [] }]
    ];
    return { mail, value: convertSnapshot(snapshotFromFiles('a'.repeat(40), 'b'.repeat(40), entries.map(([path, data]) => ({ path, content: JSON.stringify(data) }))), 'pgt-bjj-dev') };
}
test('Activation requires an operator gate, verified import, fresh pointer CAS and independent DEV credentials', async () => {
    const f = await structuredFixture(), db = new NativeFirestore(f.env, f.transport, new FirestoreUsage({ reads: 1000, writes: 1000, deletes: 0 })), b = bundle();
    const staged = await stageMigration(b.value, db), before = f.metrics();
    await assert.rejects(activateDevMigration(b.value, db, { async authorize() { throw Error('OPERATOR_GATE_DENIED'); } }, {}, null), /DENIED/);
    assert.equal(f.metrics().httpRequests, before.httpRequests);
    const gate = { async authorize() {} };
    await assert.rejects(activateDevMigration(b.value, db, gate, {}, null), /TRAINER_CREDENTIAL_REQUIRED/);
    await assert.rejects(activateDevMigration(b.value, db, gate, { [b.mail]: 'synthetic-dev-password' }, 'stale-pointer'), /CONFLICT/);
    assert.equal(f.metrics().attemptedWrites, before.attemptedWrites);
    const result = await activateDevMigration(b.value, db, gate, { [b.mail]: 'synthetic-dev-password' }, null);
    assert.equal(result.status, 'activated');
    const profile = (await new NativeAggregates(db, staged.namespace).read<Profile>({ kind: 'profile', id: b.mail }))!.data;
    assert.ok(await passwordMatches('synthetic-dev-password', profile.pwd!));
    assert.deepEqual({ ...profile, pwd: undefined }, { ...b.value.users[0].profile, pwd: undefined });
    assert.equal((await db.get(staged.namespace))!.data.active, true);
    assert.equal((await db.get('pgt_v2/control'))!.data.namespace, staged.namespace);
    const activated = f.metrics();
    assert.equal((await activateDevMigration(b.value, db, gate, {}, null)).status, 'already-active');
    assert.equal(f.metrics().attemptedWrites, activated.attemptedWrites);
    await assert.rejects(stageMigration(b.value, db), /STAGING_CONFLICT/);
});
test('An unbudgeted activation cannot make even one Firestore request', async () => {
    const f = await structuredFixture(), db = new NativeFirestore(f.env, f.transport), b = bundle();
    await assert.rejects(activateDevMigration(b.value, db, { async authorize() {} }, { [b.mail]: 'synthetic-dev-password' }, null), /NOT_AUTHORIZED/);
    assert.equal(f.metrics().httpRequests, 0);
});

test('Private runner budgets staging and activation through the same durable ledger and requires a maintenance gate', async () => {
    const f = await structuredFixture(), b = bundle(), data = new Map<string, unknown>();
    let queue: Promise<unknown> = Promise.resolve();
    const kv: BudgetKV = { async get<T>(k: string) { return structuredClone(data.get(k)) as T | undefined; }, async put(k, v) { data.set(k, structuredClone(v)); } };
    const storage: BudgetStorage = { transaction<T>(fn: (s: BudgetKV) => Promise<T>) { const r = queue.then(() => fn(kv)); queue = r.catch(() => {}); return r; } };
    const grant = { project: 'pgt-bjj-dev' as const, runId: crypto.randomUUID(), checksum: b.value.checksum, observedAt: Date.now(), expiresAt: Date.now() + 60000,
        remaining: { reads: 2000, writes: 2000, deletes: 100 }, reserve: { reads: 500, writes: 500, deletes: 100 }, limits: { reads: 500, writes: 500, deletes: 0 } };
    const input = { bundle: b.value, storage, grant, env: f.env, transport: f.transport };
    const staged = await runDevMigration({ ...input, action: { kind: 'stage' } });
    assert.equal(staged.result.status, 'verified-staging');
    const before = f.metrics();
    await assert.rejects(runDevMigration({ ...input, action: { kind: 'activate', credentials: { [b.mail]: 'independent-dev-password' }, expectedPointer: null,
        gate: { async authorize() { throw Error('MAINTENANCE_REQUIRED'); } } } }), /MAINTENANCE_REQUIRED/);
    assert.equal(f.metrics().httpRequests, before.httpRequests);
    let calls = 0;
    const activated = await runDevMigration({ ...input, action: { kind: 'activate', credentials: { [b.mail]: 'independent-dev-password' }, expectedPointer: null,
        gate: { async authorize() { calls++; } } } });
    assert.equal(activated.result.status, 'activated'); assert.equal(calls, 2);
    assert.ok(activated.budget.spent.reads >= f.metrics().estimatedReads);
    assert.equal(activated.budget.spent.writes, f.metrics().attemptedWrites);
});
