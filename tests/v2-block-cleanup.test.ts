import { test } from 'node:test';
import assert from 'node:assert/strict';
import { structuredFixture } from './structured-firestore-fixture.ts';
import { NativeFirestore } from '../worker/structured/firestore.ts';
import { NativeAggregates } from '../worker/v2/aggregates.ts';
import { nativeWrite } from '../worker/v2/plans.ts';
import { blockDigest } from '../src/infrastructure/native-packing.ts';
import { collectUnusedBlocks } from '../worker/v2/block-cleanup.ts';

test('Targeted collection removes failed staging and retired chunks while preserving live data and receipts', async () => {
    const f = await structuredFixture(), db = new NativeFirestore(f.env, f.transport), store = new NativeAggregates(db);
    const ref = { kind: 'comments' as const, id: 'synthetic@example.test' }, target = 'pgt_v2/main/aggregates/comments__' + ref.id;
    const value = { texts: Array.from({ length: 8 }, (_, i) => String(i) + 'x'.repeat(90000)) }, targets: string[] = [];
    store.onBlocksStaged = async path => { targets.push(path); };
    await store.publish([{ ref, data: value, expected: null }], crypto.randomUUID());
    assert.deepEqual(targets, [target]);
    const orphan = { kind: 'literal', value: 'failed-stage' }, id = blockDigest(orphan);
    await db.commit([nativeWrite(db, target + '/blocks/' + id, orphan, null)]);
    const first = await collectUnusedBlocks(db, store.namespace, target);
    assert.equal(first.removed, 1); assert.equal(first.token, '');
    assert.deepEqual((await store.read(ref))!.data, value);
    await store.publish([{ ref, data: { text: 'small' }, expected: '1' }], crypto.randomUUID());
    assert.ok((await collectUnusedBlocks(db, store.namespace, target)).removed > 0);
    assert.deepEqual((await store.read(ref))!.data, { text: 'small' });
    const before = f.metrics();
    await assert.rejects(collectUnusedBlocks(db, store.namespace, 'pgt_v2/other/aggregates/comments__x'), /TARGET_INVALID/);
    assert.equal(f.metrics().httpRequests, before.httpRequests);
});

test('A missing plan root retires its individual chunks only', async () => {
    const f = await structuredFixture(), db = new NativeFirestore(f.env, f.transport);
    const target = 'pgt_v2/main/plans/' + crypto.randomUUID() + '__synthetic@example.test';
    const block = { kind: 'literal', value: 'orphan' }, id = blockDigest(block);
    await db.commit([nativeWrite(db, target + '/blocks/' + id, block, null)]);
    assert.equal((await collectUnusedBlocks(db, 'pgt_v2/main', target)).removed, 1);
    assert.equal(await db.get(target + '/blocks/' + id), null);
});
