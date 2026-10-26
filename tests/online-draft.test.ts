import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OnlineDraft} from '../src/application/online-draft.ts';
import {SaveThrottled} from '../src/application/save-throttled.ts';

test('Online editor coalesces keystrokes and advances only its own acknowledged base', async () => {
    const saves: any[] = [];
    const d = new OnlineDraft<any>(async (v, base) => {
        saves.push([v, base]);
        return 'ack';
    }, () => assert.fail(), () => {
    }, 100000);
    d.update({value: 1}, 'initial');
    d.update({value: 2}, 'unrelated-remote-version');
    await d.flush();
    assert.deepEqual(saves, [[{value: 2}, 'initial']]);
    assert.equal(d.hasDraft, false);
});

test('A brief throttle waits, coalesces the latest draft and preserves its own base before one retry', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
    const saved: [number, string | null][] = [];
    const d = new OnlineDraft<number>(async (value, base) => {
        saved.push([value, base]);
        if (saved.length === 1) throw new SaveThrottled(1000);
        return 'ack';
    }, () => assert.fail('Throttle should recover'), () => {}, 100000);
    d.update(1, 'base'); await d.flush();
    d.update(2, 'foreign'); await d.flush();
    t.mock.timers.tick(999); assert.equal(saved.length, 1); assert.equal(d.hasFailed, false);
    t.mock.timers.tick(1); await d.flush();
    assert.deepEqual(saved, [[1, 'base'], [2, 'base']]); assert.equal(d.hasDraft, false);
});

test('A second throttle stops automatic retries and manual retry cannot bypass Retry-After', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
    let attempts = 0, failures = 0;
    const d = new OnlineDraft<number>(async () => { attempts++; throw new SaveThrottled(1000); }, () => { failures++; }, () => {}, 100000);
    d.update(1, 'base'); await d.flush(); t.mock.timers.tick(1000);
    await assert.rejects(d.flush(), SaveThrottled);
    await assert.rejects(d.retry(), SaveThrottled);
    assert.equal(attempts, 2); assert.equal(failures, 1); assert.equal(d.hasFailed, true);
    t.mock.timers.tick(60000); assert.equal(attempts, 2); assert.equal(d.value, 1); d.discard();
});

test('Offline/session change or discarded drafts never replay when the throttle expires', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
    let attempts = 0, allowed = true;
    const d = new OnlineDraft<number>(async () => { attempts++; throw new SaveThrottled(1000); }, () => {}, () => {}, 100000, () => allowed);
    d.update(1, 'base'); await d.flush(); allowed = false; t.mock.timers.tick(1000);
    await assert.rejects(d.flush()); assert.equal(attempts, 1); assert.equal(d.value, 1);
    allowed = true; t.mock.timers.tick(60000); assert.equal(attempts, 1); d.discard();
    d.update(2, 'base'); await d.flush(); d.discard(); t.mock.timers.tick(60000);
    assert.equal(attempts, 2); assert.equal(d.hasDraft, false);
});

test('An hourly throttle remains a manual failure rather than a long lived upload queue', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
    let attempts = 0;
    const d = new OnlineDraft<number>(async () => { attempts++; throw new SaveThrottled(3600000); }, () => {}, () => {}, 100000);
    d.update(1, 'base'); await assert.rejects(d.flush(), SaveThrottled);
    await assert.rejects(d.retry(), SaveThrottled); t.mock.timers.tick(3600000);
    assert.equal(attempts, 1); assert.equal(d.hasFailed, true); d.discard();
});

test('Going offline and reconnecting before the deadline cannot replay the throttled draft', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
    let attempts = 0, generation = 0, throttle = true;
    const d = new OnlineDraft<number>(async () => { attempts++; if (throttle) throw new SaveThrottled(1000); return 'ack'; }, () => {}, () => {}, 100000,
        () => true, () => generation);
    d.update(1, 'base'); await d.flush(); generation++; t.mock.timers.tick(1000);
    await assert.rejects(d.flush()); assert.equal(attempts, 1); assert.equal(d.hasFailed, true);
    throttle = false; await d.retry(); assert.equal(attempts, 2); assert.equal(d.hasDraft, false); d.discard();
});
test('Failure retains volatile draft and prevents automatic replay; explicit retry is required', async () => {
    let attempts = 0, fail = true;
    const d = new OnlineDraft<number>(async (v) => {
        attempts++;
        if (fail) throw Error('network');
        return 'ack';
    }, () => {
    }, () => {
    }, 100000);
    d.update(3, 'base');
    await assert.rejects(d.flush());
    fail = false;
    d.update(4, 'remote');
    await assert.rejects(d.flush());
    assert.equal(attempts, 1);
    assert.equal(d.value, 4);
    await d.retry();
    assert.equal(attempts, 2);
    assert.equal(d.hasDraft, false);
});
test('Parallel flushes and edits during an in-flight write are serialized without duplicate saves', async () => {
    let release!: () => void;
    const barrier = new Promise<void>(r => release = r), calls: any[] = [];
    const d = new OnlineDraft<number>(async (v, base) => {
        calls.push([v, base]);
        if (v === 1) await barrier;
        return 'ack' + v;
    }, () => {
    }, () => {
    }, 100000);
    d.update(1, 'base');
    const a = d.flush(), b = d.flush();
    d.update(2, 'foreign');
    release();
    await Promise.all([a, b]);
    assert.deepEqual(calls, [[1, 'base'], [2, 'ack1']]);
    assert.equal(d.hasDraft, false);
    d.discard();
});
