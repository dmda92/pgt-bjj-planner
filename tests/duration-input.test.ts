import {test} from 'node:test';
import assert from 'node:assert/strict';
import {durationSeconds} from '../src/application/duration-input.ts';
test('Timer converts minutes:seconds exactly and enforces existing 1–3600 seconds limits',()=>{
 for(const [text,seconds] of [['3:00',180],['2:35',155],['0:01',1],['60:00',3600],['00:45',45]] as const)assert.equal(durationSeconds(text),seconds);
 for(const text of ['0:00','60:01','61:00','3:60','180','3:5','-1:00','1.5:00',''])assert.equal(durationSeconds(text),null);
});
