import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MigrationBudget, type MigrationGrant } from '../tools/migration/budget.ts';
import { budgetedFirestoreRequest, type BudgetKV, type BudgetStorage } from '../worker/structured/execution-budget.ts';

function storage(): BudgetStorage {
    const entries = new Map<string, unknown>(); let queue: Promise<unknown> = Promise.resolve();
    const kv: BudgetKV = { async get<T>(k: string) { return structuredClone(entries.get(k)) as T | undefined; }, async put(k, v) { entries.set(k, structuredClone(v)); } };
    return { transaction<T>(fn: (store: BudgetKV) => Promise<T>) { const result = queue.then(() => fn(kv)); queue = result.catch(() => {}); return result; } };
}
function grant(): MigrationGrant {
    return { project: 'pgt-bjj-dev', runId: crypto.randomUUID(), checksum: 'a'.repeat(64), observedAt: Date.now(), expiresAt: Date.now() + 60000,
        remaining: { reads: 1000, writes: 1000, deletes: 100 }, reserve: { reads: 100, writes: 100, deletes: 100 }, limits: { reads: 5, writes: 4, deletes: 0 } };
}
test('All migration executors share reservations; failed/lost requests cannot refund the quota', async () => {
    const s = storage(), g = grant(), a = new MigrationBudget(s, g), b = new MigrationBudget(s, g);
    await a.open(); await b.open();
    await Promise.all([a.budgetReserve('scenario', { writes: 2 }), b.budgetReserve('scenario', { writes: 2 })]);
    await assert.rejects(a.budgetReserve('scenario', { writes: 1 }), /BUDGET_EXCEEDED/);
    let sent = 0;
    await assert.rejects(budgetedFirestoreRequest(a, 'scenario', 'https://firestore.googleapis.com/v1/projects/pgt-bjj-dev/databases/(default)/documents/x/y', {}, async () => { sent++; throw Error('lost'); }), /lost/);
    assert.equal(sent, 1); assert.equal((await b.status()).spent.reads, 1);
    await assert.rejects(new MigrationBudget(s, { ...g, runId: crypto.randomUUID() }).open(), /ALREADY_ACTIVE/);
    await assert.rejects(a.authorize('b'.repeat(64), 'pgt_v2/import-' + 'b'.repeat(24)), /TARGET_MISMATCH/);
});
test('Unknown/stale quota and invalid targets prevent any request or new grant', async () => {
    const s = storage(), g = grant();
    await assert.rejects(new MigrationBudget(s, { ...g, observedAt: Date.now() - 300001 }).open(), /QUOTA_GRANT_INVALID/);
    await assert.rejects(new MigrationBudget(s, { ...g, limits: { ...g.limits, reads: 10000 } }).open(), /QUOTA_GRANT_INVALID/);
    const a = new MigrationBudget(s, g); await a.open(); let sent = false;
    await assert.rejects(budgetedFirestoreRequest(a, 'scenario', 'https://firestore.googleapis.com/v1/projects/pgt-bjj-pro/databases/(default)/documents/x/y', {}, async () => { sent = true; return new Response(); }), /TARGET_INVALID/);
    assert.equal(sent, false); assert.equal((await a.status()).http, 0);
});
