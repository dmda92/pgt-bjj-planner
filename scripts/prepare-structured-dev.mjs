import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const origin='https://pgt-github-probe-dev.david-dzm5.workers.dev';
const allowed=['refs/heads/develop'];
if(!allowed.includes(process.env.GITHUB_REF)||!process.env.CLOUDFLARE_API_TOKEN)throw Error('AUTHORIZED_STRUCTURED_DEV_PIPELINE_REQUIRED');
async function call(path,body){const r=await fetch(origin+path,{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});let value;try{value=await r.json();}catch{throw Error('DEV administrative response is not JSON');}if(!r.ok)throw Error('DEV administrative operation failed: '+r.status+' '+(value.error||'UNKNOWN'));return value;}
async function traverse(mode,scope='legacy',inventoryHash){let cursor,result;for(let n=0;n<5000;n++){result=await call('/api/dev/structured-maintenance',{project:'pgt-bjj-dev',mode,scope,inventoryHash,cursor});if(result.done)return result;cursor=result.cursor;}throw Error('DEV traversal exceeded bound');}
const completeInventory=await traverse('inventory','all');console.log(JSON.stringify({phase:'complete_inventory',counts:completeInventory.counts,orphans:completeInventory.orphans}));
const inventory=await traverse('inventory');
console.log(JSON.stringify({phase:'legacy_inventory',counts:inventory.counts,orphans:inventory.orphans,manualDEVTestRegistrations:inventory.manualDEVTestRegistrations,syntheticUsers:inventory.syntheticUsers,inventoryHash:inventory.inventoryHash}));
const cleanup=await traverse('delete','legacy',inventory.inventoryHash);assert.deepEqual(cleanup.legacyCollectionsRemaining,[]);
const reference=await call('/api/dev/structured-bootstrap',{});assert.equal(reference.project,'pgt-bjj-dev');assert.equal(reference.sourceBlob,'bfb542c79a086ad6f6e8a9cd5cff0efd2e46635e');assert.equal(reference.positions,17);assert.equal(reference.techniques,36);assert.equal(reference.orderAndContentVerified,true);
// Recover only provisioned QA runs from interrupted prior attempts, preserving
// all unrelated DEV users and their data in the new model.
const runs=await call('/api/dev/structured-qa-runs',{});
for(const run of runs.runs){assert.equal(run.purpose,'isolated_browser_qa');for(let n=0;n<200;n++){const result=await call('/api/dev/synthetic-fixture-cleanup',{runId:run.id,password:'administrative-cleanup-not-a-user-password'});if(result.status==='SYNTHETIC_FIXTURE_CLEANED')break;if(n===199)throw Error('Interrupted QA cleanup did not complete');}}
const report={project:'pgt-bjj-dev',completeInventory:completeInventory.counts,legacyInventory:inventory.counts,legacyOrphans:inventory.orphans,deleted:cleanup.deleted,legacyCollectionsRemaining:[],reference,provenance:'DEV started empty; legacy real-account migration prohibited and absent; owner-created DEV test registrations explicitly authorized for deletion',productionOperations:0};
await mkdir('artifacts',{recursive:true});await writeFile('artifacts/structured-dev-preparation.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
