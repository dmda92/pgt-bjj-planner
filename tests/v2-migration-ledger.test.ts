import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalMigrationLedger } from '../tools/migration/local-ledger.ts';
import { MigrationBudget, type MigrationGrant } from '../tools/migration/budget.ts';

test('Local SQLite migration ledger survives restart, rolls back and shares the quota across connections', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pgt-ledger-')), filename = join(root, 'ledger.sqlite');
    const grant: MigrationGrant = { project: 'pgt-bjj-dev', runId: crypto.randomUUID(), checksum: 'a'.repeat(64),
        observedAt: Date.now(), expiresAt: Date.now() + 60000, remaining: { reads: 100, writes: 100, deletes: 0 },
        reserve: { reads: 10, writes: 10, deletes: 0 }, limits: { reads: 2, writes: 2, deletes: 0 } };
    let ledger = new LocalMigrationLedger(filename);
    try {
        const first = new MigrationBudget(ledger, grant); await first.open();
        await first.budgetReserve('scenario', { writes: 2 }); ledger.close();
        ledger = new LocalMigrationLedger(filename);
        const resumed = new MigrationBudget(ledger, grant); await resumed.open();
        assert.equal((await resumed.status()).spent.writes, 2);
        await assert.rejects(resumed.budgetReserve('scenario', { writes: 1 }), /BUDGET_EXCEEDED/);
        await assert.rejects(ledger.transaction(async store => { await store.put('rollback', true); throw Error('rollback'); }));
        assert.equal(await ledger.transaction(store => store.get('rollback')), undefined);
        const other = new LocalMigrationLedger(filename);
        try {
            const second = new MigrationBudget(other, grant); await second.open();
            await Promise.all([second.budgetReserve('scenario', { reads: 1 }), resumed.budgetReserve('scenario', { reads: 1 })]);
            await assert.rejects(resumed.budgetReserve('scenario', { reads: 1 }), /BUDGET_EXCEEDED/);
        } finally { other.close(); }
    } finally { ledger.close(); rmSync(root, { recursive: true }); }
});
