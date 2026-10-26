import { NativeFirestore } from '../../worker/structured/firestore.ts';
import { FirestoreUsage } from '../../worker/structured/usage.ts';
import { budgetedFirestoreRequest, type BudgetStorage } from '../../worker/structured/execution-budget.ts';
import type { PreflightEnv } from '../../worker/firestore-preflight.ts';
import type { Transport } from '../../worker/firestore-auth.ts';
import { verifyBundle, type MigrationBundle } from './convert.ts';
import { stageMigration } from './stage.ts';
import { activateDevMigration, type ActivationGate } from './activate.ts';
import { MigrationBudget, type MigrationGrant } from './budget.ts';

/** Private operator entry. Not reachable from AppApi, CLI, ordinary user payloads
 * or CI push. The caller supplies shared durable coordination + explicit grant.
 * No default transport or implicit activation; GitHub is never contacted here.
 */
export async function runDevMigration(input: {
    bundle: MigrationBundle; grant: MigrationGrant; storage: BudgetStorage;
    env: PreflightEnv; transport: Transport;
    action: { kind: 'stage' } | { kind: 'activate'; gate: ActivationGate; credentials: Readonly<Record<string, string>>; expectedPointer: string | null };
}) {
    verifyBundle(input.bundle);
    if (input.bundle.target !== 'pgt-bjj-dev' || input.grant.checksum !== input.bundle.checksum) throw Error('MIGRATION_GRANT_TARGET_MISMATCH');
    const ledger = new MigrationBudget(input.storage, input.grant);
    await ledger.open();
    const transport: Transport = (url, init = {}) => url.startsWith('https://firestore.googleapis.com/') ?
        budgetedFirestoreRequest(ledger, 'scenario', url, init, input.transport) : input.transport(url, init);
    const db = new NativeFirestore(input.env, transport, new FirestoreUsage(input.grant.limits));
    const activation = input.action.kind === 'activate' ? input.action : undefined;
    const result = !activation ? await stageMigration(input.bundle, db) :
        await activateDevMigration(input.bundle, db, { async authorize(checksum, namespace) {
            await ledger.authorize(checksum, namespace);
            await activation.gate.authorize(checksum, namespace);
        } }, activation.credentials, activation.expectedPointer);
    return { result, budget: await ledger.status() };
}
