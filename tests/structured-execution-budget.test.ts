import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ExecutionBudget,budgetedFirestoreRequest,type BudgetStorage,type BudgetSetup,type BudgetEndpoint,type BudgetKV} from '../worker/structured/execution-budget.ts';
function memory():BudgetStorage{
 const data=new Map<string,unknown>();let queue=Promise.resolve();const kv:BudgetKV={async get<T>(key:string){return structuredClone(data.get(key)) as T|undefined;},async put<T>(key:string,value:T){data.set(key,structuredClone(value));}};
 return {transaction<T>(fn:(store:BudgetKV)=>Promise<T>){const action=queue.then(()=>fn(kv));queue=action.then(()=>{},()=>{});return action;}};
}
const setup=():BudgetSetup=>({project:'pgt-bjj-dev',build:'a'.repeat(40),limits:{reads:10,writes:3,deletes:3},cleanup:{reads:3,writes:1,deletes:2},expiresAt:Date.now()+60000});
const api=(b:ExecutionBudget):BudgetEndpoint=>({budgetReserve:(p,r)=>b.reserve(p,r),budgetSettle:(id,n,u)=>b.settle(id,n,u)});
const base='https://firestore.googleapis.com/v1/projects/pgt-bjj-dev/databases/(default)/documents';
test('Multiple executors share atomic reservations; cleanup remains protected and execution cannot restart',async()=>{
 const storage=memory(),one=new ExecutionBudget(storage),two=new ExecutionBudget(storage);await one.open(setup());
 const results=await Promise.allSettled([one.reserve('scenario',{writes:1}),two.reserve('scenario',{writes:1}),two.reserve('scenario',{writes:1})]);
 assert.equal(results.filter(v=>v.status==='fulfilled').length,2);assert.equal(results.filter(v=>v.status==='rejected').length,1);
 for(const r of results)if(r.status==='fulfilled'){await two.settle(r.value.id);await one.settle(r.value.id);}
 assert.equal((await one.status()).spent.scenario.writes,2);assert.equal((await one.status()).stopped,true);await assert.rejects(one.reserve('scenario',{reads:1}),/SCENARIO_STOPPED/);
 const cleanup=await two.reserve('cleanup',{reads:3,writes:1,deletes:2});await one.settle(cleanup.id);
 await assert.rejects(one.reserve('scenario',{reads:1}),/SCENARIO_STOPPED/);
 const status=await one.close();assert.deepEqual(status.spent.cleanup,{reads:3,writes:1,deletes:2,http:1,queries:0});
 await assert.rejects(two.open(setup()),/EXECUTION_ALREADY_STARTED/);await assert.rejects(two.reserve('cleanup',{reads:1}),/EXECUTION_CLOSED/);
});
test('Query reservations release only unused reads after response; truncated results never enter business logic',async()=>{
 const b=new ExecutionBudget(memory());await b.open(setup());let calls=0;
 const response=await budgetedFirestoreRequest(api(b),'scenario',base+':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:{from:[{collectionId:'users'}]}})},async(_url,init)=>{calls++;assert.equal(JSON.parse(String(init.body)).structuredQuery.limit,7);return Response.json([{document:{name:'one'}},{document:{name:'two'}}]);});
 assert.equal(response.status,200);assert.equal((await b.status()).spent.scenario.reads,2);
 await assert.rejects(budgetedFirestoreRequest(api(b),'scenario',base+':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:{from:[{collectionId:'users'}]}})},async(_url,init)=>{calls++;const n=JSON.parse(String(init.body)).structuredQuery.limit;return Response.json(Array.from({length:n},()=>({document:{name:'row'}})));}),/QUERY_BUDGET_BOUNDARY/);
 assert.equal((await b.status()).spent.scenario.reads,7);assert.equal(calls,2);assert.equal((await b.status()).stopped,true);
});
test('Unknown write outcome consumes its full reservation; no automatic resend; cleanup survives scenario failure',async()=>{
 const b=new ExecutionBudget(memory());await b.open(setup());let calls=0;
 const send=()=>{calls++;return Promise.reject(Error('Lost Google reply'));};
 await assert.rejects(budgetedFirestoreRequest(api(b),'scenario',base+':commit',{method:'POST',body:JSON.stringify({writes:[{update:{name:base.slice('https://firestore.googleapis.com/v1/'.length)+'/test/one',fields:{}}},{update:{name:base.slice('https://firestore.googleapis.com/v1/'.length)+'/test/two',fields:{}}}]})},send),/Lost Google reply/);
 assert.equal((await b.status()).spent.scenario.writes,2);
 await assert.rejects(budgetedFirestoreRequest(api(b),'scenario',base+'/test/one',{},send),/SCENARIO_STOPPED/);assert.equal(calls,1);
 const cleanup=await b.reserve('cleanup',{deletes:2});await b.settle(cleanup.id);assert.equal((await b.status()).spent.cleanup.deletes,2);
});
test('In-flight reservations survive reconstructed ledger and cannot be credited back without settlement',async()=>{
 const store=memory(),a=new ExecutionBudget(store);await a.open(setup());await a.reserve('scenario',{reads:7});
 const restored=new ExecutionBudget(store);await assert.rejects(restored.reserve('scenario',{reads:1}),/BUDGET_EXCEEDED/);await assert.rejects(restored.close(),/REQUESTS_IN_FLIGHT/);
 assert.equal((await restored.status()).held.reads,7);assert.equal((await restored.status()).inFlight,1);
});
test('Expired scenarios and unsupported/PRO requests do not reach Google',async()=>{
 const b=new ExecutionBudget(memory()),s=setup();await b.open(s);await assert.rejects(b.reserve('scenario',{reads:1},s.expiresAt+1),/SCENARIO_STOPPED/);
 let calls=0;const send=async()=>{calls++;return Response.json({});};
 for(const input of [base.replace('pgt-bjj-dev','pgt-bjj-pro')+'/users/a',base+'/../../other/doc'])await assert.rejects(budgetedFirestoreRequest(api(b),'scenario',input,{},send),/TARGET_INVALID/);
 await assert.rejects(budgetedFirestoreRequest(api(b),'scenario',base+':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:{from:[{collectionId:'users'}],offset:1}})},send),/QUERY_UNSUPPORTED/);await assert.rejects(budgetedFirestoreRequest(api(b),'scenario',base+':commit',{method:'POST',body:JSON.stringify({writes:[{delete:'projects/pgt-bjj-pro/databases/(default)/documents/users/a'}]})},send),/TARGET_INVALID/);assert.equal(calls,0);
});
