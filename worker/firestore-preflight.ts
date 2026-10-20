import {ApiError} from './security.ts';
import {FirestoreIdentity,DEV_PROJECT,DEV_DATABASE,DEV_DATABASE_NAME,type Transport} from './firestore-auth.ts';
export interface PreflightEnv {FIRESTORE_SERVICE_ACCOUNT_JSON?:string;DEV_ACCOUNT_ID?:string;FIRESTORE_PROJECT_ID?:string;FIRESTORE_DATABASE_ID?:string}
export function requireDev(env:PreflightEnv){
  if(env.FIRESTORE_PROJECT_ID!==DEV_PROJECT||env.FIRESTORE_DATABASE_ID!==DEV_DATABASE)throw new ApiError(503,'FIRESTORE_DEV_TARGET_REQUIRED');
}
const base=`https://firestore.googleapis.com/v1/${DEV_DATABASE_NAME}`;
// The deployment credential authorizes this fixed diagnostic only. It is never
// stored, echoed, forwarded to Google, or accepted for arbitrary account/routes.
export async function authorizePreflight(request:Request,env:PreflightEnv,transport:Transport){
  if(!/^[0-9a-f]{32}$/.test(env.DEV_ACCOUNT_ID||''))throw new ApiError(503,'DEV_ACCOUNT_NOT_CONFIGURED');
  const token=request.headers.get('Authorization')?.match(/^Bearer ([^\s]{20,})$/)?.[1];
  if(!token)throw new ApiError(401,'DEPLOYMENT_AUTH_REQUIRED');
  let response:Response;
  try{response=await transport(`https://api.cloudflare.com/client/v4/accounts/${env.DEV_ACCOUNT_ID}/workers/scripts/pgt-github-probe-dev/settings`,{headers:{Authorization:'Bearer '+token},redirect:'manual',signal:AbortSignal.timeout(15000)});}
  catch{throw new ApiError(503,'DEPLOYMENT_AUTH_UNAVAILABLE');}
  if(!response.ok)throw new ApiError(403,'DEV_DEPLOYMENT_AUTH_REQUIRED');
  let result:any;try{result=await response.json();}catch{throw new ApiError(503,'DEPLOYMENT_AUTH_INVALID');}
  if(result.success!==true||!result.result||!Array.isArray(result.result.bindings))throw new ApiError(403,'DEV_DEPLOYMENT_AUTH_REQUIRED');
}
export async function firestorePreflight(env:PreflightEnv,transport:Transport=(input,init)=>fetch(input,init)){
  requireDev(env);
  const identity=new FirestoreIdentity(env.FIRESTORE_SERVICE_ACCOUNT_JSON||'',transport);
  const token=await identity.token();
  const google=async(path:string,init:RequestInit={})=>{
    try{return await transport(base+path,{...init,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},redirect:'manual',signal:AbortSignal.timeout(15000)});}
    catch{throw new ApiError(503,'FIRESTORE_NETWORK_UNAVAILABLE');}
  };
  const metadata=await google('');if(!metadata.ok)throw new ApiError(503,'FIRESTORE_METADATA_'+metadata.status);
  const database=await metadata.json() as any;
  if(database.name!==DEV_DATABASE_NAME||database.type!=='FIRESTORE_NATIVE'||database.databaseEdition!=='STANDARD'||typeof database.locationId!=='string')throw new ApiError(503,'FIRESTORE_DATABASE_CONFIGURATION_MISMATCH');
  const id=crypto.randomUUID(),path='/documents/_pgt_dev_diagnostics/'+id,name=DEV_DATABASE_NAME+path;
  let created=false;
  const fields={runId:{stringValue:id},purpose:{stringValue:'synthetic-dev-preflight'}};
  const commit=(writes:unknown[])=>google('/documents:commit',{method:'POST',body:JSON.stringify({writes})});
  const check=(r:Response,stage:string)=>{if(!r.ok)throw new ApiError(503,`FIRESTORE_PREFLIGHT_${stage}_${r.status}`);};
  let anonymousReadDenied=false,anonymousWriteDenied=false;
  try{
    const create=await commit([{update:{name,fields},currentDocument:{exists:false}}]);check(create,'CREATE');created=true;
    const value=await google(path);check(value,'READ');const record=await value.json() as any;
    if(record.fields?.runId?.stringValue!==id||!record.updateTime)throw new ApiError(503,'FIRESTORE_PREFLIGHT_READ_MISMATCH');
    const updatedFields={...fields,confirmed:{booleanValue:true}};
    const update=await commit([{update:{name,fields:updatedFields},currentDocument:{updateTime:record.updateTime}}]);check(update,'UPDATE');
    const stale=await commit([{update:{name,fields},currentDocument:{updateTime:record.updateTime}}]);
    if(stale.status!==409&&stale.status!==412)throw new ApiError(503,'FIRESTORE_PREFLIGHT_CAS_NOT_ENFORCED');
    const read=await transport(base+path,{redirect:'manual',signal:AbortSignal.timeout(15000)});
    anonymousReadDenied=read.status===401||read.status===403;
    const write=await transport(base+path,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields:updatedFields}),redirect:'manual',signal:AbortSignal.timeout(15000)});
    anonymousWriteDenied=write.status===401||write.status===403;
    if(!anonymousReadDenied||!anonymousWriteDenied)throw new ApiError(503,'FIRESTORE_ANONYMOUS_ACCESS_NOT_DENIED');
  }finally{
    // An ambiguous Commit can have succeeded: always inspect our unique synthetic
    // ID, then delete only our own diagnostic with an updateTime precondition.
    const current=await google(path);
    if(current.ok){const record=await current.json() as any;
      if(record.fields?.runId?.stringValue!==id||!record.updateTime)throw new ApiError(503,'FIRESTORE_PREFLIGHT_CLEANUP_OWNERSHIP');
      check(await commit([{delete:name,currentDocument:{updateTime:record.updateTime}}]),'DELETE');
    }else if(current.status!==404)throw new ApiError(503,'FIRESTORE_PREFLIGHT_CLEANUP_'+current.status);
  }
  const removed=await google(path);if(removed.status!==404)throw new ApiError(503,'FIRESTORE_PREFLIGHT_DELETE_NOT_CONFIRMED');
  return {status:'FIRESTORE_DEV_CONNECTION_VERIFIED',project:DEV_PROJECT,database:DEV_DATABASE,location:database.locationId,edition:database.databaseEdition,mode:database.type,principal:identity.principal,createReadUpdateDelete:created,staleWriteRejected:true,anonymousReadDenied,anonymousWriteDenied,rulesSource:'NOT_READ_SERVICE_ACCOUNT_HAS_DATA_ROLE_ONLY',billing:'SPARK_OWNER_CONFIRMED_NOT_QUERIED'};
}
