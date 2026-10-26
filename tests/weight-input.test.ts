import {test} from 'node:test';
import assert from 'node:assert/strict';
import {weightError, weightValue} from '../src/application/weight-input.ts';

test('BUG-002 open weight bounds, Spanish decimals and no rounding', () => {
    for (const [text, value] of [['', null], ['0.01', 0.01], ['71.55', 71.55], ['71,55', 71.55], ['499.99', 499.99], ['499,99999', 499.99999]] as const) {
        assert.equal(weightError(text), '');
        assert.equal(weightValue(text), value);
    }
    for (const text of ['0', '-1', '500', '500,01', 'Infinity', 'NaN', 'abc', '71,5,5', '1e2']) assert.ok(weightError(text), text);
});
