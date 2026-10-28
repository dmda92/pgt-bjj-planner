import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OnlineDraft} from '../src/application/online-draft.ts';

test('draft checkpoint precedes network, ACK removes only acknowledged generation', async () => {
 const events:string[]=[];
 const d = new OnlineDraft<any>(async()=>{events.push('network');return 'ack';},()=>{},()=>{},100000,()=>true,()=>0,()=>null,
  {write:async()=>{events.push('checkpoint');},remove:async()=>{events.push('remove');}});
 d.update({text:'private'},'base'); await d.flush();
 assert.deepEqual(events,['checkpoint','network','remove']);
});
test('IndexedDB checkpoint failure prevents upload and keeps input recoverable', async()=>{
 let writes=0;
 const d = new OnlineDraft<any>(async()=>{writes++;return 'ack';},()=>{},()=>{},100000,()=>true,()=>0,()=>null,
  {write:async()=>{throw Error('IndexedDB unavailable');},remove:async()=>{}});
 d.update({text:'retained'},'base');
 await assert.rejects(d.flush(),/IndexedDB/); assert.equal(writes,0);assert.deepEqual(d.value,{text:'retained'});
});
