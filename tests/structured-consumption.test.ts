import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DomainRepositories} from '../worker/structured/repositories.ts';
import {NativeFirestore} from '../worker/structured/firestore.ts';
import {FirestoreUsage} from '../worker/structured/usage.ts';
import {structuredFixture} from './structured-firestore-fixture.ts';
import {cloneTemplate} from '../src/domain/models.ts';
import {template} from './template-fixture.ts';

test('One description plus checkpoint uses three atomic writes and no deletes; identical save writes nothing', async () => {
    const f = await structuredFixture(), r = new DomainRepositories(f.env, f.transport),
        ref = {kind: 'techniques' as const, mail: 'cost@example.test'}, data = cloneTemplate(template);
    let v = await r.write(ref, data, null);
    const root = (await r.db.get(r.path(ref)))!, before = {...r.db.usage.totals};
    data.positions[0].tecnicas[0].descripcion_del_alumno = 'Una descripción';
    data.descriptionUpdates = {[data.positions[0].tecnicas[0].id]: 'version-1'};
    v = await r.write(ref, data, v);
    const after = r.db.usage.totals;
    assert.equal(after.confirmedWrites - before.confirmedWrites, 3);
    assert.equal(after.confirmedDeletes - before.confirmedDeletes, 0);
    assert.equal((await r.db.get(r.path(ref)))!.data.activeRevision, root.data.activeRevision);
    assert.deepEqual((await r.read(ref))!.data, data);
    const same = {...after};
    assert.equal(await r.write(ref, data, v), v);
    assert.equal(after.attemptedWrites, same.attemptedWrites);
    assert.equal(after.attemptedDeletes, same.attemptedDeletes);
});

test('HTTP and document estimates differ; cache hits are free; budgets stop commits before sending', async () => {
    const f = await structuredFixture(), usage = new FirestoreUsage({reads: 10, writes: 2, deletes: 1}),
        db = new NativeFirestore(f.env, f.transport, usage);
    await db.commit([db.update('cost/one', {n: 1}, null), db.update('cost/two', {n: 2}, null)]);
    const requests = usage.totals.httpRequests;
    await assert.rejects(db.commit([db.update('cost/three', {n: 3}, null)]), /BUDGET_EXCEEDED/);
    assert.equal(usage.totals.httpRequests, requests);
    assert.equal(f.docs.size, 2);
    db.beginOperation();
    const rows = await db.query('cost');
    assert.equal(rows.length, 2);
    assert.equal(usage.totals.estimatedReads, 2);
    assert.equal(usage.totals.queries, 1);
    const after = usage.totals.httpRequests;
    await db.query('cost');
    await db.get('cost/one');
    assert.equal(usage.totals.httpRequests, after);
    await db.query('empty');
    assert.equal(usage.totals.estimatedReads, 3);
    db.endOperation();
});

test('A quota boundary cannot silently turn a truncated query into complete business data', async () => {
    const f = await structuredFixture(), seed = new NativeFirestore(f.env, f.transport);
    await seed.commit([seed.update('cost/one', {n: 1}, null), seed.update('cost/two', {n: 2}, null)]);
    const usage = new FirestoreUsage({reads: 1, writes: 0, deletes: 0}),
        db = new NativeFirestore(f.env, f.transport, usage);
    await assert.rejects(db.query('cost'), /QUERY_BUDGET_BOUNDARY/);
    assert.equal(usage.totals.estimatedReads, 1);
    const before = usage.totals.httpRequests;
    await assert.rejects(db.get('cost/one'), /BUDGET_EXCEEDED/);
    assert.equal(usage.totals.httpRequests, before);
});

test('429 preserves a safe quota classification without exposing raw Google response details', async () => {
    const f = await structuredFixture(), db = new NativeFirestore(f.env, f.transport);
    for (const [kind, code] of [['read', 'DAILY_READ'], ['write', 'DAILY_WRITE'], ['delete', 'DAILY_DELETE']]) {
        await assert.rejects(db.check(Response.json({
            error: {
                message: 'Free daily ' + kind + ' units per project; private consumer 12345',
                details: []
            }
        }, {status: 429})), new RegExp('FIRESTORE_RATE_LIMIT_' + code));
    }
    await assert.rejects(db.check(Response.json({error: {message: 'Other exhausted resource'}}, {status: 429})), /^Error: FIRESTORE_RATE_LIMIT$/);
});

test('Deployed table-based technique revisions remain readable without migration or rewritten IDs', async () => {
    const f = await structuredFixture(), r = new DomainRepositories(f.env, f.transport),
        ref = {kind: 'techniques' as const, mail: 'old@example.test'}, data = cloneTemplate(template);
    const version = await r.write(ref, data, null), root = (await r.db.get(r.path(ref)))!,
        gen = root.data.activeRevision.split('/documents/')[1];
    const legacy = {...root.data};
    delete legacy.positions;
    legacy.entityCounts = {...legacy.entityCounts, positions: data.positions.length};
    await r.db.commit([...data.positions.map((p, n) => r.db.update(gen + '/positions/' + p.id, {
        id: p.id,
        posicion: p.posicion,
        prioridad: p.prioridad,
        ordinal: n
    }, null)), r.db.update(root.path, legacy, root)]);
    assert.deepEqual((await r.read(ref, true))!.data, data);
    assert.notEqual((await r.read(ref))!.sha, version);
});
