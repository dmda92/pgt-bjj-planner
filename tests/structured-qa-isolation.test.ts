import {test} from 'node:test';import assert from 'node:assert/strict';
import {structuredFixture} from './structured-firestore-fixture.ts';
import {DomainRepositories} from '../worker/structured/repositories.ts';
import {cleanStructuredQA} from '../worker/structured/qa.ts';
import {initialVersion} from '../src/domain/models.ts';
test('QA cleanup removes only its derived tombstone from an unrelated native assignment',async()=>{
 const f=await structuredFixture(),repo=new DomainRepositories(f.env,f.transport),runId=crypto.randomUUID(),owned=crypto.randomUUID(),real=crypto.randomUUID(),mail='existing-native@example.test';
 await repo.db.commit([repo.db.update('qa_runs/'+runId,{purpose:'isolated_browser_qa',competitionIds:[owned],pending:[]},null)]);
 await repo.write({kind:'assignment',mail},{...initialVersion(),planIds:[],deletedPlanIds:[real,owned]},null);
 let result;for(let n=0;n<4;n++){result=await cleanStructuredQA(repo,runId);if(result.status==='SYNTHETIC_FIXTURE_CLEANED')break;}
 assert.equal(result?.status,'SYNTHETIC_FIXTURE_CLEANED');assert.deepEqual((await repo.read<any>({kind:'assignment',mail}))?.data.deletedPlanIds,[real]);
});
test('QA cleanup refuses to remove an assignment still shared with an unrelated user',async()=>{
 const f=await structuredFixture(),repo=new DomainRepositories(f.env,f.transport),runId=crypto.randomUUID(),owned=crypto.randomUUID(),mail='shared-native@example.test';
 await repo.db.commit([repo.db.update('qa_runs/'+runId,{purpose:'isolated_browser_qa',competitionIds:[owned],pending:[]},null)]);
 await repo.write({kind:'assignment',mail},{...initialVersion(),planIds:[owned],deletedPlanIds:[]},null);
 await assert.rejects(cleanStructuredQA(repo,runId),/SYNTHETIC_SHARED_PLAN_NOT_CLEANED/);
 assert.deepEqual((await repo.read<any>({kind:'assignment',mail}))?.data.planIds,[owned]);assert.ok(await repo.db.get('qa_runs/'+runId));
});
