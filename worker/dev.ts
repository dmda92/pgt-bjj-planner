import legacy,{ProbeSecurity as LegacySecurity,type Env} from './index.ts';
import {ApiError,fingerprint,opaqueToken,jsonBody,onlyFields} from './security.ts';
import {FirestoreStorage} from './firestore-storage.ts';
import {seedSynthetic} from './dev-fixtures.ts';
import {AppApi} from './application.ts';
import type {Profile} from '../src/domain/models.ts';
import {authorizePreflight,firestorePreflight,requireDev,PreflightFailure,type PreflightEnv} from './firestore-preflight.ts';
export interface DevEnv extends Env,PreflightEnv {}
export default legacy;
// Same local class name/binding as the existing DEV SQLite namespace. PRO keeps
// worker/index.ts as entrypoint and does not import this DEV-only implementation.
export class ProbeSecurity extends LegacySecurity {
  private devEnv:DevEnv;
  private preflight:Promise<Response>|undefined;
  private devState:DurableObjectState;
  private cloud:()=>FirestoreStorage;
  constructor(state:DurableObjectState,env:DevEnv){
    let cloud:FirestoreStorage|undefined;
    const provider=()=>cloud||(cloud=new FirestoreStorage(env));
    super(state,env,provider);this.devEnv=env;this.devState=state;this.cloud=provider;
  }
  override fetch(request:Request):Promise<Response>{
    if(new URL(request.url).pathname==='/api/dev/firestore-preflight')return this.check(request);
    return this.serial(()=>['/api/dev/synthetic-fixture','/api/dev/synthetic-fixture-cleanup'].includes(new URL(request.url).pathname)?this.fixture(request):this.online(request));
  }
  private serial<T>(action:()=>Promise<T>):Promise<T>{
    // Gate incoming events rather than carrying their I/O across a shared
    // promise chain. Memoized reads exist only for this single event.
    return this.devState.blockConcurrencyWhile(async()=>{const store=this.cloud();store.beginOperation();try{return await action();}finally{store.endOperation();}});
  }
  private async online(request:Request):Promise<Response>{
    const url=new URL(request.url),path=url.pathname;
    try{
      requireDev(this.devEnv);
      const origin=request.headers.get('Origin');
      if(origin!==null&&origin!=='https://pgt-github-probe-dev.david-dzm5.workers.dev')throw new ApiError(403,'ORIGIN_FORBIDDEN');
      if(!path.startsWith('/api/app/'))throw new ApiError(404,'ENDPOINT_NOT_FOUND');
      if(!['GET','HEAD','OPTIONS'].includes(request.method)&&request.headers.get('X-PGT-Client')!=='firestore-dev-v1')throw new ApiError(426,'CLIENT_UPDATE_REQUIRED');
      await this.limit(request,path);
      if(path==='/api/app/realtime'&&request.method==='GET')return await this.open(request,url);
      if(path==='/api/app/realtime-ticket'&&request.method==='POST'){
        if(origin!=='https://pgt-github-probe-dev.david-dzm5.workers.dev')throw new ApiError(403,'ORIGIN_FORBIDDEN');
        const body=await jsonBody(request);onlyFields(body,[]);
        const auth=await this.authorize(request);
        const key='ws-rate:'+auth.sessionHash,previous=await this.devState.storage.get<{time:number;count:number}>(key);
        const rate=previous&&Date.now()-previous.time<60000?previous:{time:Date.now(),count:0};
        if(++rate.count>12)throw new ApiError(429,'REALTIME_RATE_LIMIT');
        await this.devState.storage.put(key,rate);
        await this.devState.storage.setAlarm(Date.now()+30000);
        const ticket=opaqueToken();await this.devState.storage.put('ws-ticket:'+await fingerprint(ticket),{...auth,expires:Date.now()+30000});
        return Response.json({ticket},{headers:{'Cache-Control':'no-store'}});
      }
      // Schedule before the first possible commit: the Firestore outbox remains
      // recoverable even if the isolate dies between commit and publication.
      await this.devState.storage.setAlarm(Date.now()+15000);
      try{return await new AppApi(this.devState.storage,this.cloud()).handle(request,url);}finally{await this.flush().catch(error=>console.warn('PGT_REALTIME_RETRY_SCHEDULED',error instanceof ApiError?error.message:'RUNTIME_ERROR')); }
    }catch(error){return Response.json({error:error instanceof ApiError?error.message:'FIRESTORE_DEV_UNAVAILABLE',...(error instanceof ApiError&&error.size?{size:error.size}:{})},{status:error instanceof ApiError?error.status:503,headers:{'Cache-Control':'no-store'}});}
  }
  private async limit(request:Request,path:string){
    const limits:[string,number][]=[['global',600],['ip:'+await fingerprint(request.headers.get('CF-Connecting-IP')||'local'),180]];
    if(request.method!=='GET'&&!['/api/app/login','/api/app/logout','/api/app/realtime-ticket'].includes(path))limits.push(['writes',30]);
    if(['/api/app/login','/api/app/register'].includes(path))limits.push(['login:'+await fingerprint(request.headers.get('CF-Connecting-IP')||'local'),6]);
    const time=Math.floor(Date.now()/60000);
    for(const [name,max] of limits){const key='dev-rate:'+name,old=await this.devState.storage.get<{time:number;count:number}>(key),value=old?.time===time?old:{time,count:0};if(++value.count>max)throw new ApiError(429,'PGT_RATE_LIMIT',60);await this.devState.storage.put(key,value);}
  }
  private async authorize(request:Request){
    const token=request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if(!token)throw new ApiError(401,'SESSION_REQUIRED');
    return this.authorizeHash(await fingerprint(token));
  }
  private async authorizeHash(sessionHash:string){
    const session=await this.devState.storage.get<{mail:string;pwdFingerprint:string}>('app-session:'+sessionHash);
    if(!session)throw new ApiError(401,'SESSION_REVOKED');
    const record=await this.cloud().read<Profile>(`PGT/users_data/${session.mail}/user_data.json`);
    if(!record?.data.pwd||session.pwdFingerprint!==await fingerprint(record.data.pwd))throw new ApiError(401,'SESSION_REVOKED');
    return {sessionHash,mail:session.mail,role:record.data.perfil};
  }
  private async open(request:Request,url:URL){
    if(request.headers.get('Origin')!=='https://pgt-github-probe-dev.david-dzm5.workers.dev'||request.headers.get('Upgrade')?.toLowerCase()!=='websocket')throw new ApiError(403,'REALTIME_UPGRADE_REQUIRED');
    const ticket=url.searchParams.get('ticket')||'';
    if(!/^[A-Za-z0-9_-]{43}$/.test(ticket))throw new ApiError(401,'REALTIME_TICKET_REQUIRED');
    const key='ws-ticket:'+await fingerprint(ticket),saved=await this.devState.storage.get<{sessionHash:string;mail:string;role:string;expires:number}>(key);
    await this.devState.storage.delete(key);
    if(!saved||saved.expires<Date.now())throw new ApiError(401,'REALTIME_TICKET_EXPIRED');
    const current=await this.authorizeHash(saved.sessionHash);
    if(current.role!==saved.role)throw new ApiError(401,'SESSION_REVOKED');
    const sockets=this.devState.getWebSockets();
    if(sockets.length>=100||sockets.filter(ws=>ws.deserializeAttachment()?.sessionHash===current.sessionHash).length>=4)throw new ApiError(429,'REALTIME_CONNECTION_LIMIT');
    const pair=new WebSocketPair(),[client,server]=Object.values(pair);
    this.devState.acceptWebSocket(server);server.serializeAttachment(current);
    server.send(JSON.stringify({type:'ready',id:crypto.randomUUID()}));
    await this.devState.storage.setAlarm(Date.now()+15000);
    return new Response(null,{status:101,webSocket:client});
  }
  private async flush(){
    const changes=await this.cloud().changes();
    // Even no-op logout/role requests must revalidate existing subscriptions.
    const actors=new Map<string,Awaited<ReturnType<ProbeSecurity['authorizeHash']>>|null>();
    for(const ws of this.devState.getWebSockets()){
      const attached=ws.deserializeAttachment();
      if(!attached?.sessionHash){ws.close(4401,'SESSION_REVOKED');continue;}
      let actor=actors.get(attached.sessionHash);
      if(actor===undefined){
        try{actor=await this.authorizeHash(attached.sessionHash);}catch(error){if(error instanceof ApiError&&error.status===401)actor=null;else throw error;}
        actors.set(attached.sessionHash,actor);
      }
      if(!actor||actor.role!==attached.role){ws.close(4401,'SESSION_REVOKED');continue;}
      const relevant=changes.some(c=>!c.owner||actor.role==='entrenador'||c.owner===actor.mail);
      if(relevant)try{ws.send(JSON.stringify({type:'changed',id:changes.at(-1)!.version,own:changes.some(c=>!c.owner||c.owner===actor.mail)}));}catch{ws.close(1011,'RECONNECT');}
    }
    await this.cloud().acknowledge(changes);
    // Drain bounded pages and expire tickets without retaining business in SQLite.
    if(changes.length===100)await this.devState.storage.setAlarm(Date.now()+1000);
    else await this.devState.storage.deleteAlarm();
    for(const [key,value] of await this.devState.storage.list<{expires:number}>({prefix:'ws-ticket:'}))if(value.expires<Date.now())await this.devState.storage.delete(key);
  }
  async alarm(){return this.serial(async()=>{try{await this.flush();}catch{await this.devState.storage.setAlarm(Date.now()+60000);}});}
  webSocketMessage(ws:WebSocket,_message:string|ArrayBuffer){
    // Server-only invalidations: no client messages can cause Firestore reads,
    // writes or an unbounded authentication loop while the socket is idle.
    ws.close(1008,'INVALID_MESSAGE');
  }
  webSocketClose(ws:WebSocket,code:number){ws.close(code===1006?1000:code);}
  webSocketError(ws:WebSocket){ws.close(1011,'RECONNECT');}
  private async fixture(request:Request){
    try{
      requireDev(this.devEnv);
      if(request.method!=='POST')throw new ApiError(405,'METHOD_NOT_ALLOWED');
      if(request.headers.get('Origin')!=='https://pgt-github-probe-dev.david-dzm5.workers.dev')throw new ApiError(403,'ORIGIN_FORBIDDEN');
      await authorizePreflight(request,this.devEnv,(url,init)=>fetch(url,init));
      const body=await jsonBody(request,1024);onlyFields(body,['runId','password']);
      if(typeof body.runId!=='string'||typeof body.password!=='string')throw new ApiError(400,'SYNTHETIC_FIXTURE_INVALID');
      await this.devState.storage.setAlarm(Date.now()+15000);
      try{
        let result;
        if(new URL(request.url).pathname.endsWith('-cleanup')){
          result=await this.cloud().cleanupSynthetic(body.runId);
          const mails=['trainer','student','other'].map(role=>`pgt-dev-${body.runId}-${role}@example.test`);
          for(const [key,session] of await this.devState.storage.list<{mail:string}>({prefix:'app-session:'}))if(mails.includes(session.mail))await this.devState.storage.delete(key);
          for(const mail of mails)for(const key of (await this.devState.storage.list({prefix:'plan-update:'+mail+':'})).keys())await this.devState.storage.delete(key);
        }else result=await seedSynthetic(this.cloud(),body.runId,body.password);
        return Response.json(result,{headers:{'Cache-Control':'no-store'}});
      }
      finally{await this.flush().catch(()=>console.warn('PGT_REALTIME_RETRY_SCHEDULED'));}
    }catch(error){return Response.json({error:error instanceof ApiError?error.message:'SYNTHETIC_FIXTURE_FAILED'},{status:error instanceof ApiError?error.status:503});}
  }
  private async check(request:Request):Promise<Response>{
    try{
      requireDev(this.devEnv);
      if(request.method!=='POST')throw new ApiError(405,'METHOD_NOT_ALLOWED');
      if(request.headers.get('Origin')!=='https://pgt-github-probe-dev.david-dzm5.workers.dev')throw new ApiError(403,'ORIGIN_FORBIDDEN');
      await authorizePreflight(request,this.devEnv,(input,init)=>fetch(input,init));
      if(this.preflight)throw new ApiError(409,'PREFLIGHT_IN_PROGRESS');
      this.preflight=firestorePreflight(this.devEnv).then(value=>Response.json(value,{headers:{'Cache-Control':'no-store'}}));
      try{return await this.preflight;}finally{this.preflight=undefined;}
    }catch(error){return Response.json({error:error instanceof ApiError?error.message:'FIRESTORE_PREFLIGHT_FAILED',...(error instanceof PreflightFailure?{diagnostic:error.diagnostic}:{})},{status:error instanceof ApiError?error.status:503,headers:{'Cache-Control':'no-store'}});}
  }
}
