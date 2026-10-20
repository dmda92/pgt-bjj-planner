import {ApiError} from './security.ts';
export const DEV_PROJECT = 'pgt-bjj-dev';
export const DEV_DATABASE = '(default)';
export const DEV_DATABASE_NAME = `projects/${DEV_PROJECT}/databases/${DEV_DATABASE}`;
export type Transport = (input:string,init?:RequestInit)=>Promise<Response>;
const encode=(value:string|Uint8Array)=>{
  const bytes=typeof value==='string'?new TextEncoder().encode(value):value;
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(binary).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
};
export class FirestoreIdentity {
  private credential:{client_email:string;private_key:string};
  private transport:Transport;
  private clock:()=>number;
  private cached?:{token:string;until:number};
  private pending?:Promise<string>;
  constructor(serialized:string,transport:Transport=(input,init)=>fetch(input,init),clock:()=>number=()=>Date.now()){
    let c:any;
    try{c=JSON.parse(serialized);}catch{throw new ApiError(503,'FIRESTORE_IDENTITY_NOT_CONFIGURED');}
    if(c?.type!=='service_account'||c.project_id!==DEV_PROJECT||c.client_email!==`pgt-worker-dev@${DEV_PROJECT}.iam.gserviceaccount.com`||typeof c.private_key!=='string'||!c.private_key.startsWith('-----BEGIN PRIVATE KEY-----'))
      throw new ApiError(503,'FIRESTORE_DEV_IDENTITY_REQUIRED');
    this.credential={client_email:c.client_email,private_key:c.private_key};this.transport=transport;this.clock=clock;
  }
  get principal(){return this.credential.client_email;}
  async token():Promise<string>{
    if(this.cached&&this.cached.until>this.clock())return this.cached.token;
    if(this.pending)return this.pending;
    this.pending=this.mint().finally(()=>{this.pending=undefined;});return this.pending;
  }
  private async mint(){
    try{
      const seconds=Math.floor(this.clock()/1000),header=encode(JSON.stringify({alg:'RS256',typ:'JWT'}));
      const claims=encode(JSON.stringify({iss:this.principal,scope:'https://www.googleapis.com/auth/datastore',aud:'https://oauth2.googleapis.com/token',iat:seconds,exp:seconds+3600}));
      const raw=atob(this.credential.private_key.replace(/-----[^-]+-----/g,'').replace(/\s/g,''));
      const key=await crypto.subtle.importKey('pkcs8',Uint8Array.from(raw,c=>c.charCodeAt(0)),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
      const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(header+'.'+claims));
      const response=await this.transport('https://oauth2.googleapis.com/token',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:header+'.'+claims+'.'+encode(new Uint8Array(signature))}).toString()});
      if(!response.ok)throw new ApiError(503,'FIRESTORE_OAUTH_REJECTED');
      const value=await response.json() as any;
      if(typeof value.access_token!=='string'||value.token_type!=='Bearer'||!Number.isFinite(value.expires_in)||value.expires_in<120)throw new ApiError(503,'FIRESTORE_OAUTH_INVALID');
      this.cached={token:value.access_token,until:this.clock()+(Math.min(value.expires_in,3600)-60)*1000};return value.access_token as string;
    }catch(error){if(error instanceof ApiError)throw error;throw new ApiError(503,'FIRESTORE_OAUTH_FAILED');}
  }
}
