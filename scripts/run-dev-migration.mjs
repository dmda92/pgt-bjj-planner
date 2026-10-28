import {verifyProductionConversion} from '../tools/migration/source-integrity.ts';
import {firestoreTargetPreflight} from '../worker/firestore-preflight.ts';
import {privateLocation} from '../tools/migration/private-path.ts';
import {simulateMigrationPlan} from '../tools/migration/offline-plan.ts';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { decryptPackage } from '../tools/migration/private-package.ts';
import { verifyBundle } from '../tools/migration/convert.ts';
import { LocalMigrationLedger } from '../tools/migration/local-ledger.ts';
import { MigrationBudget } from '../tools/migration/budget.ts';
import { verifyProductionAuthorization, assertInitialDestination } from '../tools/migration/production-policy.ts';
import { verifyStagedMigration } from '../tools/migration/stage.ts';
import { resolveFirestoreTarget } from '../worker/firestore-target.ts';
import { runDevMigration } from '../tools/migration/run-dev.ts';
import { NativeFirestore } from '../worker/structured/firestore.ts';
import { FirestoreUsage } from '../worker/structured/usage.ts';
import { FirestoreIdentity } from '../worker/firestore-auth.ts';
import { budgetedFirestoreRequest } from '../worker/structured/execution-budget.ts';

// Local operator only: never bundled into the Worker or called by CI push.
const [action, directory, ...extra] = process.argv.slice(2);
const project = extra.length === 0 ? 'pgt-bjj-dev' : extra.length === 2 && extra[0] === '--target' && ['pgt-bjj-dev', 'pgt-bjj-pro'].includes(extra[1]) ? extra[1] : null;
async function main() {
    if (!['plan', 'metadata-check', 'indexes-check', 'destination-check', 'verify', 'stage', 'activate'].includes(action) || !directory || !project) throw Error('MIGRATION_RUNNER_ARGUMENTS');
    const workspace = fs.realpathSync(new URL('..', import.meta.url)), root = privateLocation(directory, workspace);
    const rel = path.relative(workspace, root);
    if (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep)) throw Error('MIGRATION_PRIVATE_PATH_MUST_BE_OUTSIDE_REPOSITORY');
    const read = name => JSON.parse(fs.readFileSync(privateLocation(path.join(root, name), workspace), 'utf8'));
    const bundle = decryptPackage(read('bundle.enc.json'), fs.readFileSync(privateLocation(path.join(root, 'key.bin'), workspace)));
    verifyBundle(bundle);
    if (project === 'pgt-bjj-pro') verifyProductionConversion(decryptPackage(read('source.enc.json'), fs.readFileSync(privateLocation(path.join(root, 'key.bin'), workspace))), bundle, bundle.approvedCorrections ? read('corrections.json') : undefined);
    if (bundle.target !== project) throw Error('MIGRATION_OPERATOR_TARGET_MISMATCH');
    if (!bundle.ready && !['plan','metadata-check'].includes(action)) throw Error('MIGRATION_SOURCE_REQUIRES_REVIEW');
    const writeNew = (name, data) => fs.writeFileSync(path.join(root, name), JSON.stringify(data, null, 2), { flag: 'wx', mode: 0o600 });
    if (action === 'plan') {
        if (!bundle.ready) {
            const report = { status: 'BLOCKED_OFFLINE_NO_NETWORK', project, database: '(default)', sourceCommit: bundle.source.commit, checksum: bundle.checksum,
                users: bundle.users.length, plans: bundle.plans.length, issues: bundle.issues.map(i => ({ code: i.code, file: i.file, blocking: i.blocking })),
                estimates: null, reason: 'Conversion requires explicit review; no repaired dataset was staged or simulated.' };
            writeNew('plan-blocked.json', report); console.log(JSON.stringify(report)); return;
        }
        // Real source data stays in this private process. No network transport.
        const { structuredFixture } = await import('../tests/structured-firestore-fixture.ts');
        const { proMigrationFixture } = await import('../tests/pro-migration-fixture.ts');
        const fixture = await (project === 'pgt-bjj-pro' ? proMigrationFixture() : structuredFixture());
        const credentialFile = path.join(root, 'dev-credentials.json');
        if (project === 'pgt-bjj-dev' && !fs.existsSync(credentialFile)) writeNew('dev-credentials.json', Object.fromEntries(bundle.users.map(u => [u.profile.mail, randomBytes(24).toString('base64url')])));
        const credentials = project === 'pgt-bjj-dev' ? read('dev-credentials.json') : {};
        const result = await simulateMigrationPlan(bundle, fixture.env, fixture.transport, credentials);
        const report = { status: 'OFFLINE_SIMULATION_ONLY', project, database: '(default)', sourceCommit: bundle.source.commit, checksum: bundle.checksum,
            users: bundle.users.length, trainers: bundle.users.filter(u => u.profile.perfil === 'entrenador').length, plans: bundle.plans.length, ...result };
        writeNew('plan.json', report); console.log(JSON.stringify(report)); return;
    }
    // Credentials are supplied by file path, never copied into this repository.
    const settings = read('operator.json');
    if (settings.project !== project || settings.database !== '(default)') throw Error('MIGRATION_OPERATOR_TARGET_MISMATCH');
    const env = { FIRESTORE_ENVIRONMENT: project === 'pgt-bjj-pro' ? 'pro' : 'dev',
        FIRESTORE_SERVICE_ACCOUNT_EMAIL: settings.serviceAccountEmail, FIRESTORE_PROJECT_ID: project, FIRESTORE_DATABASE_ID: '(default)',
        FIRESTORE_SERVICE_ACCOUNT_JSON: fs.readFileSync(privateLocation(settings.serviceAccountFile, workspace), 'utf8') };
    const target = resolveFirestoreTarget(env);
    const metadata = await firestoreTargetPreflight(env);
    if (action === 'metadata-check') { writeNew('metadata-check-' + Date.now() + '.json', metadata); console.log(JSON.stringify(metadata)); return; }
    const identity = new FirestoreIdentity(env.FIRESTORE_SERVICE_ACCOUNT_JSON, undefined, undefined, target);
    const collections = ['aggregates', 'plans', 'blocks', 'operations'];
    const verifyIndexes = async () => {
        for (const collection of collections) {
            const response = await fetch('https://firestore.googleapis.com/v1/' + target.databaseName + '/collectionGroups/' + collection + '/fields/*',
                { headers: { Authorization: 'Bearer ' + await identity.token() }, redirect: 'error', signal: AbortSignal.timeout(15000) });
            if (response.status === 403) {
                // Least-privilege data identities cannot always read Admin fields.
                // Accept an explicit local operator attestation from the console;
                // never grant the runtime additional IAM just to inspect indexes.
                const filename = path.join(root, 'index-evidence.json');
                if (!fs.existsSync(filename)) throw Error('MIGRATION_OPERATOR_INDEX_EVIDENCE_REQUIRED');
                const evidence = read('index-evidence.json');
                if (evidence.project !== project || evidence.database !== '(default)' ||
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
    if (action === 'indexes-check') { console.log('MIGRATION_INDEX_EXEMPTIONS_VERIFIED'); return; }
    if (project === 'pgt-bjj-dev' && !/^[a-f0-9]{40}$/.test(settings.expectedBuild || '')) throw Error('MIGRATION_DEV_BUILD_REQUIRED');
    const grant = read('grant.json'), plan = read('plan.json');
    if (grant.project !== project || grant.checksum !== bundle.checksum || plan.project !== project || plan.checksum !== bundle.checksum) throw Error('MIGRATION_GRANT_TARGET_MISMATCH');
    // One stable destination ledger across capture directories and invocations.
    const storage = new LocalMigrationLedger(path.join(path.dirname(root), project + '-ledger.sqlite'));
    try {
        const ledger = new MigrationBudget(storage, grant); await ledger.open();
        const raw = (url, init = {}) => fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) });
        const bounded = (url, init = {}) => url.startsWith('https://firestore.googleapis.com/') ?
            budgetedFirestoreRequest(ledger, 'scenario', url, init, raw) : raw(url, init);
        const db = new NativeFirestore(env, bounded, new FirestoreUsage(grant.limits));
        if (action === 'destination-check') {
            const result = await assertInitialDestination(db, bundle);
            writeNew('destination-check-' + Date.now() + '.json', { project, database: '(default)', checksum: bundle.checksum, sourceCommit: bundle.source.commit, result });
            console.log(JSON.stringify({ project, ...result })); return;
        }
        if (action === 'verify') {
            const result = await verifyStagedMigration(bundle, db);
            writeNew('verify-' + Date.now() + '.json', { result, project, sourceCommit: bundle.source.commit, checksum: bundle.checksum, budget: await ledger.status() });
            console.log(JSON.stringify(result)); return;
        }
        const authorization = project === 'pgt-bjj-pro' ? read('production-authorization.json') : undefined;
        if (project === 'pgt-bjj-pro') verifyProductionAuthorization(authorization, bundle);
        const maintenance = { async authorize(checksum, namespace) {
            await ledger.authorize(checksum, namespace);
            if (project === 'pgt-bjj-pro') {
                verifyProductionAuthorization(authorization, bundle);
                await assertInitialDestination(db, bundle);
                return;
            }
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
        const result = await runDevMigration({ bundle, grant, storage, env, transport: raw, productionAuthorization: authorization,
            action: action === 'stage' ? { kind: 'stage' } : { kind: 'activate', gate: maintenance,
                credentials: project === 'pgt-bjj-dev' ? read('dev-credentials.json') : {}, expectedPointer: null } });
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
