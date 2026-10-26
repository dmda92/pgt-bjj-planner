import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { decryptPackage } from '../tools/migration/private-package.ts';
import { verifyBundle } from '../tools/migration/convert.ts';
import { LocalMigrationLedger } from '../tools/migration/local-ledger.ts';
import { MigrationBudget } from '../tools/migration/budget.ts';
import { runDevMigration } from '../tools/migration/run-dev.ts';
import { NativeFirestore } from '../worker/structured/firestore.ts';
import { FirestoreUsage } from '../worker/structured/usage.ts';
import { FirestoreIdentity, DEV_DATABASE_NAME } from '../worker/firestore-auth.ts';
import { budgetedFirestoreRequest } from '../worker/structured/execution-budget.ts';

// Local operator only: never bundled into the Worker or called by CI push.
const [action, directory] = process.argv.slice(2);
async function main() {
    if (!['plan', 'indexes-check', 'stage', 'activate'].includes(action) || !directory) throw Error('MIGRATION_RUNNER_ARGUMENTS');
    const root = fs.realpathSync(directory), workspace = fs.realpathSync(new URL('..', import.meta.url));
    const rel = path.relative(workspace, root);
    if (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep)) throw Error('MIGRATION_PRIVATE_PATH_MUST_BE_OUTSIDE_REPOSITORY');
    const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
    const bundle = decryptPackage(read('bundle.enc.json'), fs.readFileSync(path.join(root, 'key.bin')));
    verifyBundle(bundle);
    if (bundle.target !== 'pgt-bjj-dev' || !bundle.ready) throw Error('MIGRATION_SOURCE_REQUIRES_REVIEW');
    const writeNew = (name, data) => fs.writeFileSync(path.join(root, name), JSON.stringify(data, null, 2), { flag: 'wx', mode: 0o600 });
    if (action === 'plan') {
        // Real source data stays in this private process. No network transport.
        const { structuredFixture } = await import('../tests/structured-firestore-fixture.ts');
        const { stageMigration } = await import('../tools/migration/stage.ts');
        const { activateDevMigration } = await import('../tools/migration/activate.ts');
        const fixture = await structuredFixture(), usage = new FirestoreUsage({ reads: 40000, writes: 15000, deletes: 0 });
        const db = new NativeFirestore(fixture.env, fixture.transport, usage);
        const credentialFile = path.join(root, 'dev-credentials.json');
        if (!fs.existsSync(credentialFile)) writeNew('dev-credentials.json', Object.fromEntries(bundle.users.map(u => [u.profile.mail, randomBytes(24).toString('base64url')])));
        const credentials = read('dev-credentials.json');
        await stageMigration(bundle, db);
        await activateDevMigration(bundle, db, { async authorize() {} }, credentials, null);
        const report = { status: 'OFFLINE_SIMULATION_ONLY', sourceCommit: bundle.source.commit, checksum: bundle.checksum,
            users: bundle.users.length, trainers: bundle.users.filter(u => u.profile.perfil === 'entrenador').length,
            plans: bundle.plans.length, estimates: usage.totals,
            suggestedLimits: { reads: Math.ceil(usage.totals.estimatedReads * 1.25) + 50,
                writes: Math.ceil(usage.totals.attemptedWrites * 1.25) + 50, deletes: 0 } };
        writeNew('plan.json', report); console.log(JSON.stringify(report)); return;
    }
    // Credentials are supplied by file path, never copied into this repository.
    const settings = read('operator.json');
    const env = { FIRESTORE_PROJECT_ID: 'pgt-bjj-dev', FIRESTORE_DATABASE_ID: '(default)',
        FIRESTORE_SERVICE_ACCOUNT_JSON: fs.readFileSync(settings.serviceAccountFile, 'utf8') };
    const identity = new FirestoreIdentity(env.FIRESTORE_SERVICE_ACCOUNT_JSON);
    const collections = ['aggregates', 'plans', 'blocks', 'operations'];
    const verifyIndexes = async () => {
        for (const collection of collections) {
            const response = await fetch('https://firestore.googleapis.com/v1/' + DEV_DATABASE_NAME + '/collectionGroups/' + collection + '/fields/*',
                { headers: { Authorization: 'Bearer ' + await identity.token() }, redirect: 'error', signal: AbortSignal.timeout(15000) });
            if (response.status === 403) {
                // Least-privilege data identities cannot always read Admin fields.
                // Accept an explicit local operator attestation from the console;
                // never grant the runtime additional IAM just to inspect indexes.
                const filename = path.join(root, 'index-evidence.json');
                if (!fs.existsSync(filename)) throw Error('MIGRATION_OPERATOR_INDEX_EVIDENCE_REQUIRED');
                const evidence = read('index-evidence.json');
                if (evidence.project !== 'pgt-bjj-dev' || evidence.database !== '(default)' ||
                    evidence.source !== 'owner-firebase-console' || evidence.allFieldsExempt !== true ||
                    !Number.isFinite(evidence.observedAt) || evidence.observedAt > Date.now() || Date.now() - evidence.observedAt > 86400000 ||
                    JSON.stringify([...evidence.collectionGroups].sort()) !== JSON.stringify([...collections].sort()))
                    throw Error('MIGRATION_OPERATOR_INDEX_EVIDENCE_INVALID');
                return;
            }
            if (!response.ok) throw Error('MIGRATION_INDEX_VERIFICATION_HTTP_' + response.status);
            const field = await response.json();
            if (!field.indexConfig || field.indexConfig.usesAncestorConfig || field.indexConfig.reverting || field.indexConfig.indexes?.length)
                throw Error('MIGRATION_INDEX_EXEMPTIONS_REQUIRED');
        }
    };
    await verifyIndexes();
    if (action === 'indexes-check') { console.log('MIGRATION_DEV_INDEX_EXEMPTIONS_VERIFIED'); return; }
    if (!/^[a-f0-9]{40}$/.test(settings.expectedBuild || '')) throw Error('MIGRATION_DEV_BUILD_REQUIRED');
    const grant = read('grant.json'), plan = read('plan.json');
    if (grant.checksum !== bundle.checksum || plan.checksum !== bundle.checksum) throw Error('MIGRATION_GRANT_TARGET_MISMATCH');
    // One stable destination ledger across capture directories and invocations.
    const storage = new LocalMigrationLedger(path.join(path.dirname(root), 'pgt-bjj-dev-ledger.sqlite'));
    try {
        const ledger = new MigrationBudget(storage, grant); await ledger.open();
        const raw = (url, init = {}) => fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) });
        const bounded = (url, init = {}) => url.startsWith('https://firestore.googleapis.com/') ?
            budgetedFirestoreRequest(ledger, 'scenario', url, init, raw) : raw(url, init);
        const db = new NativeFirestore(env, bounded, new FirestoreUsage(grant.limits));
        const maintenance = { async authorize(checksum, namespace) {
            await ledger.authorize(checksum, namespace);
            const response = await fetch('https://pgt-github-probe-dev.david-dzm5.workers.dev/api/dev/runtime',
                { cache: 'no-store', signal: AbortSignal.timeout(15000) });
            const runtime = await response.json();
            if (!response.ok || runtime.project !== 'pgt-bjj-dev' || runtime.build !== settings.expectedBuild ||
                runtime.domainBuild !== settings.expectedBuild || response.headers.get('X-PGT-Worker-Build') !== settings.expectedBuild ||
                runtime.revision !== 'firestore-v2-20261026') throw Error('MIGRATION_DEV_RUNTIME_MISMATCH');
            // First activation only. Existing active datasets require a separate
            // maintenance procedure; a file flag cannot claim writers are drained.
            if (await db.get('pgt_v2/control', true)) throw Error('MIGRATION_EXISTING_ACTIVE_DATASET_REQUIRES_MAINTENANCE');
        } };
        await maintenance.authorize(bundle.checksum, 'pgt_v2/import-' + bundle.checksum.slice(0, 24));
        const result = await runDevMigration({ bundle, grant, storage, env, transport: raw,
            action: action === 'stage' ? { kind: 'stage' } : { kind: 'activate', gate: maintenance,
                credentials: read('dev-credentials.json'), expectedPointer: null } });
        // Detailed ledger contains only accounting metadata, never business content.
        writeNew(action + '-result-' + Date.now() + '.json', result);
        console.log(JSON.stringify({ status: result.result.status, spent: result.budget.spent, http: result.budget.http,
            users: bundle.users.length, plans: bundle.plans.length }));
    } finally { storage.close(); }
}
main().catch(error => {
    console.error(error instanceof Error && /^MIGRATION_[A-Z0-9_]+$/.test(error.message) ? error.message : 'MIGRATION_OPERATOR_FAILED');
    process.exitCode = 1;
});
