import {test} from 'node:test';
import assert from 'node:assert/strict';
import {structuredFixture} from './structured-firestore-fixture.ts';
import {DomainRepositories} from '../worker/structured/repositories.ts';
import {seedStructuredQA,checkStructuredQA} from '../worker/structured/qa.ts';
import {template} from './template-fixture.ts';
test('Pre-login QA independently reads native profiles and private hashes, detects missing credentials, and exposes no secrets',async()=>{
 const f=await structuredFixture(),repo=new DomainRepositories(f.env,f.transport),runId=crypto.randomUUID(),password='isolated-credential-check-password-2026';
 await repo.write({kind:'template'},template,null);
 await seedStructuredQA(repo,runId,password);await seedStructuredQA(repo,runId,password);
 const report=await checkStructuredQA(repo,runId,password);
 for(const user of report.users)for(const key of ['profileExists','credentialsExist','hashFormatValid','repositoryRestoresHash','passwordMatches','profileRoleCorrect'] as const)assert.equal(user[key],true,key);
 const credential=(await repo.db.get('users/pgt-dev-'+runId+'-trainer@example.test/private/credentials'))!;
 const serialized=JSON.stringify(report);assert.ok(!serialized.includes(password));assert.ok(!serialized.includes(credential.data.passwordHash));assert.ok(!serialized.includes('pbkdf2-sha256$'));
 await repo.db.deleteRows([credential]);
 const missing=await checkStructuredQA(repo,runId,password);assert.equal(missing.users[0].profileExists,true);assert.equal(missing.users[0].credentialsExist,false);assert.equal(missing.users[0].passwordMatches,false);
 await assert.rejects(checkStructuredQA(repo,crypto.randomUUID(),password),/SYNTHETIC_RUN_REQUIRED/);
});
