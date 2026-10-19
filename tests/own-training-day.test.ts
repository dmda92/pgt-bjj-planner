import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ownTrainingDay} from '../src/domain/own-training-day.ts';
import type {TrainingPlan} from '../src/domain/models.ts';
const plan=(id:string,mail:string,end:string,dates:string[])=>({planId:id,mail,fecha_torneo:end,sessions:dates.map(date=>({date,exercises:[]}))} as unknown as TrainingPlan);
test('Own day chooses strictly future active date, keeps all own sessions, and never mutates plans',()=>{
 const plans=[plan('b','me','2026-11-01',['2026-10-16','2026-10-19']),plan('a','me','2026-10-30',['2026-10-19','2026-10-21','2026-10-19']),plan('foreign','other','2026-11-01',['2026-10-17']),plan('old','me','2026-10-15',['2026-10-17'])];
 const before=structuredClone(plans),day=ownTrainingDay(plans,'me','2026-10-16');
 assert.equal(day.date,'2026-10-19');assert.deepEqual(day.sessions.map(s=>[s.plan.planId,s.index]),[['a',0],['a',2],['b',1]]);assert.deepEqual(plans,before);
 assert.equal(ownTrainingDay(plans,'me','2026-10-16','2026-10-16').sessions.length,1);
 assert.deepEqual(ownTrainingDay(plans,'me','2026-10-16','2026-10-17').sessions.map(s=>s.plan.planId),['old']);
 assert.equal(ownTrainingDay(plans,'other','2026-10-16').date,'2026-10-17');
});
test('Own day handles no future sessions, empty dates and explicit historical/empty days',()=>{
 const plans=[plan('past','me','2026-10-15',['2026-10-14']),plan('today','me','2026-10-16',['2026-10-16'])];
 assert.deepEqual(ownTrainingDay(plans,'me','2026-10-16'),{date:'',sessions:[]});
 assert.equal(ownTrainingDay(plans,'me','2026-10-16','2026-10-14').sessions.length,1);
 assert.deepEqual(ownTrainingDay(plans,'me','2026-10-16','2026-10-20'),{date:'2026-10-20',sessions:[]});
 assert.deepEqual(ownTrainingDay([],'me','2026-10-16'),{date:'',sessions:[]});
});
