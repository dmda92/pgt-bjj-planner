import 'fake-indexeddb/auto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {draftJournal,protectDraftUnload} from '../src/application/draft-journal.ts';
import {db} from '../src/infrastructure/local.ts';

test('journal isolates actor and subject, survives reopening, removes only acknowledged generation', async()=>{
 await db.drafts.clear();
 const record={actor:'a',owner:'pupil',resource:'comment:uuid',data:{text:'private'},base:'v1',generation:1};
 await draftJournal.put(record);
 assert.equal(await draftJournal.get('b','pupil','comment:uuid'),undefined);
 assert.equal(await draftJournal.get('a','other','comment:uuid'),undefined);
 await draftJournal.put({...record,generation:2,data:{text:'newer'}});
 await draftJournal.remove('a','pupil','comment:uuid',1);
 db.close();await db.open();
 assert.equal((await draftJournal.get<{text:string}>('a','pupil','comment:uuid'))?.data.text,'newer');
 await draftJournal.remove('a','pupil','comment:uuid',2);
 assert.equal(await draftJournal.get('a','pupil','comment:uuid'),undefined);
 db.close();
});

test('closed editor recovery is explicit, atomic and never overwrites another pending draft',async()=>{
 await db.open();
 await db.drafts.clear();
 const saved={actor:'a',owner:'a',resource:'techniques',editor:'closed-tab',generation:1,base:'v1',data:{text:'closed private text'}};
 await db.drafts.put(saved);
 assert.equal(await draftJournal.get('a','a','techniques'),undefined);
 await draftJournal.recover(saved);
 assert.deepEqual((await draftJournal.get('a','a','techniques'))?.data,saved.data);
 assert.equal(await db.drafts.get(['a','a','techniques','closed-tab']),undefined);
 await db.drafts.put({...saved,editor:'another-tab'});
 await assert.rejects(draftJournal.recover({...saved,editor:'another-tab'}),/otro borrador/);
 assert.equal((await db.drafts.where('actor').equals('a').toArray()).length,2);
 await db.drafts.put({...saved,editor:'another-tab',generation:2});
 await assert.rejects(draftJournal.discardRecord({...saved,editor:'another-tab'}),/ha cambiado/);
 assert.equal((await db.drafts.get(['a','a','techniques','another-tab']))?.generation,2);
 await db.drafts.clear();db.close();
});

test('failed IndexedDB put keeps a scoped copy across component remount and stale ACK/discard',async()=>{
 await db.open();await db.drafts.clear();
 const original=db.drafts.put.bind(db.drafts);
 const record={actor:'failed-a',owner:'pupil',resource:'comment:lost',generation:1,base:'v1',data:{text:'must survive remount'}};
 db.drafts.put=(()=>Promise.reject(Error('Synthetic IDB put failure'))) as unknown as typeof db.drafts.put;
 try {
  await assert.rejects(draftJournal.put(record),/Synthetic IDB/);
  const recovered=await draftJournal.get<{text:string}>(record.actor,record.owner,record.resource);
  assert.equal(recovered?.data.text,record.data.text);
  assert.equal(recovered?.volatile,true);
  assert.equal((await draftJournal.list(record.actor)).length,1);
  assert.equal(await draftJournal.get('other-actor',record.owner,record.resource),undefined);
  await assert.rejects(draftJournal.checkpoint(),/IndexedDB/);
  await assert.rejects(draftJournal.put({...record,generation:2,data:{text:'newer'}}),/Synthetic IDB/);
  await draftJournal.remove(record.actor,record.owner,record.resource,1);
  assert.equal((await draftJournal.get<{text:string}>(record.actor,record.owner,record.resource))?.data.text,'newer');
  await assert.rejects(draftJournal.discardRecord(recovered!),/ha cambiado/);
  assert.equal((await draftJournal.list(record.actor))[0].generation,2);
 } finally {db.drafts.put=original;}
 await draftJournal.remove(record.actor,record.owner,record.resource,2);
 assert.equal(await draftJournal.get(record.actor,record.owner,record.resource),undefined);
 await draftJournal.checkpoint();
 db.drafts.put=(()=>Promise.reject(Error('Synthetic failed put before discard'))) as unknown as typeof db.drafts.put;
 try {await assert.rejects(draftJournal.put({...record,generation:3}),/failed put/);}finally{db.drafts.put=original;}
 const failed=(await draftJournal.list(record.actor))[0];
 await draftJournal.discardRecord(failed);
 assert.equal(await draftJournal.get(record.actor,record.owner,record.resource),undefined);
 await draftJournal.checkpoint();db.close();
});

test('normal pending reads await storage, unload warns, and errors only report transitions',{timeout:2000},async()=>{
 await db.open();await db.drafts.clear();
 const original=db.drafts.put.bind(db.drafts), previousWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
 const target=new EventTarget(), states:boolean[]=[];
 target.addEventListener('pgt-draft-storage-status',event=>states.push((event as CustomEvent<{failed:boolean}>).detail.failed));
 Object.defineProperty(globalThis,'window',{value:target,configurable:true});
 const record={actor:'warning-actor',owner:'pupil',resource:'comment:pending',generation:1,base:'v1',data:{text:'pending'},volatile:true};
 let rejectPut!: (error:Error)=>void;
 db.drafts.put=(()=>new Promise((_resolve,reject)=>{rejectPut=reject;})) as unknown as typeof db.drafts.put;
 const saving=draftJournal.put(record);void saving.catch(()=>{});
 try {
  let peeked=false;
  const reading=draftJournal.get<{text:string}>(record.actor,record.owner,record.resource).then(value=>{peeked=true;return value;});
  await Promise.resolve();assert.equal(peeked,false);
  let prevented=false;const event={preventDefault(){prevented=true;},returnValue:'unchanged'};
  protectDraftUnload(event);assert.equal(prevented,true);assert.equal(event.returnValue,'');
  rejectPut(Error('Synthetic storage failure'));await assert.rejects(saving,/Synthetic storage/);
  assert.equal((await reading)?.data.text,'pending');assert.equal((await reading)?.volatile,true);
  db.drafts.put=(()=>Promise.reject(Error('Repeated storage failure'))) as unknown as typeof db.drafts.put;
  await assert.rejects(draftJournal.put({...record,generation:2}),/Repeated storage/);
  assert.deepEqual(states,[true]);await assert.rejects(draftJournal.checkpoint(),/IndexedDB/);
  db.drafts.put=original;await draftJournal.put({...record,generation:3});
  assert.deepEqual(states,[true,false]);
  const saved=await draftJournal.get(record.actor,record.owner,record.resource);assert.ok(!saved?.volatile);
  const durable=await db.drafts.get([record.actor,record.owner,record.resource,saved!.editor!]);assert.ok(!('volatile' in durable!));
  prevented=false;protectDraftUnload(event);assert.equal(prevented,false);
  await draftJournal.remove(record.actor,record.owner,record.resource,3);await draftJournal.checkpoint();
 } finally {
  db.drafts.put=original;
  if(previousWindow)Object.defineProperty(globalThis,'window',previousWindow);else Reflect.deleteProperty(globalThis,'window');
  db.close();
 }
});
