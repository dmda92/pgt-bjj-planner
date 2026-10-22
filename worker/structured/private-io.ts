import {ApiError} from '../security.ts';
import type {Transport} from '../firestore-auth.ts';
import type {BudgetPhase,BudgetSetup,BudgetEndpoint} from './execution-budget.ts';
import type {SessionChange} from './session-store.ts';
export type RealtimeSession={sessionHash:string;session?:{mail:string;pwdFingerprint:string;role?:string}};
export type RealtimeChange={name:string;updateTime:string;owner:string;kind:string;version:string};
export type GlobalBudgetContext={id:string;phase:BudgetPhase;build?:string};
type BudgetRPC={budgetPrepareSmoke(setup:BudgetSetup):Promise<{ok:boolean;status?:number;error?:string}>;budgetOpen(setup:BudgetSetup):Promise<unknown>;budgetReserve:BudgetEndpoint['budgetReserve'];budgetSettle:BudgetEndpoint['budgetSettle'];budgetStatus():Promise<unknown>;budgetClaimSmoke():Promise<{runId:string}>;budgetClose():Promise<unknown>};
type WireResponse={build:string;body:ArrayBuffer;status:number;headers:[string,string][]};
export interface PrivateIOBinding {
 newUniqueId():DurableObjectId;
 idFromName?(name:string):DurableObjectId;
 idFromString?(id:string):DurableObjectId;
 get(id:DurableObjectId,options?:{locationHint:'weur'}):{
  smoke?(budget:GlobalBudgetContext):Promise<any>;
  manifest():Promise<{build:string;revision:string}>;
  realtime(sessions:RealtimeSession[],recover?:boolean,budget?:GlobalBudgetContext):Promise<{build:string;changes:RealtimeChange[];actors:{sessionHash:string;mail:string;role:string}[]}>;
  acknowledge(changes:RealtimeChange[],budget?:GlobalBudgetContext):Promise<void>;
  request(input:string,init:RequestInit,budget?:GlobalBudgetContext):Promise<WireResponse>;
  run(request:Request,entries:[string,unknown][],budget?:GlobalBudgetContext):Promise<WireResponse&{changes:SessionChange[]}>;
 } & Partial<BudgetRPC>;
}
export function budgetExecutor(binding:PrivateIOBinding,id:string):BudgetRPC{
 if(!/^[0-9a-f]{64}$/.test(id)||!binding.idFromString)throw new ApiError(400,'FIRESTORE_TEST_EXECUTOR_INVALID');
 const stub=binding.get(binding.idFromString(id),{locationHint:'weur'});
 for(const name of ['budgetPrepareSmoke','budgetOpen','budgetReserve','budgetSettle','budgetStatus','budgetClaimSmoke','budgetClose'] as const)if(typeof stub[name]!=='function')throw new ApiError(503,'FIRESTORE_TEST_EXECUTOR_UNAVAILABLE');
 return stub as BudgetRPC;
}
/** Rotate before the Free external-fetch budget, including OAuth and retries.
 * Only serializable bytes cross RPC. No shared fetch promises or response I/O.
 * Each operation gets its own pool; fresh DOs receive at most 32 external calls. */
export const privateExecutor=(binding:PrivateIOBinding)=>binding.get(binding.newUniqueId(),{locationHint:'weur'});
export function privateTransport(binding:PrivateIOBinding,expectedBuild='local',budget?:GlobalBudgetContext):Transport {
 let stub:ReturnType<PrivateIOBinding['get']>|undefined,count=32;
 return async(input,init={})=>{
  if(count>=32){stub=privateExecutor(binding);count=0;}count++;
  const {signal,...serializable}=init;
  const response=await stub!.request(input,serializable,budget);
  if(response.build!==expectedBuild)throw new ApiError(503,'PRIVATE_IO_BUILD_MISMATCH');
  return new Response(response.body,{status:response.status,headers:response.headers});
 };
}
