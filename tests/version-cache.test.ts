import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VersionCache, StaleEntityRead } from '../src/application/version-cache.ts';
test('Concurrent views reuse one load and every caller receives isolated values', async () => {
    const c = new VersionCache<{
        text: string;
    }>();
    let calls = 0;
    const [a, b] = await Promise.all([c.load('owner/entity', 'v1', async () => { calls++; return { text: 'saved' }; }), c.load('owner/entity', 'v1', async () => { throw Error('duplicate'); })]);
    assert.equal(calls, 1);
    a.text = 'draft';
    assert.equal(b.text, 'saved');
    assert.deepEqual(await c.load('owner/entity', 'v1', async () => { throw Error('unexpected'); }), { text: 'saved' });
});
test('Invalidation during a load cannot return or repopulate old data', async () => {
    const c = new VersionCache<string>();
    let finish!: (value: string) => void;
    const old = c.load('a', 'v1', () => new Promise(resolve => { finish = resolve; }));
    c.invalidate('a');
    const latest = await c.load('a', 'v2', async () => 'new');
    finish('old');
    await assert.rejects(old, StaleEntityRead);
    assert.equal(latest, 'new');
    assert.equal(await c.load('a', 'v2', async () => { throw Error('unexpected'); }), 'new');
});
test('Logout clear fences in-flight loads and a failed fetch is not cached', async () => {
    const c = new VersionCache<string>();
    let finish!: (value: string) => void;
    const old = c.load('actor/entity', 'v1', () => new Promise(resolve => { finish = resolve; }));
    c.clear();
    finish('private');
    await assert.rejects(old, StaleEntityRead);
    await assert.rejects(c.load('actor/entity', 'v2', async () => { throw Error('transport'); }), /transport/);
    assert.equal(await c.load('actor/entity', 'v2', async () => 'retry'), 'retry');
});
test('LRU remains within budget and cold entries are fetched again', async () => {
    const c = new VersionCache<string>(650);
    await c.load('a', '1', async () => 'x'.repeat(80));
    await c.load('b', '1', async () => 'y'.repeat(80));
    assert.ok(c.usedBytes <= 650);
    assert.ok(c.counts.evictions > 0);
    const before = c.counts.loads;
    await c.load('a', '1', async () => 'x'.repeat(80));
    assert.equal(c.counts.loads, before + 1);
});
