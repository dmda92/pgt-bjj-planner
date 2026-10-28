import type { BudgetStorage, BudgetEndpoint, BudgetReservation, Counts } from '../../worker/structured/execution-budget.ts';
import { blockDigest } from '../../src/infrastructure/native-packing.ts';

export type MigrationGrant = {
    project: 'pgt-bjj-dev' | 'pgt-bjj-pro'; runId: string; checksum: string;
    observedAt: number; expiresAt: number; remaining: Counts; reserve: Counts; limits: Counts;
};
type Ledger = { grant: MigrationGrant; grantHash: string; spent: Counts; http: number; closed: boolean };
const key = 'pgt-v2-private-migration-ledger';
const dims = ['reads', 'writes', 'deletes'] as const;

/** A single durable transactional storage MUST be shared by every executor for
 * the destination academy. This is independent of the 200/150/50 synthetic QA
 * allowance. Limits come from an explicit operator grant and recent quota evidence.
 * Reservations are charged in full before HTTP, including failures/lost ACKs.
 */
export class MigrationBudget implements BudgetEndpoint {
    private storage: BudgetStorage;
    private grant: MigrationGrant;
    constructor(storage: BudgetStorage, grant: MigrationGrant) { this.storage = storage; this.grant = structuredClone(grant); }
    get budgetProject() { return this.grant.project; }
    async open(now = Date.now()) {
        const g = this.grant;
        if (!['pgt-bjj-dev', 'pgt-bjj-pro'].includes(g.project) || !/^[a-f0-9]{64}$/.test(g.checksum) || !/^[a-f0-9-]{36}$/.test(g.runId) ||
            !Number.isFinite(g.observedAt) || g.observedAt > now || now - g.observedAt > 300000 ||
            !Number.isFinite(g.expiresAt) || g.expiresAt <= now || g.expiresAt > now + 1800000 ||
            dims.some(d => !Number.isSafeInteger(g.remaining[d]) || !Number.isSafeInteger(g.reserve[d]) || !Number.isSafeInteger(g.limits[d]) ||
                g.limits[d] < 0 || g.reserve[d] < 0 || g.remaining[d] < g.reserve[d] + g.limits[d])) throw Error('MIGRATION_QUOTA_GRANT_INVALID');
        await this.storage.transaction(async store => {
            const old = await store.get<Ledger>(key), grantHash = blockDigest(g);
            if (old?.grant.runId === g.runId) {
                if (old.grantHash !== grantHash || old.closed) throw Error('MIGRATION_GRANT_CONFLICT');
                return;
            }
            // Wait beyond every possible in-flight request timeout before takeover.
            if (old && now <= old.grant.expiresAt + 60000) throw Error('MIGRATION_EXECUTOR_ALREADY_ACTIVE');
            await store.put(key, { grant: g, grantHash, spent: { reads: 0, writes: 0, deletes: 0 }, http: 0, closed: false } satisfies Ledger);
        });
    }
    async authorize(checksum: string, namespace: string) {
        if (checksum !== this.grant.checksum || namespace !== 'pgt_v2/import-' + checksum.slice(0, 24)) throw Error('MIGRATION_GRANT_TARGET_MISMATCH');
        await this.status();
    }
    async status() {
        return this.storage.transaction(async store => {
            const state = await store.get<Ledger>(key);
            if (!state || state.grantHash !== blockDigest(this.grant) || state.closed || Date.now() > state.grant.expiresAt)
                throw Error('MIGRATION_GRANT_INACTIVE');
            return structuredClone(state);
        });
    }
    async budgetReserve(phase: 'scenario' | 'cleanup', request: { reads?: number; writes?: number; deletes?: number; queryCeiling?: number }): Promise<BudgetReservation> {
        if (phase !== 'scenario' || Object.values(request).some(n => !Number.isSafeInteger(n) || n! < 0)) throw Error('MIGRATION_RESERVATION_INVALID');
        return this.storage.transaction(async store => {
            const state = await store.get<Ledger>(key);
            if (!state || state.closed || state.grantHash !== blockDigest(this.grant) || Date.now() > state.grant.expiresAt)
                throw Error('MIGRATION_GRANT_INACTIVE');
            const readLimit = request.queryCeiling === undefined ? undefined : Math.min(request.queryCeiling, state.grant.limits.reads - state.spent.reads);
            const cost = { reads: readLimit ?? request.reads ?? 0, writes: request.writes ?? 0, deletes: request.deletes ?? 0, http: 1, queries: readLimit === undefined ? 0 : 1 };
            if (readLimit === 0 || dims.some(d => state.spent[d] + cost[d] > state.grant.limits[d])) throw Error('MIGRATION_BUDGET_EXCEEDED');
            for (const d of dims) state.spent[d] += cost[d];
            state.http++;
            await store.put(key, state);
            return { id: crypto.randomUUID(), phase, cost, ...(readLimit === undefined ? {} : { readLimit }) };
        });
    }
    async budgetSettle(_id: string, _actualReads?: number, _uncertain?: boolean) { /* Never refund reservations. */ }
    async close() {
        await this.storage.transaction(async store => {
            const state = await store.get<Ledger>(key);
            if (!state || state.grantHash !== blockDigest(this.grant)) throw Error('MIGRATION_GRANT_INACTIVE');
            state.closed = true; await store.put(key, state);
        });
    }
}
