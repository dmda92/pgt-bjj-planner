import type {Transport} from '../firestore-auth.ts';
import type {SessionChange} from './session-store.ts';
type WireResponse={body:ArrayBuffer;status:number;headers:[string,string][]};
export interface PrivateIOBinding {
 newUniqueId():DurableObjectId;
 get(id:DurableObjectId):{
  request(input:string,init:RequestInit):Promise<WireResponse>;
  run(request:Request,entries:[string,unknown][]):Promise<WireResponse&{changes:SessionChange[]}>;
 };
}
/** Rotate before the Free external-fetch budget, including OAuth and retries.
 * Only serializable bytes cross RPC. No shared fetch promises or response I/O.
 * Each operation gets its own pool; fresh DOs receive at most 32 external calls. */
export function privateTransport(binding:PrivateIOBinding):Transport {
 let stub:ReturnType<PrivateIOBinding['get']>|undefined,count=32;
 return async(input,init={})=>{
  if(count>=32){stub=binding.get(binding.newUniqueId());count=0;}count++;
  const {signal,...serializable}=init;
  const response=await stub!.request(input,serializable);
  return new Response(response.body,{status:response.status,headers:response.headers});
 };
}
