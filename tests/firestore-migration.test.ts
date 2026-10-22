import {test} from 'node:test';import assert from 'node:assert/strict';
import {inspectMigration,migrateSynthetic} from './legacy-file-migration.ts';
import {firestoreFixture} from './firestore-fixture.ts';import {FirestoreStorage} from './legacy-file-store.ts';
import {template} from './template-fixture.ts';import {cloneTemplate,initialVersion} from '../src/domain/models.ts';
const mail='pgt-dev-migration@example.test',base='PGT/users_data/'+mail+'/';
const records=[{path:'PGT/master_data/tecnics_base.json',data:template},{path:base+'user_data.json',data:{...initialVersion(),mail,nombre:'Test',apellidos:'Synthetic',fecha_nacimiento:null,peso:71.125,cinturon:'Negro',perfil:'alumno',pwd:'pbkdf2-sha256$600000$synthetic-salt$unchanged-hash'}},{path:base+'tecnics.json',data:cloneTemplate(template)},{path:base+'trainer_comments.json',data:{...initialVersion(),comments:[]}},{path:base+'plans_index.json',data:{...initialVersion(),planIds:[]}}];
test('Synthetic migration dry-run has no network; import roundtrip retains UUID/password/order and is idempotent',async()=>{
 const f=await firestoreFixture(),s=new FirestoreStorage(f.env,f.transport);
 const before=JSON.stringify(records),dry=await migrateSynthetic(s,records,{project:'pgt-bjj-dev',dryRun:true});assert.equal(f.calls.length,0);assert.equal(dry.records,5);
 const first=await migrateSynthetic(s,records,{project:'pgt-bjj-dev',dryRun:false});assert.equal(first.created,5);
 const again=await migrateSynthetic(s,records,{project:'pgt-bjj-dev',dryRun:false});assert.equal(again.created,0);assert.equal(again.unchanged,5);assert.equal(JSON.stringify(records),before);
 assert.deepEqual((await s.read(base+'tecnics.json'))?.data,records[2].data);assert.deepEqual((await s.read(base+'user_data.json'))?.data,records[1].data);
});
test('Migration refuses foreign project, non-synthetic owners, duplicate resources and broken plan references',async()=>{
 await assert.rejects(inspectMigration(records,'foreign'));
 await assert.rejects(inspectMigration([{path:'PGT/users_data/real@example.com/user_data.json',data:{}}],'pgt-bjj-dev'),/ONLY_SYNTHETIC/);
 await assert.rejects(inspectMigration([...records,records[0]],'pgt-bjj-dev'),/DUPLICATE/);
 const broken=structuredClone(records);(broken[4].data as any).planIds=['e'.repeat(36)];await assert.rejects(inspectMigration(broken,'pgt-bjj-dev'),/REFERENCE/);
});
