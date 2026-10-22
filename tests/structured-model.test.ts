import {ApiError} from '../worker/security.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DomainRepositories} from '../worker/structured/repositories.ts';
import {structuredFixture} from './structured-firestore-fixture.ts';
import {cloneTemplate,initialVersion} from '../src/domain/models.ts';
import {cursorSignature} from '../src/domain/plan-continuity.ts';
import {template} from './template-fixture.ts';
const forceStaging=(data:any)=>{for(let n=0;n<451;n++)data.positions.push({id:crypto.randomUUID(),posicion:'Stage '+n,prioridad:1,tecnicas:[{id:crypto.randomUUID(),tipo:'Stage technique',descripcion_del_alumno:''}]});};
const mail='structured@example.test',ref={kind:'techniques' as const,mail};
test('Native user fields, separate secure hash, real role query, fresh CAS and no opaque business payloads',async()=>{
 const f=await structuredFixture(),r=new DomainRepositories(f.env,f.transport),profile={...initialVersion(),mail,perfil:'alumno',nombre:'Test',pwd:'pbkdf2-sha256$600000$test-salt$test-hash'};
 const v=await r.write({kind:'user',mail},profile,null);const doc=f.docs.get('projects/pgt-bjj-dev/databases/(default)/documents/users/'+mail);
 assert.equal(doc.fields.perfil.stringValue,'alumno');assert.ok(!doc.fields.pwd);assert.ok(f.docs.get(doc.name+'/private/credentials').fields.passwordHash);
 doc.fields.perfil={stringValue:'entrenador'};doc.updateTime='2026-10-21T10:00:01.000000Z';assert.equal((await r.db.query('users','perfil','entrenador')).length,1);
 await assert.rejects(r.write({kind:'user',mail},profile,v),/VERSION_CONFLICT/);
 assert.equal((await r.read<any>({kind:'user',mail}))?.data.perfil,'entrenador');
 for(const d of f.docs.values()){const json=JSON.stringify(d.fields);assert.ok(!json.includes('bytesValue'));assert.ok(!json.includes('inline'));}
});
test('Native repertoire >1 MiB retains Unicode, order, UUID, comments, checkpoints and removes retired revisions',async()=>{
 const f=await structuredFixture(),r=new DomainRepositories(f.env,f.transport),data=cloneTemplate(template);
 data.positions[0].tecnicas[0].descripcion_del_alumno='漢'.repeat(100000);data.positions[0].tecnicas[1].descripcion_del_alumno='á'.repeat(100000);data.positions[0].tecnicas[2].descripcion_del_alumno='漢'.repeat(100000);data.positions[0].tecnicas[3].descripcion_del_alumno='漢'.repeat(100000);
 data.descriptionUpdates={[data.positions[0].tecnicas[0].id]:'unchanged-version'};data.deletionCatalog=[{id:data.positions[0].id,priority:1,techniques:data.positions[0].tecnicas.map(t=>t.id)}];
 assert.ok(new TextEncoder().encode(JSON.stringify(data)).length>1024*1024);let v=await r.write(ref,data,null);assert.deepEqual((await r.read(ref))?.data,data);
 const root=await r.db.get(r.path(ref)),old=root!.data.activeRevision.split('/').at(-1);
 data.positions[0].posicion+=' updated';forceStaging(data);v=await r.write(ref,data,v);assert.deepEqual((await r.read(ref))?.data,data);assert.ok(![...f.docs.keys()].some(k=>k.includes('/revisions/'+old)));
 await r.remove(ref,v);assert.equal(await r.read(ref),null);assert.ok(![...f.docs.keys()].some(k=>k.includes('user_techniques/')));
});
test('Native generation publication resolves a lost ACK without replay; failed staging leaves the old entity and no orphan revision',async()=>{
 const f=await structuredFixture(),r=new DomainRepositories(f.env,f.transport),data=cloneTemplate(template);let v=await r.write(ref,data,null);
 data.positions[0].posicion='Confirmed';f.losePublicationAck();v=await r.write(ref,data,v);assert.equal((await r.read<any>(ref))?.data.positions[0].posicion,'Confirmed');
 const before=[...f.docs.keys()].sort();f.failStage();forceStaging(data);data.positions[0].posicion='Must not publish';await assert.rejects(r.write(ref,data,v));assert.deepEqual([...f.docs.keys()].sort(),before);assert.equal((await r.read<any>(ref))?.data.positions[0].posicion,'Confirmed');
});
test('Native plan roundtrips all frozen generated/recalculated references and cursor signatures without changing the domain',async()=>{
 const baseline=JSON.parse(readFileSync(new URL('./fixtures/firestore/domain-baseline.json',import.meta.url),'utf8'));
 for(const scenario of baseline.fixtures){const f=await structuredFixture(),r=new DomainRepositories(f.env,f.transport);for(const expected of [scenario.expected.generated,...(scenario.expected.result?[scenario.expected.result]:[])]){
  const address={kind:'plan' as const,mail:expected.mail,planId:expected.planId};const prior=await r.read(address);await r.write(address,expected,prior?.sha||null);const actual=(await r.read<any>(address))!.data;assert.deepEqual(actual,expected,scenario.name);
  for(let i=0;i<(actual.continuity?.boundaries.length||0);i++)assert.equal(cursorSignature(actual.continuity.boundaries[i].cursor),cursorSignature(expected.continuity.boundaries[i].cursor),scenario.name);
 }}
});

test('Native concurrent publication keeps exactly one revision, with no losing staged children',async()=>{
 const f=await structuredFixture(),a=new DomainRepositories(f.env,f.transport),b=new DomainRepositories(f.env,f.transport),value=cloneTemplate(template);
 const version=await a.write(ref,value,null),one=structuredClone(value),two=structuredClone(value);one.positions[0].posicion='One';two.positions[0].posicion='Two';
 const results=await Promise.allSettled([a.write(ref,one,version),b.write(ref,two,version)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 const revisions=await a.db.list(a.path(ref)+'/revisions');assert.equal(revisions.length,1);const restored=(await a.read<any>(ref))!.data;assert.ok(['One','Two'].includes(restored.positions[0].posicion));
});

test('A reader whose published revision is retired retries the new complete native revision',async()=>{
 const f=await structuredFixture(),a=new DomainRepositories(f.env,f.transport),b=new DomainRepositories(f.env,f.transport),value=cloneTemplate(template);
 const version=await a.write(ref,value,null),root=(await a.db.get(a.path(ref)))!,old=root.data.activeRevision.split('/documents/')[1];
 const next=structuredClone(value);next.positions[0].posicion='New complete revision';const children=a.db.children.bind(a.db);let replacement:Promise<string>|undefined;
 a.beginOperation();a.db.children=async path=>{if(path===old){replacement ||= b.write(ref,next,version);await replacement;}return children(path);};
 assert.deepEqual((await a.read(ref))?.data,next);a.endOperation();
});

test('An unavailable publication verification never deletes a possibly active native revision',async()=>{
 const f=await structuredFixture();let unavailable=0;const transport:typeof f.transport=async(url,init)=>{if(unavailable&&url.includes('/documents/user_techniques/')&&(!init?.method||init.method==='GET')){unavailable--;throw Error('temporary verification outage');}try{return await f.transport(url,init);}catch(e){if(String(init?.body).includes('publicationId'))unavailable=2;throw e;}};
 const r=new DomainRepositories(f.env,transport),value=cloneTemplate(template),version=await r.write(ref,value,null);value.positions[0].posicion='Published despite lost ACK';f.losePublicationAck();await assert.rejects(r.write(ref,value,version));
 assert.deepEqual((await r.read(ref))?.data,value);await r.cleanupEntity(ref);assert.ok(![...f.docs.keys()].some(k=>k.includes('/user_techniques/')));
});


test('Revision query reads only immediate children and invalidates its operation cache after a write',async()=>{
 const f=await structuredFixture(),r=new DomainRepositories(f.env,f.transport),db=r.db;
 await db.commit([db.update('scope/one/positions/p',{ordinal:0}),db.update('scope/one/techniques/t',{ordinal:1}),db.update('scope/two/positions/other',{ordinal:0}),db.update('scope/one/positions/p/details/nested',{secret:true})]);
 db.beginOperation();const before=f.calls.length;
 assert.deepEqual((await db.children('scope/one')).map(row=>row.path).sort(),['scope/one/positions/p','scope/one/techniques/t']);
 assert.equal(f.calls.length,before+1);await db.children('scope/one');assert.equal(f.calls.length,before+1);
 await db.commit([db.update('scope/one/techniques/next',{ordinal:2})]);
 assert.equal((await db.children('scope/one')).length,3);assert.equal(f.calls.length,before+3);db.endOperation();
});


test('Fresh repository reads bypass both aggregate and native document/query caches',async()=>{
 const f=await structuredFixture(),a=new DomainRepositories(f.env,f.transport),b=new DomainRepositories(f.env,f.transport),value=cloneTemplate(template);
 const version=await a.write(ref,value,null);a.beginOperation();await a.read(ref);
 value.positions[0].posicion='External concurrent value';await b.write(ref,value,version);
 assert.deepEqual((await a.read(ref,true))?.data,value);a.endOperation();
});
test('Confirmed publication succeeds when old-revision collection fails and durable retirement can recover',async()=>{
 const f=await structuredFixture(),r=new DomainRepositories(f.env,f.transport),value=cloneTemplate(template);const version=await r.write(ref,value,null);
 const remove=r.removeGeneration.bind(r);r.removeGeneration=async()=>{throw Error('cleanup unavailable');};value.positions[0].posicion='Commit confirmed';forceStaging(value);
 const saved=await r.write(ref,value,version);assert.deepEqual((await r.read(ref))?.data,value);assert.ok(saved);
 assert.equal((await r.db.list('revision_cleanup')).length,1);r.removeGeneration=remove;
 await r.collectRetired();assert.equal((await r.db.list('revision_cleanup')).length,0);assert.equal((await r.db.list(r.path(ref)+'/revisions')).length,1);
});

test('An oversized native document is rejected before any revision is staged or published',async()=>{
 const f=await structuredFixture(),r=new DomainRepositories(f.env,f.transport),value=cloneTemplate(template);const version=await r.write(ref,value,null),before=[...f.docs.keys()].sort();
 value.positions[0].tecnicas[0].descripcion_del_alumno='á'.repeat(600000);
 await assert.rejects(r.write(ref,value,version),/NATIVE_DOCUMENT_TOO_LARGE/);assert.deepEqual([...f.docs.keys()].sort(),before);
});
test('Collection inventory follows page tokens and large batches are bounded',async()=>{
 const f=await structuredFixture();let pages=0;const transport:typeof f.transport=async(url,init)=>{
  if(url.endsWith(':listCollectionIds')){pages++;const body=JSON.parse(String(init?.body));return Response.json(body.pageToken?{collectionIds:['second']}:{collectionIds:['first'],nextPageToken:'next'});}return f.transport(url,init);
 };
 const r=new DomainRepositories(f.env,transport);assert.deepEqual(await r.db.collectionIds(),['first','second']);assert.equal(pages,2);
 await r.db.commitChunks(Array.from({length:451},(_,n)=>r.db.update('batch/document-'+n,{n},null)));
 assert.equal(f.calls.filter(c=>c.url.endsWith('/documents:commit')).length,2);
});

test('Explicit private execution failures retain their diagnostic code rather than becoming network retries',async()=>{
 const f=await structuredFixture(),repo=new DomainRepositories(f.env,async(url,init)=>{if(url.includes('firestore.googleapis.com'))throw new ApiError(503,'PRIVATE_IO_BUILD_MISMATCH');return f.transport(url,init);});
 await assert.rejects(repo.read({kind:'user',mail:'missing@example.test'}),/PRIVATE_IO_BUILD_MISMATCH/);
});

test('Session packing preserves boundary order and falls back for boundaries without a session',async()=>{
 const baseline=JSON.parse(readFileSync(new URL('./fixtures/firestore/domain-baseline.json',import.meta.url),'utf8'));
 const original=baseline.fixtures.map((s:any)=>s.expected.generated).find((p:any)=>p.continuity?.boundaries.length>1);
 assert.ok(original);const value=structuredClone(original);value.continuity.boundaries.reverse();
 const f=await structuredFixture(),r=new DomainRepositories(f.env,f.transport),address={kind:'plan' as const,mail:value.mail,planId:value.planId};
 const first=await r.write(address,value,null);assert.deepEqual((await r.read(address))!.data,value);
 value.continuity.boundaries.push({...structuredClone(value.continuity.boundaries[0]),date:'1900-01-01'});
 await r.write(address,value,first);assert.deepEqual((await r.read(address))!.data,value);
});
