import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { snapshotFromFiles } from '../tools/migration/github-source.ts';
import { convertSnapshot } from '../tools/migration/convert.ts';
import { stageMigration } from '../tools/migration/stage.ts';
import { NativeFirestore } from '../worker/structured/firestore.ts';
import { FirestoreUsage } from '../worker/structured/usage.ts';
import { structuredFixture } from './structured-firestore-fixture.ts';
import { PlanRepository } from '../worker/v2/plans.ts';
import { cloneTemplate, initialVersion, type TrainingPlan } from '../src/domain/models.ts';
import { template } from './template-fixture.ts';
function bundle() {
    const p = JSON.parse(readFileSync(new URL('./fixtures/firestore/domain-baseline.json', import.meta.url), 'utf8')).fixtures[0].expected.generated as TrainingPlan;
    const root = 'PGT/users_data/' + p.mail + '/', entries: [
        string,
        unknown
    ][] = [
        ['PGT/master_data/tecnics_base.json', template], ['PGT/master_data/plans.json', { ...initialVersion(), plans: [p], deletedPlanIds: [] }],
        [root + 'user_data.json', { ...initialVersion(), mail: p.mail, nombre: 'Synthetic', apellidos: 'Stage', perfil: 'entrenador',
                cinturon: 'Blanco', peso: 80.125, fecha_nacimiento: null, pwd: 'pbkdf2-sha256$600000$salt$hash' }],
        [root + 'tecnics.json', cloneTemplate(template)], [root + 'trainer_comments.json', { ...initialVersion(), comments: [] }],
        [root + 'plans_index.json', { ...initialVersion(), planIds: [p.planId], deletedPlanIds: [] }], [root + 'training_plans/plan_' + p.planId + '.json', p]
    ];
    return { p, b: convertSnapshot(snapshotFromFiles('a'.repeat(40), 'b'.repeat(40), entries.map(([path, data]) => ({ path, content: JSON.stringify(data) }))), 'pgt-bjj-dev') };
}
test('Budgeted staging preserves source/old Firestore and verifies the entire new dataset without activating it', async () => {
    const { p, b } = bundle(), beforeBundle = structuredClone(b), f = await structuredFixture();
    const db = new NativeFirestore(f.env, f.transport, new FirestoreUsage({ reads: 300, writes: 300, deletes: 0 }));
    await db.commit([db.update('users/existing@example.test', { keep: 'untouched' }, null)]);
    const old = structuredClone([...f.docs.entries()]);
    const result = await stageMigration(b, db);
    assert.equal(result.active, false);
    assert.equal(result.status, 'verified-staging');
    for (const [id, value] of old)
        assert.deepEqual(f.docs.get(id), value);
    assert.deepEqual((await new PlanRepository(db, result.namespace).read(p.mail, p.planId))!.data, p);
    assert.deepEqual(b, beforeBundle);
    assert.equal(db.usage.totals.attemptedDeletes, 0);
    const count = f.metrics().attemptedWrites;
    assert.deepEqual(await stageMigration(b, db), result);
    assert.equal(f.metrics().attemptedWrites, count);
    assert.ok(!JSON.stringify([...f.docs.values()]).includes('pbkdf2-sha256$600000$salt$hash'));
});
test('Missing budget, invalid source and production targets are rejected before HTTP', async () => {
    const { b } = bundle(), f = await structuredFixture();
    await assert.rejects(stageMigration(b, new NativeFirestore(f.env, f.transport)), /BUDGET_REQUIRED/);
    const pro = { ...b, target: 'pgt-bjj-pro' };
    await assert.rejects(stageMigration(pro as typeof b, new NativeFirestore(f.env, f.transport)), /INTEGRITY/);
    assert.equal(f.metrics().httpRequests, 0);
});
test('An exhausted budget leaves staging inactive and can resume with a newly authorized budget', async () => {
    const { b } = bundle(), f = await structuredFixture();
    const limited = new NativeFirestore(f.env, f.transport, new FirestoreUsage({ reads: 300, writes: 3, deletes: 0 }));
    await assert.rejects(stageMigration(b, limited), /BUDGET_EXCEEDED/);
    for (const doc of f.docs.values())
        if (doc.fields.active)
            assert.equal(doc.fields.active.booleanValue, false);
    const resumed = await stageMigration(b, new NativeFirestore(f.env, f.transport, new FirestoreUsage({ reads: 300, writes: 300, deletes: 0 })));
    assert.equal(resumed.status, 'verified-staging');
});
