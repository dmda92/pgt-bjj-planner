import {ApiError} from '../security.ts';
import type {Transport} from '../firestore-auth.ts';
import type {SessionChange} from './session-store.ts';
export type RealtimeSession={sessionHash:string;session?:{mail:string;pwdFingerprint:string;role?:string}};
export type RealtimeChange={name:string;updateTime:string;owner:string;kind:string;version:string};
type WireResponse={build:string;body:ArrayBuffer;status:number;headers:[string,string][]};
export interface PrivateIOBinding {
 newUniqueId():DurableObjectId;
 get(id:DurableObjectId,options?:{locationHint:'weur'}):{
  manifest():Promise<{build:string;revision:string}>;
  realtime(sessions:RealtimeSession[],recover?:boolean):Promise<{build:string;changes:RealtimeChange[];actors:{sessionHash:string;mail:string;role:string}[]}>;
  acknowledge(changes:RealtimeChange[]):Promise<void>;
  request(input:string,init:RequestInit):Promise<WireResponse>;
  run(request:Request,entries:[string,unknown][]):Promise<WireResponse&{changes:SessionChange[]}>;
 };
}
/** Rotate before the Free external-fetch budget, including OAuth and retries.
 * Only serializable bytes cross RPC. No shared fetch promises or response I/O.
 * Each operation gets its own pool; fresh DOs receive at most 32 external calls. */
export const privateExecutor=(binding:PrivateIOBinding)=>binding.get(binding.newUniqueId(),{locationHint:'weur'});
export function privateTransport(binding:PrivateIOBinding,expectedBuild='local'):Transport {
 let stub:ReturnType<PrivateIOBinding['get']>|undefined,count=32;
 return async(input,init={})=>{
  if(count>=32){stub=privateExecutor(binding);count=0;}count++;
  const {signal,...serializable}=init;
  const response=await stub!.request(input,serializable);
  if(response.build!==expectedBuild)throw new ApiError(503,'PRIVATE_IO_BUILD_MISMATCH');
  return new Response(response.body,{status:response.status,headers:response.headers});
 };
}
