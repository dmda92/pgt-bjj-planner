import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractGithubSnapshot, snapshotFromFiles, blobSha, validateSnapshot } from '../tools/migration/github-source.ts';
import { convertSnapshot, verifyBundle } from '../tools/migration/convert.ts';
import { decodePlan } from '../src/infrastructure/plan-codec.ts';
import { template } from './template-fixture.ts';
import { cloneTemplate, initialVersion, type TrainingPlan } from '../src/domain/models.ts';
const commit = 'a'.repeat(40), tree = 'b'.repeat(40);
function source() {
    const p = JSON.parse(readFileSync(new URL('./fixtures/firestore/domain-baseline.json', import.meta.url), 'utf8')).fixtures[0].expected.generated as TrainingPlan;
    const owner = p.mail, root = 'PGT/users_data/' + owner + '/', profile = { ...initialVersion(), mail: owner, nombre: 'Synthetic', apellidos: 'Migration',
        fecha_nacimiento: null, peso: 70.125, cinturon: 'Blanco', perfil: 'entrenador', pwd: 'pbkdf2-sha256$600000$synthetic-salt$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
    const catalog = { ...initialVersion(), plans: [{ ...p, alumnos: [owner] }], deletedPlanIds: [] };
    const entries = [['PGT/master_data/tecnics_base.json', template], ['PGT/master_data/plans.json', catalog], [root + 'user_data.json', profile],
        [root + 'tecnics.json', cloneTemplate(template)], [root + 'trainer_comments.json', { ...initialVersion(), comments: [] }],
        [root + 'plans_index.json', { ...initialVersion(), planIds: [p.planId], deletedPlanIds: [] }], [root + 'training_plans/plan_' + p.planId + '.json', p]];
    return { p, snapshot: snapshotFromFiles(commit, tree, entries.map(([path, data]) => ({ path: String(path), content: JSON.stringify(data) }))) };
}
test('GitHub extraction pins every file to the commit tree and uses GET only, with redirects disabled', async () => {
    const { snapshot } = source(), calls: {
        url: string;
        init: RequestInit;
    }[] = [];
    const captured = await extractGithubSnapshot({ commit, token: 'synthetic-read-only', clock: () => new Date(snapshot.capturedAt), transport: async (url, init) => {
            calls.push({ url, init });
            assert.equal(init.method, 'GET');
            assert.equal(init.redirect, 'manual');
            if (url.endsWith('/git/commits/' + commit))
                return Response.json({ sha: commit, tree: { sha: tree } });
            if (url.includes('/git/trees/'))
                return Response.json({ sha: tree, truncated: false, tree: snapshot.files.map(f => ({ path: f.path, type: 'blob', mode: '100644', sha: f.blob, size: f.bytes })) });
            const file = snapshot.files.find(f => url.endsWith('/git/blobs/' + f.blob));
            assert.ok(file);
            return Response.json({ sha: file.blob, encoding: 'base64', size: file.bytes, content: Buffer.from(file.content).toString('base64') });
        } });
    assert.deepEqual(captured, snapshot);
    assert.equal(calls.length, snapshot.files.length + 2);
    assert.ok(calls.every(c => c.url.startsWith('https://api.github.com/repos/dmda92/pgt-bjj-data/git/')));
});
test('Truncated trees and unclassified paths stop before downloading business files', async () => {
    for (const unsafe of ['truncated', 'unknown']) {
        let requests = 0;
        await assert.rejects(extractGithubSnapshot({ commit, token: 'synthetic', transport: async () => {
                requests++;
                if (requests === 1)
                    return Response.json({ sha: commit, tree: { sha: tree } });
                return Response.json({ sha: tree, truncated: unsafe === 'truncated', tree: [{ path: 'PGT/arbitrary.json', sha: commit, type: 'blob', mode: '100644' }] });
            } }), /TREE_INCOMPLETE|PATH_NOT_CLASSIFIED/);
        assert.equal(requests, 2);
    }
});
test('Blob/manifests reject tampering and duplicate paths without exposing content', () => {
    const { snapshot } = source(), corrupt = structuredClone(snapshot);
    corrupt.files[0].content += ' ';
    assert.throws(() => validateSnapshot(corrupt), /INTEGRITY/);
    assert.throws(() => snapshotFromFiles(commit, tree, [...snapshot.files, ...snapshot.files]), /DUPLICATE/);
    assert.equal(blobSha('hello'), 'b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0');
});
test('DEV conversion preserves business records and plans but cannot copy production password hashes', () => {
    const { snapshot, p } = source(), before = structuredClone(snapshot), bundle = convertSnapshot(snapshot, 'pgt-bjj-dev');
    assert.equal(bundle.ready, true);
    verifyBundle(bundle);
    assert.deepEqual(decodePlan(bundle.plans[0].plan), p);
    assert.deepEqual(bundle.users[0].credential, { state: 'requires-dev-password' });
    assert.ok(!JSON.stringify(bundle).includes('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='));
    assert.deepEqual(snapshot, before);
    assert.deepEqual(convertSnapshot(snapshot, 'pgt-bjj-dev'), bundle);
});
test('Future PRO conversion preserves compatible hashes without sessions or tokens', () => {
    const { snapshot, p } = source(), bundle = convertSnapshot(snapshot, 'pgt-bjj-pro');
    assert.equal(bundle.ready, true);
    assert.deepEqual(bundle.users[0].credential, { state: 'imported', passwordHash: 'pbkdf2-sha256$600000$synthetic-salt$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' });
    assert.deepEqual(decodePlan(bundle.plans[0].plan), p);
    const corrupted = structuredClone(bundle);
    corrupted.users[0].profile.nombre = 'Changed';
    assert.throws(() => verifyBundle(corrupted), /INTEGRITY/);
});
test('Missing assignment plans are recoverable; orphan stored plans block activation rather than disappear', () => {
    const { snapshot, p } = source(), files = snapshot.files.filter(f => !f.path.endsWith('/training_plans/plan_' + p.planId + '.json'));
    const missing = convertSnapshot(snapshotFromFiles(commit, tree, files), 'pgt-bjj-dev');
    assert.ok(missing.issues.some(i => i.code === 'ASSIGNED_PLAN_MISSING' && !i.blocking));
    assert.equal(missing.ready, true);
    const changed = snapshot.files.map(f => f.path === 'PGT/master_data/plans.json' ? { ...f, content: JSON.stringify({ ...initialVersion(), plans: [], deletedPlanIds: [] }) } : f);
    const orphan = convertSnapshot(snapshotFromFiles(commit, tree, changed), 'pgt-bjj-dev');
    assert.equal(orphan.ready, false);
    assert.equal(orphan.plans.length, 1);
    assert.ok(orphan.issues.some(i => i.code === 'STORED_PLAN_NOT_ASSIGNED'));
});
test('Private migration packages authenticate content and never expose credentials in plaintext', async () => {
    const { encryptPackage, decryptPackage } = await import('../tools/migration/private-package.ts'), key = new Uint8Array(32).fill(7), { snapshot } = source();
    const pack = encryptPackage(snapshot, key);
    assert.ok(!JSON.stringify(pack).includes('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='));
    assert.deepEqual(decryptPackage(pack, key), snapshot);
    assert.throws(() => decryptPackage(pack, new Uint8Array(32).fill(8)), /AUTHENTICATION/);
    pack.ciphertext = 'AA' + pack.ciphertext.slice(2);
    assert.throws(() => decryptPackage(pack, key), /AUTHENTICATION/);
});

test('Stale derived assignment indexes follow the catalog without changing source or saved plans', () => {
    const { snapshot, p } = source(), removed = 'c'.repeat(8) + '-cccc-cccc-cccc-' + 'c'.repeat(12);
    const files = snapshot.files.map(f => f.path.endsWith('/plans_index.json') ? { ...f,
        content: JSON.stringify({ ...initialVersion(), planIds: [removed], deletedPlanIds: [p.planId, removed] }) } : f);
    const captured = snapshotFromFiles(commit, tree, files), before = structuredClone(captured);
    const result = convertSnapshot(captured, 'pgt-bjj-dev');
    assert.equal(result.ready, true);
    assert.deepEqual(result.users[0].index!.planIds, [p.planId]);
    assert.deepEqual(result.users[0].index!.deletedPlanIds, [removed]);
    assert.ok(result.issues.some(i => i.code === 'ASSIGNMENT_INDEX_REBUILT' && !i.blocking));
    assert.deepEqual(decodePlan(result.plans[0].plan), p);
    assert.deepEqual(captured, before);
});
