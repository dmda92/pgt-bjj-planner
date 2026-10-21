import {mkdir,writeFile} from 'node:fs/promises';
import {checkDevOperationGate} from './dev-operation-gate.mjs';
const origin='https://pgt-github-probe-dev.david-dzm5.workers.dev',build=process.env.PGT_EXPECTED_DEV_BUILD;
if(process.env.GITHUB_REF!=='refs/heads/develop'||!process.env.CLOUDFLARE_API_TOKEN||!/^[0-9a-f]{40}$/.test(build||''))throw Error('EXPLICIT_DEVELOP_SMOKE_REQUIRED');
let quota;try{quota=JSON.parse(process.env.PGT_DEV_QUOTA_EVIDENCE||'');}catch{throw Error('RELIABLE_FRESH_QUOTA_REQUIRED');}
const plan={project:'pgt-bjj-dev',build,measuredLocally:true,includesCleanup:true,total:{reads:200,writes:150,deletes:50},users:1,realExecutionsForBuild:0};
// No HTTP, including readiness probes, before the quota gate succeeds.
checkDevOperationGate(quota,plan,{build});
const response=await fetch(origin+'/api/dev/budget-smoke',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({quota,plan}),signal:AbortSignal.timeout(120000)});
let report;try{report=await response.json();}catch{throw Error('DEV_SMOKE_RESPONSE_UNCERTAIN_DO_NOT_RETRY');}
await mkdir('artifacts',{recursive:true});await writeFile('artifacts/firestore-dev-smoke.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
if(!response.ok||report.status!=='DEV_MINIMAL_SMOKE_VERIFIED'||report.build!==build||!report.cleanup?.clean||!report.budgetClosed)throw Error('DEV_MINIMAL_SMOKE_FAILED_DO_NOT_RETRY');
