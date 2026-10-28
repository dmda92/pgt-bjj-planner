import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CachedFirestore } from '../worker/v2/cached-firestore.ts';
import { structuredFixture } from './structured-firestore-fixture.ts';
test('Parallel known-document reads use one HTTP batch, preserve missing identities and count document operations', async () => {
    const f = await structuredFixture(), db = new CachedFirestore(f.env, f.transport);
    await db.commit([db.update('pgt_v2/main/aggregates/profile__one', { mail: 'one' }, null), db.update('pgt_v2/main/aggregates/profile__two', { mail: 'two' }, null)]);
    assert.equal(db.committed('pgt_v2/main/aggregates/profile__one'), undefined);
    const before = f.metrics();
    const values = await Promise.all(['one','missing','two'].map(id => db.get('pgt_v2/main/aggregates/profile__' + id, true)));
    assert.deepEqual(values.map(v => v?.data.mail ?? null), ['one', null, 'two']);
    assert.equal(f.metrics().httpRequests - before.httpRequests, 1);
    assert.equal(f.metrics().estimatedReads - before.estimatedReads, 3);
});
