import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CachedFirestore } from '../worker/v2/cached-firestore.ts';
import { nativeWrite } from '../worker/v2/plans.ts';
import { blockDigest } from '../src/infrastructure/native-packing.ts';
import { structuredFixture } from './structured-firestore-fixture.ts';
test('Only existing immutable chunks reuse IO; mutable heads and fresh CAS/staging checks always reach transport', async () => {
    const f = await structuredFixture(), db = new CachedFirestore(f.env, f.transport), data = { kind: 'literal', value: 'Immutable' };
    const root = 'pgt_v2/main/aggregates/comments__cache@example.test', path = root + '/blocks/' + blockDigest(data);
    await db.commit([nativeWrite(db, root, { version: 1 }, null), nativeWrite(db, path, data, null)]);
    const before = f.metrics();
    const first = await db.get(path); first!.data.value = 'Local mutation';
    assert.equal((await db.get(path))!.data.value, 'Immutable');
    assert.equal(f.metrics().estimatedReads - before.estimatedReads, 1);
    await db.get(path, true); assert.equal(f.metrics().estimatedReads - before.estimatedReads, 2);
    await db.get(root); await db.get(root); assert.equal(f.metrics().estimatedReads - before.estimatedReads, 4);
});
test('A missing chunk is never retained as immutable and can be staged later', async () => {
    const f = await structuredFixture(), db = new CachedFirestore(f.env, f.transport), data = { kind: 'literal', value: 'Later' };
    const path = 'pgt_v2/main/aggregates/comments__cache@example.test/blocks/' + blockDigest(data);
    assert.equal(await db.get(path), null);
    await db.commit([nativeWrite(db, path, data, null)]);
    assert.deepEqual((await db.get(path))!.data, data);
});
