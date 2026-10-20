import legacy,{ProbeSecurity as LegacySecurity,type Env} from './index.ts';
import {ApiError} from './security.ts';
import {authorizePreflight,firestorePreflight,requireDev,type PreflightEnv} from './firestore-preflight.ts';
export interface DevEnv extends Env,PreflightEnv {}
export default legacy;
// Same local class name/binding as the existing DEV SQLite namespace. PRO keeps
// worker/index.ts as entrypoint and does not import this DEV-only implementation.
export class ProbeSecurity extends LegacySecurity {
  private devEnv:DevEnv;
  private preflight:Promise<Response>|undefined;
  constructor(state:DurableObjectState,env:DevEnv){super(state,env);this.devEnv=env;}
  override fetch(request:Request):Promise<Response>{
    if(new URL(request.url).pathname!=='/api/dev/firestore-preflight')return super.fetch(request);
    return this.check(request);
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
    }catch(error){return Response.json({error:error instanceof ApiError?error.message:'FIRESTORE_PREFLIGHT_FAILED'},{status:error instanceof ApiError?error.status:503,headers:{'Cache-Control':'no-store'}});}
  }
}
