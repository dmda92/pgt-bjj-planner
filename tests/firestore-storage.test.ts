import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FirestoreStorage} from '../worker/firestore-storage.ts';
import {firestoreFixture} from './firestore-fixture.ts';
const path='PGT/users_data/pgt-dev-storage@example.test/tecnics.json';
test('Firestore preserves ordered JSON >1MiB, UTF-8, hashes, listing and tombstones',async()=>{
 const f=await firestoreFixture(),s=new FirestoreStorage(f.env,f.transport);
 const value={positions:[{id:'unchanged',text:'á😃'.repeat(230000)}],ordered:[8,3,1],nested:{empty:null}};
 const version=await s.write(path,value,null);
 assert.deepEqual(await s.read(path),{data:value,sha:version});
 const list=await s.list('PGT/users_data/pgt-dev-storage@example.test');assert.deepEqual(list,[{name:'tecnics.json',type:'file',sha:version}]);
 assert.ok([...f.docs.values()].every(d=>new TextEncoder().encode(JSON.stringify(d)).length<1024*1024));
 await s.remove(path,version);assert.equal(await s.read(path),null);assert.deepEqual(await s.list('PGT/users_data/pgt-dev-storage@example.test'),[]);
 const recreated=await s.write(path,{new:true},null);assert.notEqual(recreated,version);
 await assert.rejects(s.write(path,{stale:true},version),/VERSION_CONFLICT/);
});
test('Concurrent CAS publishes exactly one generation and its outbox atomically',async()=>{
 const f=await firestoreFixture(),a=new FirestoreStorage(f.env,f.transport),b=new FirestoreStorage(f.env,f.transport);
 const original=await a.write(path,{n:0},null);const before=f.docs.size;
 const result=await Promise.allSettled([a.write(path,{n:1},original),b.write(path,{n:2},original)]);
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(result.filter(r=>r.status==='rejected').length,1);
 assert.equal(f.docs.size,before+1); // exactly one winning outbox operation, no losing generation
 const changes=await a.changes();assert.equal(changes.length,2);await a.acknowledge(changes);assert.deepEqual(await a.changes(),[]);
});
test('Lost mutation ACK is resolved by the exact operation revision without replay',async()=>{
 const f=await firestoreFixture(),s=new FirestoreStorage(f.env,f.transport);f.loseNextAck();const sha=await s.write(path,{n:1},null);
 assert.equal((await s.read(path))?.sha,sha);assert.equal(f.calls.filter(c=>c.url.endsWith('/documents:commit')).length,1);
});
test('Corrupt/missing fragments, oversize and foreign targets fail closed',async()=>{
 const f=await firestoreFixture(),s=new FirestoreStorage(f.env,f.transport);await s.write(path,{n:1},null);
 const part=[...f.docs.values()].find(d=>d.fields.inline);part.fields.inline.bytesValue=Buffer.from('{"n":9}').toString('base64');
 await assert.rejects(s.read(path),/CHECKSUM/);
 const before=f.docs.size;await assert.rejects(s.write(path,{text:'x'.repeat(4194304)},null));assert.equal(f.docs.size,before);
 assert.throws(()=>new FirestoreStorage({...f.env,FIRESTORE_PROJECT_ID:'foreign'},f.transport),/DEV_TARGET/);
 await assert.rejects(s.read('PGT/users_data/../tecnics.json'),/PATH_FORBIDDEN/);
});
