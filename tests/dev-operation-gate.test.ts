import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Node runtime module; deliberately shared with manual scripts.
import {checkDevOperationGate} from '../scripts/dev-operation-gate.mjs';

const now = Date.now(), evidence = {
    project: 'pgt-bjj-dev',
    observedAt: new Date(now).toISOString(),
    source: 'cloud-firestore-api-quota-current-period',
    used: {reads: 1000, writes: 500, deletes: 500}
};
const plan = {
    project: 'pgt-bjj-dev',
    build: 'local-build',
    measuredLocally: true,
    includesCleanup: true,
    total: {reads: 180, writes: 40, deletes: 40},
    users: 1,
    realExecutionsForBuild: 0
};
test('Unknown, stale, near-limit quotas, oversized plans and repeated live execution fail closed', () => {
    const opts = {now, build: plan.build};
    assert.equal(checkDevOperationGate(evidence, plan, opts).reads, 200);
    assert.equal(checkDevOperationGate(evidence, {...plan, total: {...plan.total, writes: 150}}, opts).writes, 150);
    for (const e of [undefined, {...evidence, project: 'pgt-bjj-pro'}, {
        ...evidence,
        observedAt: new Date(now - 11 * 60000).toISOString()
    }, {
        ...evidence,
        used: {...evidence.used, reads: 44000}
    }]) assert.throws(() => checkDevOperationGate(e, plan, opts));
    for (const p of [{...plan, users: 3}, {...plan, total: {...plan.total, writes: 151}}, {
        ...plan,
        realExecutionsForBuild: 1
    }, {...plan, includesCleanup: false}]) assert.throws(() => checkDevOperationGate(evidence, p, opts));
});

test('Historical full-database procedures and full real suite refuse execution before any fetch', async () => {
    const original = globalThis.fetch, local = process.env.PGT_LOCAL_QA_ORIGIN;
    let calls = 0;
    globalThis.fetch = async () => {
        calls++;
        throw Error('UNEXPECTED_REAL_HTTP');
    };
    delete process.env.PGT_LOCAL_QA_ORIGIN;
    try {
        for (const file of ['prepare-structured-dev.mjs', 'verify-structured-dev.mjs', 'test-firestore-dev-live.mjs'])
            await assert.rejects(import('../scripts/' + file), /WHOLE_DATABASE_QA_PROCEDURE_DISABLED|FULL_SUITE_ISOLATED_ONLY/);
        assert.equal(calls, 0);
    } finally {
        globalThis.fetch = original;
        if (local !== undefined) process.env.PGT_LOCAL_QA_ORIGIN = local;
    }
});
