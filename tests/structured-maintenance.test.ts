import {test} from 'node:test';import assert from 'node:assert/strict';
import {structuredFixture} from './structured-firestore-fixture.ts';
import {NativeFirestore} from '../worker/structured/firestore.ts';
import {DevMaintenance} from '../worker/structured/maintenance.ts';
function state(){const values=new Map<string,any>();return {get:async(k:string)=>values.get(k),put:async(k:string,v:any)=>values.set(k,structuredClone(v)),delete:async(k:string)=>values.delete(k),list:async({prefix}:{prefix:string})=>new Map([...values].filter(([k])=>k.startsWith(prefix)))} as unknown as DurableObjectStorage;}
async function walk(m:DevMaintenance,mode:string,hash?:string,scope='legacy'){let cursor:any;for(let n=0;n<100;n++){const r=await m.step({project:'pgt-bjj-dev',mode,scope,inventoryHash:hash,cursor});if(r.done)return r;cursor=r.cursor;}throw Error('maintenance did not complete');}
test('Maintenance validates DEV, inventories nested and orphan legacy data, conditionally deletes only approved obsolete collections',async()=>{
 const f=await structuredFixture(),db=new NativeFirestore(f.env,f.transport),m=new DevMaintenance(db,state());
 await db.commit([db.update('pgt_resources/legacy',{kind:'user_data',owner:'pgt-dev-test@example.test'},null),db.update('pgt_resources/legacy/parts/a',{payload:'historical-test'},null),db.update('pgt_resources/missing-parent/parts/b',{payload:'historical-test'},null),db.update('settings/preserved',{model:'structured-v1'},null)]);
 await assert.rejects(m.step({project:'pgt-bjj-pro',mode:'inventory'}));await assert.rejects(walk(m,'delete','invented'));
 const before=await walk(m,'inventory');assert.equal(before.counts.pgt_resources,3);assert.equal(before.orphans.pgt_resources,1);
 const after=await walk(m,'delete',before.inventoryHash);assert.equal(after.deleted.pgt_resources,3);assert.ok(![...f.docs.keys()].some(k=>k.includes('/pgt_resources/')));assert.ok(await db.get('settings/preserved'));
 await db.commit([db.update('users/pgt-dev-00000000-0000-4000-8000-000000000001-student@example.test',{perfil:'alumno'},null)]);
 const all=await walk(m,'inventory',undefined,'all');assert.equal(all.qaOwnedDocuments,1);assert.equal(all.counts.settings,1);assert.deepEqual(all.orphans,{});
});
test('Unknown collections and documents modified after inventory stop destructive work',async()=>{
 const f=await structuredFixture(),db=new NativeFirestore(f.env,f.transport),m=new DevMaintenance(db,state());
 await db.commit([db.update('unknown_collection/do-not-delete',{content:'unknown'},null)]);await assert.rejects(walk(m,'inventory'),/UNKNOWN_DEV_COLLECTION/);assert.ok(await db.get('unknown_collection/do-not-delete'));
 await db.deleteRows([(await db.get('unknown_collection/do-not-delete'))!]);await db.commit([db.update('pgt_resources/existing',{kind:'catalog'},null)]);
 const before=await walk(m,'inventory');const row=await db.get('pgt_resources/existing');await db.commit([db.update(row!.path,{kind:'changed'},row)]);
 await assert.rejects(walk(m,'delete',before.inventoryHash),/DEV_DOCUMENT_CHANGED/);assert.ok(await db.get('pgt_resources/existing'));
});

test('An empty legacy cleanup preserves current native users sessions and plan checkpoints',async()=>{
 const f=await structuredFixture(),db=new NativeFirestore(f.env,f.transport),store=state(),maintenance=new DevMaintenance(db,store);
 await store.put('app-session:existing',{mail:'existing@example.test'});await store.put('plan-update:existing:plan',{p:'current'});
 const inventory=await walk(maintenance,'inventory');await walk(maintenance,'delete',inventory.inventoryHash);
 assert.deepEqual(await store.get('app-session:existing'),{mail:'existing@example.test'});assert.deepEqual(await store.get('plan-update:existing:plan'),{p:'current'});
});
