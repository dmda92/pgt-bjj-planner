import {ApiError,reject,normalizedMail,equal,opaqueToken,fingerprint,passwordHash,passwordMatches,ownResource,jsonBody,onlyFields} from './security.ts';
import {GithubContentsStorage,type CloudStorageProvider} from './storage.ts';
import {requestContext,logUnexpectedDiagnostic,type RequestContext} from './diagnostics.ts';

export interface Env {
  SECURITY:DurableObjectNamespace;ASSETS:Fetcher;
  GITHUB_DATA_TOKEN:string;PROBE_ADMIN_KEY:string;ALLOWED_ORIGIN:string;DATA_BRANCH:string;
}
interface Session {mail:string;expiresAt:number}
interface TestProfile {schemaVersion:1;mail:string;perfil:'alumno';pwd:string;probeOnly:true;revision:number;updatedAt:string}
type Transient={expiresAt:number;count?:number;mail?:string};
function response(data:unknown,status=200):Response{return Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});}
export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    if(new URL(request.url).pathname.startsWith('/api/'))return env.SECURITY.get(env.SECURITY.idFromName('github-probe')).fetch(request);
    return env.ASSETS.fetch(request);
  }
};

export class ProbeSecurity {
  private state:DurableObjectState;private env:Env;private queue:Promise<unknown>=Promise.resolve();private provider:()=>CloudStorageProvider;
  constructor(state:DurableObjectState,env:Env,provider?:()=>CloudStorageProvider){this.state=state;this.env=env;this.provider=provider||(()=>new GithubContentsStorage(env.GITHUB_DATA_TOKEN,env.DATA_BRANCH));}
  fetch(request:Request):Promise<Response>{
    const result=this.queue.then(()=>this.handle(request));this.queue=result.catch(()=>undefined);return result;
  }
  private admin(request:Request):void{
    if(!this.env.PROBE_ADMIN_KEY||this.env.PROBE_ADMIN_KEY.length<32||!equal(request.headers.get('Authorization')||'',`Bearer ${this.env.PROBE_ADMIN_KEY}`))reject(403,'PROBE_ADMIN_REQUIRED');
  }
  private async budget(key:string,limit:number,duration:number):Promise<void>{
    const now=Date.now();const previous=await this.state.storage.get<Transient>(key);
    const current=previous&&previous.expiresAt>now?previous:{expiresAt:now+duration,count:0};current.count=(current.count||0)+1;
    await this.state.storage.put(key,current);if(current.count>limit)reject(429,'PROBE_RATE_LIMIT',Math.ceil((current.expiresAt-now)/1000));
  }
  private async throttle(request:Request,path:string):Promise<void>{
    const ip=await fingerprint(request.headers.get('CF-Connecting-IP')||'local');
    await this.budget(`rate:ip:${ip}`,30,60000);
    await this.budget('rate:global',300,60000);
    if(request.method==='PUT'||request.method==='DELETE'||path==='/api/admin/test-user'){
      await this.budget('rate:writes-minute',10,60000);await this.budget('rate:writes-hour',100,3600000);
    }
    if(path==='/api/auth/login')await this.budget(`rate:login:${ip}`,6,60000);
    // Auxiliary records only. Bounded cleanup avoids scanning business data or unbounded storage on every request.
    const cleanupAt=await this.state.storage.get<number>('cleanupAt')||0;
    if(cleanupAt<Date.now()){
      for(const [key,value] of await this.state.storage.list<Transient>({prefix:'rate:'})){if(value.expiresAt<Date.now())await this.state.storage.delete(key);}
      for(const [key,value] of await this.state.storage.list<Session>({prefix:'session:'})){if(value.expiresAt<Date.now())await this.state.storage.delete(key);}
      await this.state.storage.put('cleanupAt',Date.now()+60000);
    }
  }
  private async session(request:Request):Promise<Session>{
    const token=request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];if(!token)return reject(401,'PGT_SESSION_REQUIRED');
    const session=await this.state.storage.get<Session>(`session:${await fingerprint(token)}`);
    if(!session||session.expiresAt<Date.now())return reject(401,'PGT_SESSION_REVOKED_OR_EXPIRED');return session;
  }
  private async storage():Promise<CloudStorageProvider>{const provider=this.provider();await provider.verifyPrivate();return provider;}
  private async handle(request:Request):Promise<Response>{
    const origin=request.headers.get('Origin');let result:Response;
    const context=requestContext(request);
    try{
      context.stage='validate_origin';
      if(origin&&origin!==this.env.ALLOWED_ORIGIN)reject(403,'ORIGIN_FORBIDDEN');
      const url=new URL(request.url);
      if(request.method==='OPTIONS')result=new Response(null,{status:204});
      else{context.stage='throttle';await this.throttle(request,url.pathname);context.stage='route';result=await this.route(request,url,context);}
    }catch(error){
      if(!(error instanceof ApiError))logUnexpectedDiagnostic(error,context);
      result=response(error instanceof ApiError?{error:error.message}:{error:'INTERNAL_ERROR',diagnosticId:context.diagnosticId},error instanceof ApiError?error.status:500);
      if(error instanceof ApiError&&error.retryAfter)result.headers.set('Retry-After',String(error.retryAfter));
    }
    if(origin===this.env.ALLOWED_ORIGIN){result.headers.set('Access-Control-Allow-Origin',origin);result.headers.set('Vary','Origin');result.headers.set('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS');result.headers.set('Access-Control-Allow-Headers','Content-Type,Authorization');result.headers.set('Access-Control-Expose-Headers','Retry-After');}
    result.headers.set('Cache-Control','no-store');return result;
  }
  private async route(request:Request,url:URL,context:RequestContext):Promise<Response>{
    const route=`${request.method} ${url.pathname}`;
    if(route==='POST /api/admin/check'){
      context.stage='authorize_admin';this.admin(request);context.stage='verify_private_repository';await this.storage();return response({privateRepository:true,repository:'dmda92/pgt-bjj-data',status:'READ_ACCESS_CONFIRMED; WRITE_TEST_PENDING'});
    }
    if(route==='POST /api/admin/test-user'){
      context.stage='authorize_admin';this.admin(request);context.stage='parse_body';const body=await jsonBody(request);context.stage='validate_body';onlyFields(body,['mail','password']);const mail=normalizedMail(body.mail);
      const pwd=await passwordHash(body.password,undefined,stage=>{context.stage=stage;});
      context.stage='verify_private_repository';const provider=await this.storage();const path=`PGT/users_data/${mail}/user_data.json`;
      context.stage='read_user_profile';
      if(await provider.read(path))reject(409,'USER_EXISTS_NO_OVERWRITE');
      const data:TestProfile={schemaVersion:1,mail,perfil:'alumno',pwd,probeOnly:true,revision:1,updatedAt:new Date().toISOString()};
      context.stage='write_user_profile';await provider.write(path,data,null);return response({mail,status:'TEST_PROFILE_CREATED'},201);
    }
    if(route==='POST /api/auth/login'){
      context.stage='parse_body';const body=await jsonBody(request);context.stage='validate_body';onlyFields(body,['mail','password']);const mail=normalizedMail(body.mail);context.stage='verify_private_repository';const provider=await this.storage();
      context.stage='read_user_profile';
      const profile=await provider.read<TestProfile>(`PGT/users_data/${mail}/user_data.json`);
      const matches=await passwordMatches(body.password,typeof profile?.data.pwd==='string'?profile.data.pwd:'pbkdf2-sha256$600000$unknown$unknown',stage=>{context.stage=stage;});
      context.stage='validate_credentials';
      if(!matches||!profile||profile.data.probeOnly!==true||profile.data.perfil!=='alumno'||profile.data.mail!==mail)reject(401,'PGT_LOGIN_FAILED');
      const token=opaqueToken();const expiresAt=Date.now()+12*3600000;
      context.stage='create_session';await this.state.storage.put(`session:${await fingerprint(token)}`,{mail,expiresAt});
      // Only the opaque PGT session is sent. GitHub token and stored password hash never leave the Worker.
      return response({token,mail,expiresAt});
    }
    if(route==='POST /api/auth/logout'){
      context.stage='validate_session';await this.session(request);context.stage='revoke_session';await this.state.storage.delete(`session:${await fingerprint(request.headers.get('Authorization')!.slice(7))}`);return response({status:'PGT_LOGGED_OUT'});
    }
    const match=url.pathname.match(/^\/api\/probe\/users\/([^/]+)\/json$/);
    if(!match||!['GET','PUT','DELETE'].includes(request.method))return reject(404,'ENDPOINT_NOT_FOUND');
    context.stage='validate_session';const session=await this.session(request);context.stage='authorize_resource';ownResource(session.mail,decodeURIComponent(match[1]));
    context.stage='verify_private_repository';const provider=await this.storage();const path=`PGT/users_data/${session.mail}/viability.json`;context.stage='read_probe_json';const current=await provider.read(path);
    if(request.method==='GET')return current?response(current):response({error:'PROBE_JSON_NOT_FOUND'},404);
    context.stage='parse_body';const body=await jsonBody(request);context.stage='validate_body';onlyFields(body,request.method==='DELETE'?['sha']:['sha','value']);
    if(body.sha!==null&&typeof body.sha!=='string')reject(400,'EXPECTED_SHA_REQUIRED');
    const expected=body.sha as string|null;
    if(expected!==(current?.sha??null))reject(409,'PROBE_SHA_CONFLICT');
    if(request.method==='DELETE'){
      if(!current)return reject(404,'PROBE_JSON_NOT_FOUND');context.stage='delete_probe_json';await provider.remove(path,current.sha);return response({status:'DELETE_CONFIRMED'});
    }
    if(typeof body.value!=='string'||body.value.length>2000)reject(400,'PROBE_VALUE_INVALID');
    const data={schemaVersion:1,mail:session.mail,value:body.value,revision:Number(current?.data.revision||0)+1,updatedAt:new Date().toISOString()};
    // Idempotent response for an unchanged document; do not generate a commit just for reading/saving unchanged text.
    if(current?.data.value===body.value)return response({...current,status:'UNCHANGED_NO_COMMIT'});
    context.stage='write_probe_json';const sha=await provider.write(path,data,expected);return response({data,sha,status:'WRITE_CONFIRMED'});
  }
}
