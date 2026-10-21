import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DomainRepositories} from '../worker/structured/repositories.ts';
import {structuredFixture} from './structured-firestore-fixture.ts';
import {cloneTemplate,initialVersion} from '../src/domain/models.ts';
import {cursorSignature} from '../src/domain/plan-continuity.ts';
import {template} from './template-fixture.ts';
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
 data.positions[0].posicion+=' updated';v=await r.write(ref,data,v);assert.deepEqual((await r.read(ref))?.data,data);assert.ok(![...f.docs.keys()].some(k=>k.includes('/revisions/'+old)));
 await r.remove(ref,v);assert.equal(await r.read(ref),null);assert.ok(![...f.docs.keys()].some(k=>k.includes('user_techniques/')));
});
test('Native generation publication resolves a lost ACK without replay; failed staging leaves the old entity and no orphan revision',async()=>{
 const f=await structuredFixture(),r=new DomainRepositories(f.env,f.transport),data=cloneTemplate(template);let v=await r.write(ref,data,null);
 data.positions[0].posicion='Confirmed';f.losePublicationAck();v=await r.write(ref,data,v);assert.equal((await r.read<any>(ref))?.data.positions[0].posicion,'Confirmed');
 const before=[...f.docs.keys()].sort();f.failStage();data.positions[0].posicion='Must not publish';await assert.rejects(r.write(ref,data,v));assert.deepEqual([...f.docs.keys()].sort(),before);assert.equal((await r.read<any>(ref))?.data.positions[0].posicion,'Confirmed');
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
 const next=structuredClone(value);next.positions[0].posicion='New complete revision';const list=a.db.list.bind(a.db);let replacement:Promise<string>|undefined;
 a.beginOperation();a.db.list=async path=>{if(path.startsWith(old+'/')){replacement ||= b.write(ref,next,version);await replacement;}return list(path);};
 assert.deepEqual((await a.read(ref))?.data,next);a.endOperation();
});

test('An unavailable publication verification never deletes a possibly active native revision',async()=>{
 const f=await structuredFixture();let unavailable=0;const transport:typeof f.transport=async(url,init)=>{if(unavailable&&url.includes('/documents/user_techniques/')&&(!init?.method||init.method==='GET')){unavailable--;throw Error('temporary verification outage');}try{return await f.transport(url,init);}catch(e){if(String(init?.body).includes('publicationId'))unavailable=2;throw e;}};
 const r=new DomainRepositories(f.env,transport),value=cloneTemplate(template),version=await r.write(ref,value,null);value.positions[0].posicion='Published despite lost ACK';f.losePublicationAck();await assert.rejects(r.write(ref,value,version));
 assert.deepEqual((await r.read(ref))?.data,value);await r.cleanupEntity(ref);assert.ok(![...f.docs.keys()].some(k=>k.includes('/user_techniques/')));
});
