import {test} from 'node:test';import assert from 'node:assert/strict';
import {OnlineDraft} from '../src/application/online-draft.ts';
test('Online editor coalesces keystrokes and advances only its own acknowledged base',async()=>{
 const saves:any[]=[];const d=new OnlineDraft<any>(async(v,base)=>{saves.push([v,base]);return 'ack';},()=>assert.fail(),()=>{},100000);
 d.update({value:1},'initial');d.update({value:2},'unrelated-remote-version');await d.flush();assert.deepEqual(saves,[[{value:2},'initial']]);assert.equal(d.hasDraft,false);
});
test('Failure retains volatile draft and prevents automatic replay; explicit retry is required',async()=>{
 let attempts=0,fail=true;const d=new OnlineDraft<number>(async(v)=>{attempts++;if(fail)throw Error('network');return 'ack';},()=>{},()=>{},100000);
 d.update(3,'base');await assert.rejects(d.flush());fail=false;d.update(4,'remote');await assert.rejects(d.flush());assert.equal(attempts,1);assert.equal(d.value,4);
 await d.retry();assert.equal(attempts,2);assert.equal(d.hasDraft,false);
});
test('Parallel flushes and edits during an in-flight write are serialized without duplicate saves',async()=>{
 let release!:()=>void;const barrier=new Promise<void>(r=>release=r),calls:any[]=[];
 const d=new OnlineDraft<number>(async(v,base)=>{calls.push([v,base]);if(v===1)await barrier;return 'ack'+v;},()=>{},()=>{},100000);
 d.update(1,'base');const a=d.flush(),b=d.flush();d.update(2,'foreign');release();await Promise.all([a,b]);assert.deepEqual(calls,[[1,'base'],[2,'ack1']]);assert.equal(d.hasDraft,false);d.discard();
});
