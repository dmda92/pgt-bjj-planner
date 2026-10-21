import {ApiError} from '../security.ts';
export type Counts={reads:number;writes:number;deletes:number};
export type BudgetPhase='scenario'|'cleanup';
export type BudgetCost=Counts&{http:number;queries:number};
export type BudgetReservation={id:string;phase:BudgetPhase;cost:BudgetCost;readLimit?:number};
export interface BudgetKV {get<T>(key:string):Promise<T|undefined>;put<T>(key:string,value:T):Promise<unknown>}
export interface BudgetStorage {transaction<T>(fn:(store:BudgetKV)=>Promise<T>):Promise<T>}
export type BudgetSetup={project:'pgt-bjj-dev';build:string;limits:Counts;cleanup:Counts;expiresAt:number;runId?:string};
type State=BudgetSetup&{spent:Record<BudgetPhase,BudgetCost>;held:BudgetReservation[];completed:string[];stopped:boolean;cleaning:boolean;closed:boolean;smokeStarted?:boolean};
const empty=():BudgetCost=>({reads:0,writes:0,deletes:0,http:0,queries:0});
const dims=['reads','writes','deletes'] as const;
const key='firestore-test-execution-budget-v1';
const fail=(code:string):never=>{throw new ApiError(429,'FIRESTORE_TEST_'+code);};
const add=(a:BudgetCost,b:BudgetCost)=>Object.fromEntries(Object.keys(a).map(k=>[k,a[k as keyof BudgetCost]+b[k as keyof BudgetCost]])) as BudgetCost;
/** One durable metadata ledger per explicit test execution. Transactions serialize
 * reservations from all private executors; no business data, credentials or paths.
 * In-flight requests retain their upper bound until settlement. Lost responses
 * retain reservations: uncertain quota is never credited back optimistically. */
export class ExecutionBudget {
 private storage:BudgetStorage;
 constructor(storage:BudgetStorage){this.storage=storage;}
 async open(setup:BudgetSetup,now=Date.now()){
  if(setup.project!=='pgt-bjj-dev'||!/^[0-9a-f]{40}$/.test(setup.build)||!Number.isFinite(setup.expiresAt)||setup.expiresAt<=now||setup.expiresAt>now+10*60*1000)fail('SETUP_INVALID');
  for(const d of dims)if(!Number.isSafeInteger(setup.limits[d])||setup.limits[d]<0||setup.limits[d]>({reads:200,writes:150,deletes:50})[d]||!Number.isSafeInteger(setup.cleanup[d])||setup.cleanup[d]<0||setup.cleanup[d]>setup.limits[d])fail('SETUP_INVALID');
  if(!setup.cleanup.reads||!setup.cleanup.deletes)fail('CLEANUP_RESERVE_REQUIRED');
  return this.storage.transaction(async store=>{
   if(await store.get<State>(key))fail('EXECUTION_ALREADY_STARTED');
   const state:State={...structuredClone(setup),spent:{scenario:empty(),cleanup:empty()},held:[],completed:[],stopped:false,cleaning:false,closed:false};
   await store.put(key,state);return this.summary(state);
  });
 }
 private summary(s:State){return {project:s.project,build:s.build,runId:s.runId,smokeStarted:!!s.smokeStarted,limits:s.limits,cleanupReserve:s.cleanup,spent:s.spent,held:s.held.reduce((a,r)=>add(a,r.cost),empty()),inFlight:s.held.length,stopped:s.stopped,cleaning:s.cleaning,closed:s.closed,estimateOnly:true};}
 async status(){return this.storage.transaction(async store=>{const state=await store.get<State>(key);if(!state)fail('EXECUTION_NOT_STARTED');return this.summary(state!);});}
 async claimSmoke(){return this.storage.transaction(async store=>{
  const s=await store.get<State>(key);if(!s||!s.runId||!/^([0-9a-f]{8}-[0-9a-f-]{27})$/.test(s.runId))fail('SMOKE_NOT_PREPARED');
  if(s!.smokeStarted||s!.closed||s!.stopped||s!.cleaning||Date.now()>s!.expiresAt)fail('SMOKE_ALREADY_STARTED');
  s!.smokeStarted=true;await store.put(key,s!);return {runId:s!.runId};
 });}
 async reserve(phase:BudgetPhase,request:{writes?:number;deletes?:number;reads?:number;queryCeiling?:number},now=Date.now()):Promise<BudgetReservation>{
  if(!['scenario','cleanup'].includes(phase))fail('PHASE_INVALID');
  for(const value of Object.values(request))if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)fail('COST_INVALID');
  const result=await this.storage.transaction<BudgetReservation|{denial:string}>(async store=>{
   const state=await store.get<State>(key);if(!state)fail('EXECUTION_NOT_STARTED');const s=state!;
   const deny=async()=>{s.stopped=true;if(phase==='cleanup')s.closed=true;await store.put(key,s);return {denial:'BUDGET_EXCEEDED'};};
   if(s.closed)fail('EXECUTION_CLOSED');
   if(phase==='scenario'&&(s.stopped||s.cleaning||now>s.expiresAt))fail('SCENARIO_STOPPED');
   // Cleanup remains available after an expired/failed scenario, using its
   // reserved portion. Starting it permanently closes the scenario phase.
   const held=s.held.reduce((a,r)=>add(a,r.cost),empty()),all=add(add(s.spent.scenario,s.spent.cleanup),held);
   const scenarioHeld=s.held.filter(r=>r.phase==='scenario').reduce((a,r)=>add(a,r.cost),empty());
   const available=Object.fromEntries(dims.map(d=>[d,Math.min(s.limits[d]-all[d],phase==='scenario'?s.limits[d]-s.cleanup[d]-s.spent.scenario[d]-scenarioHeld[d]:s.limits[d]-all[d])])) as Counts;
   const cost:BudgetCost={...empty(),reads:request.reads||0,writes:request.writes||0,deletes:request.deletes||0,http:1,queries:request.queryCeiling===undefined?0:1};
   let readLimit:number|undefined;
   if(request.queryCeiling!==undefined){readLimit=Math.min(request.queryCeiling,available.reads);if(readLimit<1)return deny();cost.reads=readLimit;}
   if(dims.some(d=>cost[d]>available[d])||all.http>=512)return deny();
   const reservation:BudgetReservation={id:crypto.randomUUID(),phase,cost,...(readLimit!==undefined?{readLimit}:{})};
   s.held.push(reservation);if(phase==='cleanup')s.cleaning=true;
   await store.put(key,s);return reservation;
  });
  if('denial' in result)fail(result.denial);
  return result as BudgetReservation;
 }
 async settle(id:string,actualReads?:number,uncertain=false){
  return this.storage.transaction(async store=>{
   const state=await store.get<State>(key);if(!state)fail('EXECUTION_NOT_STARTED');const s=state!;
   if(s.completed.includes(id))return this.summary(s); // Lost settlement ACK is idempotent.
   const i=s.held.findIndex(r=>r.id===id);if(i<0)fail('RESERVATION_UNKNOWN');const r=s.held[i],cost={...r.cost};
   if(actualReads!==undefined){if(!Number.isSafeInteger(actualReads)||actualReads<0||actualReads>cost.reads)fail('ACTUAL_COST_INVALID');cost.reads=actualReads;}
   s.held.splice(i,1);s.spent[r.phase]=add(s.spent[r.phase],cost);s.completed.push(id);
   if(uncertain&&r.phase==='scenario')s.stopped=true;
   await store.put(key,s);return this.summary(s);
  });
 }
 async close(){return this.storage.transaction(async store=>{const s=await store.get<State>(key);if(!s)fail('EXECUTION_NOT_STARTED');if(s!.held.length)fail('REQUESTS_IN_FLIGHT');s!.closed=true;await store.put(key,s!);return this.summary(s!);});}
}

export interface BudgetEndpoint {budgetReserve(phase:BudgetPhase,request:{reads?:number;writes?:number;deletes?:number;queryCeiling?:number}):Promise<BudgetReservation>;budgetSettle(id:string,actualReads?:number,uncertain?:boolean):Promise<unknown>}
const base='https://firestore.googleapis.com/v1/projects/pgt-bjj-dev/databases/(default)';
/** The shared ledger is consulted BEFORE every Google request. OAuth is outside
 * document billing; its token never reaches this ledger. Queries are capped and
 * a possibly truncated result is rejected rather than used as complete data. */
export async function budgetedFirestoreRequest(endpoint:BudgetEndpoint,phase:BudgetPhase,input:string,init:RequestInit,send:(input:string,init:RequestInit)=>Promise<Response>){
 const url=new URL(input);
 if(url.origin!=='https://firestore.googleapis.com'||!url.pathname.startsWith(new URL(base).pathname+'/')||/%2f|%5c|%2e/i.test(url.pathname)||url.hash)fail('TARGET_INVALID');
 const path=url.pathname,body=init.body?JSON.parse(String(init.body)):undefined;
 let request:{reads?:number;writes?:number;deletes?:number;queryCeiling?:number},boundary=false;
 if(path.endsWith('/documents:commit')){
  if(!Array.isArray(body?.writes)||!body.writes.length||body.writes.some((w:any)=>!w||!w.update&&!w.delete))fail('REQUEST_UNSUPPORTED');
  for(const w of body.writes){const name=w.update?.name||w.delete;if(typeof name!=='string'||!name.startsWith('projects/pgt-bjj-dev/databases/(default)/documents/')||name.split('/').some((p:string)=>!p||p==='.'||p==='..'))fail('TARGET_INVALID');}
  request={writes:body.writes.filter((w:any)=>w.update).length,deletes:body.writes.filter((w:any)=>w.delete).length};
 }else if(path.endsWith(':runQuery')){
  const q=body?.structuredQuery;if(!q||q.offset||q.findNearest||q.startAt||q.endAt||q.orderBy||q.where&&(!q.where.fieldFilter||q.where.fieldFilter.op!=='EQUAL'))fail('QUERY_UNSUPPORTED');
  request={queryCeiling:Math.min(q.limit??64,64)};
 }else if(path.endsWith(':listCollectionIds'))request={reads:1};
 else if((!init.method||init.method==='GET')&&path.includes('/documents/')){
  const parts=decodeURIComponent(path.split('/documents/')[1]).split('/');request=parts.length%2?{queryCeiling:Math.min(Number(url.searchParams.get('pageSize')||200),64)}:{reads:1};
 }else fail('REQUEST_UNSUPPORTED');
 const reservation=await endpoint.budgetReserve(phase,request!);let wire=input,options={...init};
 if(reservation.readLimit!==undefined){
  if(path.endsWith(':runQuery')){boundary=body.structuredQuery.limit===undefined||body.structuredQuery.limit>reservation.readLimit;body.structuredQuery.limit=reservation.readLimit;options.body=JSON.stringify(body);}
  else{url.searchParams.set('pageSize',String(reservation.readLimit));wire=url.toString();}
 }
 let response:Response;
 try{response=await send(wire,options);}catch(error){await endpoint.budgetSettle(reservation.id,undefined,true);throw error;}
 let reads=reservation.cost.reads,uncertain=!response.ok&&response.status!==404;
 if(response.ok&&reservation.readLimit!==undefined){
  try{const value=await response.clone().json() as any;const n=path.endsWith(':runQuery')?value.filter((v:any)=>v.document).length:(value.documents||[]).length;reads=Math.max(1,n);boundary=boundary&&n>=reservation.readLimit;}
  catch{await endpoint.budgetSettle(reservation.id,undefined,true);fail('RESPONSE_UNCERTAIN');}
 }
 await endpoint.budgetSettle(reservation.id,reads,uncertain||boundary);
 if(boundary)fail('QUERY_BUDGET_BOUNDARY');
 return response;
}
