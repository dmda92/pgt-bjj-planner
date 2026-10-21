import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
if(!['refs/heads/develop','refs/heads/feature/firestore-structured-model'].includes(process.env.GITHUB_REF)||!process.env.CLOUDFLARE_API_TOKEN)throw Error('AUTHORIZED_DEV_PIPELINE_REQUIRED');
const origin='https://pgt-github-probe-dev.david-dzm5.workers.dev';let cursor,report;
for(let n=0;n<5000;n++){
 const r=await fetch(origin+'/api/dev/structured-maintenance',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({project:'pgt-bjj-dev',mode:'inventory',scope:'all',cursor}),signal:AbortSignal.timeout(60000)});assert.equal(r.status,200,'Post-QA inventory failed');report=await r.json();if(report.done)break;cursor=report.cursor;if(n===4999)throw Error('Post-QA traversal did not complete');
}
for(const name of ['pgt_resources','pgt_qa_runs','pgt_changes','qa_runs'])assert.equal(report.counts[name]||0,0,name+' remains');assert.ok(Object.values(report.orphans).every(n=>n===0),'Orphan parent remains');
const result={status:'STRUCTURED_DEV_INTEGRITY_VERIFIED',project:'pgt-bjj-dev',documentsByRootCollection:report.counts,orphans:report.orphans,legacyCollections:0,residualQARuns:0,productionOperations:0};
await mkdir('artifacts',{recursive:true});await writeFile('artifacts/structured-dev-integrity.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
