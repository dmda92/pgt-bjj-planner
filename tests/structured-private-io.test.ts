import {test} from 'node:test';
import assert from 'node:assert/strict';
import {privateTransport,type PrivateIOBinding} from '../worker/structured/private-io.ts';
test('External I/O rotates at 32 calls, including concurrent calls and retries, and does not transfer AbortSignal',async()=>{
 let id=0;const counts=new Map<number,number>();
 const namespace={newUniqueId:()=>++id,get:(key:number)=>({request:async(_input:string,init:RequestInit)=>{
  assert.ok(!('signal' in init));counts.set(key,(counts.get(key)||0)+1);
  return {build:'local',body:new TextEncoder().encode('ok').buffer,status:200,headers:[]};
 }})} as unknown as PrivateIOBinding;
 const transport=privateTransport(namespace);
 const results=await Promise.all(Array.from({length:100},()=>transport('https://firestore.googleapis.com/',{signal:AbortSignal.timeout(5000)})));
 assert.deepEqual([...counts.values()],[32,32,32,4]);assert.ok(results.every(r=>r.status===200));assert.equal(await results[0].text(),'ok');
});

test('Private transport rejects a mismatched execution build before accepting any response',async()=>{
 const namespace={newUniqueId:()=>1,get:()=>({request:async()=>({build:'previous',body:new ArrayBuffer(0),status:200,headers:[]})})} as unknown as PrivateIOBinding;
 await assert.rejects(privateTransport(namespace,'current')('https://firestore.googleapis.com/'),/PRIVATE_IO_BUILD_MISMATCH/);
});
