import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {limitedRuntimePlugin, limitedOutbound} from '../tests/limited-cloudflare-runtime.mjs';
import {structuredFixture} from '../tests/structured-firestore-fixture.ts';
import {NativeFirestore, reference} from '../worker/structured/firestore.ts';

const f = await structuredFixture(), buildId = 'b'.repeat(40),
    origin = 'https://pgt-github-probe-dev.david-dzm5.workers.dev', outbound = limitedOutbound(f.transport);
const bundle = await build({
    plugins: [limitedRuntimePlugin],
    entryPoints: ['worker/dev.ts'],
    bundle: true,
    write: false,
    external: ['cloudflare:workers'],
    format: 'esm',
    target: 'es2022'
});
const runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-10-13',
    durableObjects: {
        SECURITY: {className: 'ProbeSecurity', useSQLite: true},
        DOMAIN_IO: {className: 'DomainIO', useSQLite: true}
    },
    bindings: {...f.env, DEV_BUILD_SHA: buildId, ALLOWED_ORIGINS: origin},
    outboundService: request => outbound.fetch(request)
}));

async function call(path, body, credential = 'synthetic-deployment-token') {
    const r = await runtime.dispatchFetch('http://localhost' + path, {
        method: 'POST',
        headers: {Origin: origin, Authorization: 'Bearer ' + credential, 'Content-Type': 'application/json'},
        body: JSON.stringify(body)
    });
    return {status: r.status, value: await r.json()};
}

try {
    const body = {
        quota: {
            project: 'pgt-bjj-dev',
            observedAt: new Date().toISOString(),
            source: 'cloud-firestore-api-quota-current-period',
            used: {reads: 100, writes: 100, deletes: 100}
        },
        plan: {
            project: 'pgt-bjj-dev',
            build: buildId,
            measuredLocally: true,
            includesCleanup: true,
            total: {reads: 200, writes: 150, deletes: 50},
            users: 1,
            realExecutionsForBuild: 0
        }
    };
    let before = f.calls.length;
    assert.equal((await call('/api/dev/budget-smoke', {...body, quota: {}})).status, 409);
    assert.equal(f.calls.length, before, 'Unknown quota must stop before Firestore');
    assert.equal((await call('/api/dev/budget-smoke', body, 'wrong-deployment-token')).status, 403);
    assert.equal(f.calls.length, before, 'Unauthenticated smoke must stop before Firestore');
    assert.equal((await call('/api/dev/budget-smoke', {
        ...body,
        quota: {...body.quota, used: {...body.quota.used, reads: 44000}}
    })).status, 409);
    assert.equal(f.calls.length, before, 'Near-limit quota must stop before Firestore');
    assert.equal((await call('/api/dev/structured-bootstrap', {})).status, 200);
    // Characterize the actual deployed legacy native catalogue layout too. All
    // writes below are isolated fixture setup, never Google/migration scripts.
    const db = new NativeFirestore(f.env, f.transport), root = await db.get('technique_catalog/original'),
        gen = root.data.activeRevision.split('/documents/')[1];
    await db.commit([...root.data.positions.map((p, ordinal) => db.update(gen + '/positions/' + p.id, {
        ...p,
        ordinal
    }, null)), db.update(root.path, {
        ...root.data,
        positions: undefined,
        activeRevision: reference(gen),
        entityCounts: {...root.data.entityCounts, positions: root.data.positions.length}
    }, root), db.update('unrelated/keep', {untouched: true}, null)]);
    const baseline = JSON.stringify([...f.docs]);
    const result = await call('/api/dev/budget-smoke', body);
    assert.equal(result.status, 200, JSON.stringify(result.value));
    assert.equal(result.value.status, 'DEV_MINIMAL_SMOKE_VERIFIED');
    assert.equal(result.value.cleanup.clean, true);
    assert.equal(result.value.budgetClosed, true);
    const {scenario, cleanup} = result.value.budget.spent;
    assert.ok(scenario.reads + cleanup.reads <= 200);
    assert.ok(scenario.writes + cleanup.writes <= 150);
    assert.ok(scenario.deletes + cleanup.deletes <= 50);
    assert.equal(JSON.stringify([...f.docs]), baseline, 'Only smoke-owned documents may be removed; no orphan remains');
    before = f.calls.length;
    assert.equal((await call('/api/dev/budget-smoke', body)).status, 429);
    assert.equal(f.calls.length, before, 'Same-build retry cannot reach Firestore');
    assert.ok(Math.max(0, ...outbound.counts.values()) <= 32);
    console.log('BUDGETED_MINIMAL_SMOKE_LOCAL_PASS ' + JSON.stringify({
        googleTransport: 'INTERCEPTED',
        checks: result.value.checks,
        spent: result.value.budget.spent,
        cleanup: result.value.cleanup,
        budgetClosed: true
    }));
} finally {
    await runtime.dispose();
}
