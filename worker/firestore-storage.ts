import {ApiError} from './security.ts';
import {FirestoreIdentity,DEV_DATABASE_NAME,type Transport} from './firestore-auth.ts';
import {requireDev,type PreflightEnv} from './firestore-preflight.ts';
import {safePath,type CloudRecord,type CloudStorageProvider} from './storage.ts';
import {MAX_JSON_BYTES,documentFile} from '../src/domain/json-limits.ts';

const root=`https://firestore.googleapis.com/v1/${DEV_DATABASE_NAME}`;
const documents=DEV_DATABASE_NAME+'/documents/';
const CHUNK_BYTES=192*1024;
type Field={stringValue?:string;integerValue?:string;booleanValue?:boolean;bytesValue?:string};
type Doc={name:string;fields:Record<string,Field>;updateTime:string};
const str=(value:string):Field=>({stringValue:value});
const text=(d:Doc,key:string)=>d.fields[key]?.stringValue||'';
export type Change={name:string;updateTime:string;owner:string;kind:string;version:string};
export const hex=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>)),v=>v.toString(16).padStart(2,'0')).join('');
const encode=(bytes:Uint8Array)=>{let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);};
function resource(path:string){
  safePath(path);
  if(path==='PGT/master_data/tecnics_base.json')return {owner:'',kind:'template',directory:'PGT/master_data',file:'tecnics_base.json'};
  if(path==='PGT/master_data/plans.json')return {owner:'',kind:'catalog',directory:'PGT/master_data',file:'plans.json'};
  const m=path.match(/^PGT\/users_data\/([a-zA-Z0-9@._+-]+)\/(user_data|tecnics|trainer_comments|plans_index|training_plans\/(?:plan|structure)_[0-9a-f-]{36})\.json$/);
  if(!m||m[1].includes('..'))throw new ApiError(400,'PATH_FORBIDDEN');
  return {owner:m[1],kind:m[2].startsWith('training_plans/structure_')?'derived':m[2].startsWith('training_plans/')?'plan':m[2],directory:path.slice(0,path.lastIndexOf('/')),file:path.slice(path.lastIndexOf('/')+1)};
}
// A version is an opaque application revision, never a GitHub SHA. Its wire
// length stays compatible with the existing domain/API contracts.
export class FirestoreStorage implements CloudStorageProvider {
  private identity:FirestoreIdentity;
  private changed:()=>void;
  private transport:Transport;
  private operation?:{heads:Map<string,Promise<Doc|null>>;decoded:Map<string,unknown>};
  beginOperation(){this.operation={heads:new Map(),decoded:new Map()};}
  endOperation(){this.operation=undefined;}
  constructor(env:PreflightEnv,transport:Transport=(url,init)=>fetch(url,init),changed:()=>void=()=>{}){
    requireDev(env);this.changed=changed;this.transport=transport;this.identity=new FirestoreIdentity(env.FIRESTORE_SERVICE_ACCOUNT_JSON||'',transport);
  }
  async request(path:string,init:RequestInit={}){
    const token=await this.identity.token();
    const readOnly=(!init.method||init.method==='GET')||['/documents:runQuery','/documents:batchGet'].includes(path);
    for(let attempt=0;;attempt++){
      try{
        const r=await this.transport(root+path,{...init,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},redirect:'manual',signal:AbortSignal.timeout(readOnly?10000:20000)});
        // Finish the network body before the next operation, including Commit
        // acknowledgements and 404s whose callers do not parse a response body.
        const response=new Response(await r.arrayBuffer(),{status:r.status,headers:r.headers});
        if(readOnly&&attempt===0&&[502,503,504].includes(response.status))continue;
        return response;
      }catch(error){
        const message=error instanceof Error?error.message:'';
        if(/too many subrequests/i.test(message))throw new ApiError(503,'FIRESTORE_SUBREQUEST_LIMIT');
        if(/different request|request.*context|context.*request/i.test(message))throw new ApiError(503,'FIRESTORE_REQUEST_CONTEXT');
        if(readOnly&&attempt===0)continue;
        throw new ApiError(503,error instanceof Error&&['TimeoutError','AbortError'].includes(error.name)?'FIRESTORE_NETWORK_TIMEOUT':'FIRESTORE_NETWORK_RETRY');
      }
    }
  }
  private check(r:Response){
    if(r.status===429)throw new ApiError(429,'FIRESTORE_RATE_LIMIT',60);
    if(!r.ok)throw new ApiError(503,'FIRESTORE_SERVICE_'+r.status);
  }
  async verifyPrivate(){
    // This contract means the provider has validated its exclusive DEV target.
    // Firestore IAM is validated at every request, not simulated by repo metadata.
    await this.identity.token();
  }
  private async id(path:string){resource(path);return hex(new TextEncoder().encode(path));}
  private async head(id:string,fresh=false):Promise<Doc|null>{
    if(!fresh&&this.operation?.heads.has(id))return this.operation.heads.get(id)!;
    const load=(async()=>{const r=await this.request('/documents/pgt_resources/'+id);if(r.status===404)return null;this.check(r);return await r.json() as Doc;})();
    this.operation?.heads.set(id,load);return load;
  }
  async read<T=Record<string,unknown>>(path:string):Promise<CloudRecord<T>|null>{
    const id=await this.id(path),d=await this.head(id);if(!d||d.fields.deleted?.booleanValue)return null;
    return {data:await this.decode<T>(id,d),sha:text(d,'version')};
  }
  private async decode<T>(id:string,d:Doc):Promise<T>{
    const cacheKey=id+':'+text(d,'version');
    if(this.operation?.decoded.has(cacheKey))return structuredClone(this.operation.decoded.get(cacheKey)) as T;
    const count=Number(d.fields.parts?.integerValue),size=Number(d.fields.bytes?.integerValue),version=text(d,'version');
    if(!/^[0-9a-f]{40}$/.test(version)||!Number.isInteger(count)||count<1||count>Math.ceil(MAX_JSON_BYTES/CHUNK_BYTES)||!Number.isInteger(size)||size<1||size>MAX_JSON_BYTES)throw new ApiError(502,'FIRESTORE_MANIFEST_INVALID');
    const bytes=new Uint8Array(size);let offset=0;
    if(d.fields.inline?.bytesValue){
      try{const part=Uint8Array.from(atob(d.fields.inline.bytesValue),c=>c.charCodeAt(0));if(part.length!==size)throw Error();bytes.set(part);offset=size;}catch{throw new ApiError(502,'FIRESTORE_FRAGMENT_INVALID');}
    }
    if(offset<size){
      // One batchGet keeps fragmentation from multiplying Worker subrequests.
      // Firestore may return results out of order; ordinal names are authority.
      const names=Array.from({length:count},(_,i)=>`${documents}pgt_resources/${id}/parts/${version}_${i}`);
      const response=await this.request('/documents:batchGet',{method:'POST',body:JSON.stringify({documents:names})});this.check(response);
      const rows=await response.json() as {found?:Doc;missing?:string}[];
      if(!Array.isArray(rows)||rows.some(r=>r.missing))throw new ApiError(502,'FIRESTORE_FRAGMENT_INVALID');
      const found=new Map(rows.flatMap(r=>r.found?[[r.found.name,r.found] as const]:[]));
      if(found.size!==count)throw new ApiError(502,'FIRESTORE_FRAGMENT_INVALID');
      for(const name of names){
        const value=found.get(name)?.fields.payload?.bytesValue;
        if(typeof value!=='string')throw new ApiError(502,'FIRESTORE_FRAGMENT_INVALID');
        let part:Uint8Array;try{part=Uint8Array.from(atob(value),c=>c.charCodeAt(0));}catch{throw new ApiError(502,'FIRESTORE_FRAGMENT_INVALID');}
        if(offset+part.length>size)throw new ApiError(502,'FIRESTORE_FRAGMENT_INVALID');bytes.set(part,offset);offset+=part.length;
      }
    }
    if(offset!==size||await hex(bytes)!==text(d,'digest'))throw new ApiError(502,'FIRESTORE_CHECKSUM_MISMATCH');
    try{const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));this.operation?.decoded.set(cacheKey,structuredClone(value));return value as T;}catch{throw new ApiError(502,'FIRESTORE_JSON_INVALID');}
  }
  private async commit(writes:unknown[]){
    const body=JSON.stringify({writes});if(new TextEncoder().encode(body).length>9*1024*1024)throw new ApiError(413,'FIRESTORE_COMMIT_TOO_LARGE');
    const r=await this.request('/documents:commit',{method:'POST',body});
    if([409,412].includes(r.status))throw new ApiError(409,'VERSION_CONFLICT');
    if(r.status===400){const v=await r.json() as any;if(v?.error?.status==='FAILED_PRECONDITION'||v?.error?.status==='ALREADY_EXISTS')throw new ApiError(409,'VERSION_CONFLICT');throw new ApiError(503,'FIRESTORE_COMMIT_REJECTED');}
    this.check(r);
  }
  async write(path:string,data:unknown,expected:string|null):Promise<string>{return this.publish(path,data,expected,false);}
  async remove(path:string,expected:string){await this.publish(path,undefined,expected,true);}
  private async publish(path:string,data:unknown,expected:string|null,deleted:boolean){
    const entity=resource(path),id=await this.id(path),previous=await this.head(id,true);
    if(expected!==null&&!/^[0-9a-f]{40}$/.test(expected))throw new ApiError(400,'VERSION_INVALID');
    const exists=previous&&!previous.fields.deleted?.booleanValue;
    if((exists?text(previous!,'version'):null)!==expected)throw new ApiError(409,'VERSION_CONFLICT');
    if(deleted&&!exists)throw new ApiError(409,'DATA_ALREADY_REMOVED');
    const bytes=deleted?new Uint8Array():new TextEncoder().encode(JSON.stringify(data));
    if(bytes.length>MAX_JSON_BYTES)throw new ApiError(413,'JSON_TOO_LARGE',undefined,{file:documentFile(path),bytes:bytes.length,limitBytes:MAX_JSON_BYTES,scope:'document',exact:true});
    const version=Array.from(crypto.getRandomValues(new Uint8Array(20)),v=>v.toString(16).padStart(2,'0')).join('');
    const name=documents+'pgt_resources/'+id;
    const fields:Record<string,Field>={owner:str(entity.owner),kind:str(entity.kind),directory:str(entity.directory),file:str(entity.file),version:str(version),deleted:{booleanValue:deleted},parts:{integerValue:String(Math.ceil(bytes.length/CHUNK_BYTES))},bytes:{integerValue:String(bytes.length)},digest:str(await hex(bytes))};
    const inline=bytes.length>0&&bytes.length<=32768;if(inline)fields.inline={bytesValue:encode(bytes)};
    const writes:any[]=[];
    for(let i=0;!inline&&i<bytes.length;i+=CHUNK_BYTES)writes.push({update:{name:name+'/parts/'+version+'_'+Math.floor(i/CHUNK_BYTES),fields:{payload:{bytesValue:encode(bytes.subarray(i,i+CHUNK_BYTES))}}},currentDocument:{exists:false}});
    writes.push({update:{name,fields},currentDocument:previous?{updateTime:previous.updateTime}:{exists:false}});
    if(entity.kind!=='derived')writes.push({update:{name:documents+'pgt_changes/'+version,fields:{owner:str(entity.owner),kind:str(entity.kind),version:str(version)}},currentDocument:{exists:false}});
    try{await this.commit(writes);}
    catch(error){
      // Resolve an ambiguous ACK by our unguessable operation revision; never replay
      // a mutation and never accept somebody else's identical payload as our ACK.
      const current=await this.head(id,true).catch(()=>null);
      if(!current||text(current,'version')!==version)throw error;
    }
    this.operation?.heads.delete(id);this.changed();return version;
  }
  async list(directory:string):Promise<{name:string;type:string;sha?:string}[]>{
    if(!/^PGT\/(users_data|users_data\/[a-zA-Z0-9@._+-]+(?:\/training_plans)?)$/.test(directory)||directory.includes('..'))throw new ApiError(400,'PATH_FORBIDDEN');
    if(directory==='PGT/users_data'){
      const docs=await this.query('pgt_resources','kind','user_data');
      return docs.filter(d=>!d.fields.deleted?.booleanValue).map(d=>({name:text(d,'owner'),type:'dir'})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
    }
    return (await this.query('pgt_resources','directory',directory)).filter(d=>!d.fields.deleted?.booleanValue).map(d=>({name:text(d,'file'),type:'file',sha:text(d,'version')})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
  }
  private async query(collection:string,field:string,value:string){
    const r=await this.request('/documents:runQuery',{method:'POST',body:JSON.stringify({structuredQuery:{from:[{collectionId:collection}],where:{fieldFilter:{field:{fieldPath:field},op:'EQUAL',value:str(value)}}}})});this.check(r);
    const rows=await r.json() as {document?:Doc}[];if(!Array.isArray(rows))throw new ApiError(502,'FIRESTORE_QUERY_INVALID');
    const docs=rows.flatMap(v=>v.document?[v.document]:[]);
    if(collection==='pgt_resources')for(const d of docs){const id=d.name.slice(d.name.lastIndexOf('/')+1);if(!this.operation?.heads.has(id))this.operation?.heads.set(id,Promise.resolve(d));}
    return docs;
  }
  async beginSyntheticRun(runId:string){
    if(!/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(runId))throw new ApiError(400,'SYNTHETIC_FIXTURE_INVALID');
    await this.commit([{update:{name:documents+'pgt_qa_runs/'+runId,fields:{synthetic:{booleanValue:true},cleaned:{booleanValue:false}}},currentDocument:{exists:false}}]);
  }
  async cleanupSynthetic(runId:string){
    if(!/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(runId))throw new ApiError(400,'SYNTHETIC_FIXTURE_INVALID');
    const runName=documents+'pgt_qa_runs/'+runId,r=await this.request('/documents/pgt_qa_runs/'+runId);this.check(r);const run=await r.json() as Doc;
    if(run.fields.synthetic?.booleanValue!==true)throw new ApiError(403,'SYNTHETIC_RUN_REQUIRED');
    if(run.fields.cleaned?.booleanValue)return {status:'SYNTHETIC_FIXTURE_CLEANED',resources:0};
    const mails=['trainer','student','other'].map(role=>`pgt-dev-${runId}-${role}@example.test`),owned:Doc[]=[];
    for(const mail of mails)owned.push(...await this.query('pgt_resources','owner',mail));
    const ids=new Set(owned.flatMap(d=>{const match=text(d,'file').match(/^(?:plan|structure)_([0-9a-f-]{36})\.json$/);return match?[match[1]]:[];}));
    const catalogId=await this.id('PGT/master_data/plans.json'),catalog=await this.head(catalogId);
    let next:any;
    if(catalog){next=await this.decode<any>(catalogId,catalog);
      for(const p of next.plans){if(p.alumnos.some((mail:string)=>mails.includes(mail))){if(p.alumnos.some((mail:string)=>!mails.includes(mail)))throw new ApiError(409,'SYNTHETIC_SHARED_PLAN_NOT_CLEANED');ids.add(p.planId);}}
    }
    const otherPlans=await this.query('pgt_resources','kind','plan');
    if(otherPlans.some(d=>!mails.includes(text(d,'owner'))&&ids.has(text(d,'file').slice(5,-5))))throw new ApiError(409,'SYNTHETIC_SHARED_PLAN_NOT_CLEANED');
    const version=Array.from(crypto.getRandomValues(new Uint8Array(20)),v=>v.toString(16).padStart(2,'0')).join(''),writes:any[]=[];
    for(const d of owned){if(d.fields.deleted?.booleanValue)continue;const fields={...d.fields,version:str(version),deleted:{booleanValue:true},parts:{integerValue:'0'},bytes:{integerValue:'0'},digest:str(await hex(new Uint8Array()))};delete (fields as any).inline;writes.push({update:{name:d.name,fields},currentDocument:{updateTime:d.updateTime}});}
    if(catalog&&next&&ids.size){
      next={...next,revision:next.revision+1,updatedAt:new Date().toISOString(),plans:next.plans.filter((p:any)=>!ids.has(p.planId)),deletedPlanIds:next.deletedPlanIds.filter((id:string)=>!ids.has(id))};
      const bytes=new TextEncoder().encode(JSON.stringify(next));if(bytes.length>32768)throw new ApiError(409,'SYNTHETIC_CATALOG_REVIEW_REQUIRED');
      writes.push({update:{name:catalog.name,fields:{...catalog.fields,version:str(version),inline:{bytesValue:encode(bytes)},bytes:{integerValue:String(bytes.length)},parts:{integerValue:'1'},digest:str(await hex(bytes))}},currentDocument:{updateTime:catalog.updateTime}});
    }
    writes.push({update:{name:runName,fields:{synthetic:{booleanValue:true},cleaned:{booleanValue:true}}},currentDocument:{updateTime:run.updateTime}});
    writes.push({update:{name:documents+'pgt_changes/'+version,fields:{owner:str(''),kind:str('fixture-cleanup'),version:str(version)}},currentDocument:{exists:false}});
    await this.commit(writes);return {status:'SYNTHETIC_FIXTURE_CLEANED',resources:owned.length};
  }
  async changes():Promise<Change[]>{
    const r=await this.request('/documents/pgt_changes?pageSize=100');this.check(r);const value=await r.json() as {documents?:Doc[]};
    return (value.documents||[]).map(d=>({name:d.name,updateTime:d.updateTime,owner:text(d,'owner'),kind:text(d,'kind'),version:text(d,'version')}));
  }
  async acknowledge(changes:Change[]){if(changes.length)await this.commit(changes.map(d=>({delete:d.name,currentDocument:{updateTime:d.updateTime}})));}
}
