import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stageImmutableBlocks} from '../worker/v2/immutable-blocks.ts';
import {NativeFirestore} from '../worker/structured/firestore.ts';
import {nativeWrite} from '../worker/v2/plans.ts';
import {blockDigest} from '../src/infrastructure/native-packing.ts';
import {structuredFixture} from './structured-firestore-fixture.ts';

const block = (text: string) => ({kind: 'literal', value: text});
const path = (text: string) => 'pgt_v2/main/aggregates/repertoire__synthetic/blocks/' + blockDigest(block(text));

test('Immutable staging normal path adds zero reads; mixed reuse retries only absent chunks', async () => {
    const f = await structuredFixture(), db = new NativeFirestore(f.env, f.transport);
    const write = (text: string) => nativeWrite(db, path(text), block(text), null);
    let before = f.metrics();
    await stageImmutableBlocks(db, [write('old')]);
    assert.equal(f.metrics().estimatedReads - before.estimatedReads, 0);
    assert.equal(f.metrics().attemptedWrites - before.attemptedWrites, 1);
    before = f.metrics();
    await stageImmutableBlocks(db, [write('old'), write('new')]);
    assert.equal(f.metrics().estimatedReads - before.estimatedReads, 2);
    assert.equal(f.metrics().attemptedWrites - before.attemptedWrites, 3,
        'Two attempted create writes plus one missing-only create; old block never overwritten');
    assert.equal(f.metrics().httpRequests - before.httpRequests, 4);
});

test('Immutable staging rejects digest mismatch and never overwrites a corrupt block', async () => {
    const f = await structuredFixture(), db = new NativeFirestore(f.env, f.transport);
    await db.commit([nativeWrite(db, path('old'), block('CORRUPT'), null)]);
    const before = structuredClone([...f.docs.entries()]);
    await assert.rejects(stageImmutableBlocks(db, [nativeWrite(db, path('old'), block('old'), null),
        nativeWrite(db, path('new'), block('new'), null)]), /IMMUTABLE_BLOCK_INTEGRITY/);
    assert.deepEqual([...f.docs.entries()], before);
});

for (const status of [403, 429, 503]) {
    test(`Immutable staging propagates provider ${status} without recovery reads or retries`, async () => {
        const f = await structuredFixture(), db = new NativeFirestore(f.env, f.transport);
        await db.commit([nativeWrite(db, path('old'), block('old'), null)]);
        let attempts = 0;
        const failing = new NativeFirestore(f.env, async (url, init) => {
            if (url.endsWith('/documents:commit')) { attempts++; return Response.json({error: {status: 'SYNTHETIC'}}, {status}); }
            return f.transport(url, init);
        });
        const before = f.metrics();
        await assert.rejects(stageImmutableBlocks(failing, [nativeWrite(failing, path('old'), block('old'), null)]));
        assert.equal(attempts, 1);
        assert.equal(f.metrics().estimatedReads, before.estimatedReads);
    });
}

test('Immutable staging recovers lost ACK only after verifying all committed content', async () => {
    const f = await structuredFixture();
    let attempts = 0;
    const db = new NativeFirestore(f.env, async (url, init) => {
        const result = await f.transport(url, init);
        if (url.endsWith('/documents:commit')) { attempts++; throw Error('synthetic lost ACK'); }
        return result;
    });
    await stageImmutableBlocks(db, [nativeWrite(db, path('new'), block('new'), null)]);
    assert.equal(attempts, 1);
    assert.equal(f.metrics().estimatedReads, 1);
});

test('Immutable staging does not retry an uncertain uncommitted write or a conflict without progress', async () => {
    for (const mode of ['network','conflict']) {
        const f = await structuredFixture();let attempts=0;
        const db = new NativeFirestore(f.env, async (url, init) => {
            if (url.endsWith('/documents:commit')) {
                attempts++;
                if (mode === 'network') throw Error('synthetic transport failure before commit');
                return Response.json({error:{status:'FAILED_PRECONDITION'}},{status:400});
            }
            return f.transport(url, init);
        });
        await assert.rejects(stageImmutableBlocks(db,[nativeWrite(db,path('absent'),block('absent'),null)]),
            mode === 'network' ? /FIRESTORE_NETWORK_RETRY/ : /VERSION_CONFLICT/);
        assert.equal(attempts,1);
        assert.equal(f.metrics().estimatedReads,1);
        assert.equal(f.docs.size,0);
    }
});
