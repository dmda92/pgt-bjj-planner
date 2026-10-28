import type { MigrationBundle } from './convert.ts';
import type { PreflightEnv } from '../../worker/firestore-preflight.ts';
import type { Transport } from '../../worker/firestore-auth.ts';
import { NativeFirestore } from '../../worker/structured/firestore.ts';
import { FirestoreUsage } from '../../worker/structured/usage.ts';
import { budgetedFirestoreRequest, type BudgetStorage } from '../../worker/structured/execution-budget.ts';
import { MigrationBudget, type MigrationGrant } from './budget.ts';
import { assertInitialDestination } from './production-policy.ts';
import { stageMigration, verifyStagedMigration } from './stage.ts';
import { activateMigration } from './activate.ts';

/** Operator-only: the CLI supplies its synthetic transport, never live credentials.
 * Count both logical documents and the no-refund reservations actually enforced
 * by the production ledger. These are different numbers for paginated queries. */
export async function simulateMigrationPlan(bundle: MigrationBundle, env: PreflightEnv,
    syntheticTransport: Transport, credentials: Readonly<Record<string, string>>) {
    const entries = new Map<string, unknown>();
    const storage: BudgetStorage = { async transaction(fn) {
        return fn({ async get<T>(key: string) { return structuredClone(entries.get(key)) as T | undefined; },
            async put<T>(key: string, value: T) { entries.set(key, structuredClone(value)); } });
    } };
    const limits = { reads: 1_000_000, writes: 1_000_000, deletes: 0 };
    const grant: MigrationGrant = { project: bundle.target, runId: crypto.randomUUID(), checksum: bundle.checksum,
        observedAt: Date.now(), expiresAt: Date.now() + 1_800_000, remaining: limits,
        reserve: { reads: 0, writes: 0, deletes: 0 }, limits };
    const ledger = new MigrationBudget(storage, grant); await ledger.open();
    const transport: Transport = (url, init = {}) => url.startsWith('https://firestore.googleapis.com/')
        ? budgetedFirestoreRequest(ledger, 'scenario', url, init, syntheticTransport) : syntheticTransport(url, init);
    const usage = new FirestoreUsage(limits), db = new NativeFirestore(env, transport, usage);
    const gate = { async authorize(checksum: string, namespace: string) {
        await ledger.authorize(checksum, namespace);
        if (bundle.target === 'pgt-bjj-pro') await assertInitialDestination(db, bundle);
    } };
    const namespace = 'pgt_v2/import-' + bundle.checksum.slice(0, 24);
    // Mirror runner + library checks for the two separate real invocations.
    await gate.authorize(bundle.checksum, namespace);
    if (bundle.target === 'pgt-bjj-pro') await assertInitialDestination(db, bundle);
    await stageMigration(bundle, db);
    await gate.authorize(bundle.checksum, namespace);
    if (bundle.target === 'pgt-bjj-pro') await assertInitialDestination(db, bundle);
    await activateMigration(bundle, db, gate, credentials, null);
    await verifyStagedMigration(bundle, db);
    const reserved = (await ledger.status()).spent;
    return { estimates: usage.totals, ledgerReservations: reserved,
        suggestedLimits: { reads: Math.ceil(reserved.reads * 1.25) + 50,
            writes: Math.ceil(reserved.writes * 1.25) + 50, deletes: 0 },
        estimateScope: 'Synthetic runner and library initial checks, stage, activation and final deep verification; includes conservative no-refund query reservations. Excludes retries, separate operator diagnostics/index requests, concurrent traffic and billed index entries.' };
}
