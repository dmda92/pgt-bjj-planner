import {test} from 'node:test';
import assert from 'node:assert/strict';
import {competitionDateErrors} from '../src/application/competition-dates.ts';

test('Competition dates identify invalid field, equal/earlier tournament, leap dates and maximum range', () => {
    assert.deepEqual(competitionDateErrors('', ''), {}); // native required constraint
    assert.ok(competitionDateErrors('2026-02-30', '2026-10-20').start);
    assert.ok(competitionDateErrors('2026-10-15', '2026-02-30').end);
    assert.ok(competitionDateErrors('2026-10-15', '2026-10-15').end);
    assert.ok(competitionDateErrors('2026-10-15', '2026-10-14').end);
    assert.deepEqual(competitionDateErrors('2028-02-29', '2028-03-01'), {});
    assert.ok(competitionDateErrors('2026-10-15', '2030-10-15').end);
    assert.deepEqual(competitionDateErrors('2026-10-15', '2026-12-13'), {});
});
