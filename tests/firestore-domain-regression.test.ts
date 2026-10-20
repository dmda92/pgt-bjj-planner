import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {generatePlan,tabata,coverage,priorityCycle} from '../src/domain/planner.ts';
import {updateFutureDeletions} from '../src/domain/plan-continuity.ts';
import {updateFuturePlanText} from '../src/domain/plan-text-updates.ts';
import type {Competition,Techniques,Comments,TrainingPlan} from '../src/domain/models.ts';

// Captured from the unmodified main commit, BEFORE persistence work. This file
// is a reference oracle, not regenerated from whichever implementation is tested.
const baseline = JSON.parse(readFileSync(new URL('./fixtures/firestore/domain-baseline.json',import.meta.url),'utf8')) as {
  baseCommit:string;
  sourceHashes:Record<string,string>;
  fixtures:{name:string;input:{competition:Competition;mail:string;techniques:Techniques;comments:Comments;generatedAt:string};
    change:null|{techniques:Techniques;comments:Comments;today:string;invalidCursorMove?:'forward'};
    expected:{generated:TrainingPlan;result?:TrainingPlan;tabata:ReturnType<typeof tabata>;completed:[string,number][];touched:string[]}}[];
};

test('Firestore migration must retain the exact baseline domain source',()=>{
  assert.equal(baseline.baseCommit,'3b8125cb362f665f908e4028d54514f65f00459a');
  for(const [path,expected] of Object.entries(baseline.sourceHashes))
    assert.equal(createHash('sha256').update(readFileSync(new URL('../'+path,import.meta.url))).digest('hex'),expected,path+' changed: migration does not authorize algorithm changes');
});

test('Explicit circular priority reference remains unchanged across wraparound',()=>{
  const stream=priorityCycle([1,2,3,4,5]);
  assert.deepEqual(Array.from({length:14},()=>stream.next().value),[1,2,1,3,2,4,3,5,4,1,5,2,1,3]);
});

for(const fixture of baseline.fixtures) test('Baseline equivalence: '+fixture.name,()=>{
  const {competition,mail,techniques,comments,generatedAt}=structuredClone(fixture.input);
  const untouched=structuredClone({competition,techniques,comments});
  const generated=generatePlan(competition,mail,techniques,comments,generatedAt);
  assert.deepEqual(generated,fixture.expected.generated,'Full plan, UUIDs, dates, texts, passes and continuity');
  assert.deepEqual({competition,techniques,comments},untouched,'Generation must not mutate its sources');
  const change=structuredClone(fixture.change);
  const before=structuredClone(change);
  const source=structuredClone(fixture.expected.generated);
  if(change?.invalidCursorMove)source.continuity!.boundaries[0].cursor.move=change.invalidCursorMove;
  const originalSource=structuredClone(source);
  const result=change ? updateFuturePlanText(updateFutureDeletions(source,change.techniques,change.comments,change.today),change.techniques,change.comments,change.today) : generated;
  assert.deepEqual(result,fixture.expected.result ?? fixture.expected.generated,'Full recalculation, checkpoints and protected history');
  assert.deepEqual(source,originalSource,'Original plan must remain unchanged');
  assert.deepEqual(change,before,'Recalculation must not mutate sources or original snapshot');
  assert.deepEqual(tabata(result),fixture.expected.tabata);
  const counts=coverage(result);
  assert.deepEqual([...counts.completed],fixture.expected.completed);
  assert.deepEqual([...counts.touched],fixture.expected.touched);
  if(change){
    assert.deepEqual(result.sessions.filter(s=>s.date<=change.today),source.sessions.filter(s=>s.date<=change.today),'Past AND today remain byte-equivalent');
    assert.deepEqual(updateFuturePlanText(updateFutureDeletions(result,change.techniques,change.comments,change.today),change.techniques,change.comments,change.today),result,'Replay must be idempotent');
  }
  assert.ok(result.sessions.every(s=>s.date<competition.fecha_torneo && s.exercises.length===competition.ejercicios_por_sesion));
});
