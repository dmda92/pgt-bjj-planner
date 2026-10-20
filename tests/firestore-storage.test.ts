import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FirestoreStorage} from '../worker/firestore-storage.ts';
import {firestoreFixture} from './firestore-fixture.ts';
const path='PGT/users_data/pgt-dev-storage@example.test/tecnics.json';
test('Firestore preserves ordered JSON >1MiB, UTF-8, hashes, listing and tombstones',async()=>{
 const f=await firestoreFixture(),s=new FirestoreStorage(f.env,f.transport);
 const value={positions:[{id:'unchanged',text:'á😃'.repeat(230000)}],ordered:[8,3,1],nested:{empty:null}};
 const version=await s.write(path,value,null);
 const readStart=f.calls.length;assert.deepEqual(await s.read(path),{data:value,sha:version});assert.equal(f.calls.length-readStart,2);assert.ok(f.calls.at(-1)!.url.endsWith('/documents:batchGet'));
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
 const f=await firestoreFixture(),s=new FirestoreStorage(f.env,f.transport);const original=await s.write(path,{n:1},null);
 const part=[...f.docs.values()].find(d=>d.fields.inline);part.fields.inline.bytesValue=Buffer.from('{"n":9}').toString('base64');
 await assert.rejects(s.read(path),/CHECKSUM/);
 const before=f.docs.size;await assert.rejects(s.write(path,{text:'x'.repeat(4194304)},original),/JSON_TOO_LARGE/);assert.equal(f.docs.size,before);
 assert.throws(()=>new FirestoreStorage({...f.env,FIRESTORE_PROJECT_ID:'foreign'},f.transport),/DEV_TARGET/);
 await assert.rejects(s.read('PGT/users_data/../tecnics.json'),/PATH_FORBIDDEN/);
});
test('Synthetic cleanup requires a provisioned run, preserves unrelated users and is repeatable',async()=>{
 const f=await firestoreFixture(),s=new FirestoreStorage(f.env,f.transport),run=crypto.randomUUID();
 await assert.rejects(s.cleanupSynthetic(run));
 await s.beginSyntheticRun(run);
 const own=`PGT/users_data/pgt-dev-${run}-student@example.test/user_data.json`,other='PGT/users_data/pgt-dev-unrelated@example.test/user_data.json';
 await s.write(own,{test:true},null);await s.write(other,{other:true},null);
 const first=await s.cleanupSynthetic(run);assert.equal(first.status,'SYNTHETIC_FIXTURE_CLEANED');assert.equal(await s.read(own),null);assert.deepEqual((await s.read(other))?.data,{other:true});
 assert.equal((await s.cleanupSynthetic(run)).resources,0);
});
test('Synthetic cleanup refuses a plan referenced by an unrelated owner before any mutation',async()=>{
 const f=await firestoreFixture(),s=new FirestoreStorage(f.env,f.transport),run=crypto.randomUUID(),id=crypto.randomUUID();await s.beginSyntheticRun(run);
 const own=`PGT/users_data/pgt-dev-${run}-student@example.test/training_plans/plan_${id}.json`,foreign=`PGT/users_data/pgt-dev-unrelated@example.test/training_plans/plan_${id}.json`;
 await s.write(own,{owned:true},null);await s.write(foreign,{unrelated:true},null);const before=f.docs.size;
 await assert.rejects(s.cleanupSynthetic(run),/SYNTHETIC_SHARED_PLAN_NOT_CLEANED/);assert.equal(f.docs.size,before);assert.deepEqual((await s.read(own))?.data,{owned:true});assert.deepEqual((await s.read(foreign))?.data,{unrelated:true});
});
test('Directory order is stable by logical name, independent of Firestore hashed IDs and insertion',async()=>{
 const f=await firestoreFixture(),s=new FirestoreStorage(f.env,f.transport);
 for(const name of ['pgt-dev-z@example.test','pgt-dev-a@example.test','pgt-dev-m@example.test'])await s.write('PGT/users_data/'+name+'/user_data.json',{fixture:true},null);
 assert.deepEqual((await s.list('PGT/users_data')).map(v=>v.name),['pgt-dev-a@example.test','pgt-dev-m@example.test','pgt-dev-z@example.test']);
});

test('Network read retries are bounded; commits are never replayed and runtime limits stay explicit',async()=>{
 const f=await firestoreFixture();let failures=1,attempts=0;
 const s=new FirestoreStorage(f.env,async(url,init)=>{
  if(url.includes('firestore.googleapis.com')){attempts++;if(failures-->0)throw new DOMException('deadline','TimeoutError');}
  return f.transport(url,init);
 });
 assert.equal(await s.read(path),null);assert.equal(attempts,2);
 const limited=new FirestoreStorage(f.env,async(url,init)=>{if(url.includes('firestore.googleapis.com'))throw Error('Too many subrequests.');return f.transport(url,init);});
 await assert.rejects(limited.read(path),/FIRESTORE_SUBREQUEST_LIMIT/);
 const timeouts=new FirestoreStorage(f.env,async(url,init)=>{if(url.includes('firestore.googleapis.com'))throw new DOMException('deadline','TimeoutError');return f.transport(url,init);});
 await assert.rejects(timeouts.read(path),/FIRESTORE_NETWORK_TIMEOUT/);
 const prior=await s.write(path,{n:1},null);let commits=0;
 const writer=new FirestoreStorage(f.env,async(url,init)=>{if(url.endsWith('/documents:commit')){commits++;throw Error('network');}return f.transport(url,init);});
 await assert.rejects(writer.write(path,{n:2},prior),/FIRESTORE_NETWORK_RETRY/);assert.equal(commits,1);assert.deepEqual((await s.read(path))?.data,{n:1});
});
