import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FirestoreIdentity,DEV_DATABASE_NAME,type Transport} from '../worker/firestore-auth.ts';
import {authorizePreflight,firestorePreflight} from '../worker/firestore-preflight.ts';
const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const privateKey='-----BEGIN PRIVATE KEY-----\n'+Buffer.from(await crypto.subtle.exportKey('pkcs8',keys.privateKey)).toString('base64')+'\n-----END PRIVATE KEY-----';
const account={type:'service_account',project_id:'pgt-bjj-dev',client_email:'pgt-worker-dev@pgt-bjj-dev.iam.gserviceaccount.com',private_key:privateKey};
const env={FIRESTORE_PROJECT_ID:'pgt-bjj-dev',FIRESTORE_DATABASE_ID:'(default)',FIRESTORE_SERVICE_ACCOUNT_JSON:JSON.stringify(account),DEV_ACCOUNT_ID:'a'.repeat(32)};
function fixture(options:{anonymousOpen?:boolean;metadataDenied?:boolean;badEdition?:boolean;staleAccepted?:boolean;ambiguousCreate?:boolean;googlePrecondition?:boolean;invalidArgument?:boolean}={}){
  const records=new Map<string,any>();let version=0,oauth=0,commits=0;
  const calls:{url:string;method:string}[]=[];
  const transport:Transport=async(url,init={})=>{
    calls.push({url,method:init.method||'GET'});
    if(url==='https://oauth2.googleapis.com/token'){
      oauth++;
      const assertion=new URLSearchParams(String(init.body)).get('assertion')!;
      const [header,payload,signature]=assertion.split('.');const claims=JSON.parse(Buffer.from(payload,'base64url').toString());
      assert.equal(claims.iss,account.client_email);assert.equal(claims.aud,url);assert.equal(claims.scope,'https://www.googleapis.com/auth/datastore');assert.equal(claims.exp-claims.iat,3600);
      assert.equal(await crypto.subtle.verify('RSASSA-PKCS1-v1_5',keys.publicKey,Buffer.from(signature,'base64url'),new TextEncoder().encode(header+'.'+payload)),true);
      assert.equal(init.redirect,'manual');return Response.json({access_token:'synthetic-oauth-token',token_type:'Bearer',expires_in:3600});
    }
    assert.ok(url.startsWith('https://firestore.googleapis.com/v1/'+DEV_DATABASE_NAME));
    const suffix=url.slice(('https://firestore.googleapis.com/v1/'+DEV_DATABASE_NAME).length);
    const auth=new Headers(init.headers).get('Authorization');
    if(!auth){if(options.anonymousOpen&&init.method!=='PATCH')return Response.json({fields:{}});return Response.json({error:'denied'}, {status:403});}
    assert.equal(auth,'Bearer synthetic-oauth-token');
    if(!suffix)return options.metadataDenied?Response.json({error:'private details must never escape'}, {status:403}):Response.json({name:DEV_DATABASE_NAME,locationId:'europe-west1',databaseEdition:options.badEdition?'ENTERPRISE':'STANDARD',type:'FIRESTORE_NATIVE'});
    if(suffix==='/documents:commit'){
      commits++;const writes=JSON.parse(String(init.body)).writes;
      for(const w of writes){const name=w.update?.name||w.delete;assert.ok(name.startsWith(DEV_DATABASE_NAME+'/documents/_pgt_dev_diagnostics/'));const previous=records.get(name);
        if(w.currentDocument?.exists===false&&previous)return Response.json({}, {status:409});
        if(w.currentDocument?.updateTime!==undefined&&w.currentDocument.updateTime!==previous?.updateTime&&!options.staleAccepted){
          if(options.googlePrecondition||options.invalidArgument)return Response.json({error:{code:400,status:options.invalidArgument?'INVALID_ARGUMENT':'FAILED_PRECONDITION',message:'Synthetic private detail must not appear in report'}},{status:400});
          return Response.json({}, {status:412});
        }
        if(w.delete)records.delete(name);else records.set(name,{...w.update,updateTime:'version-'+(++version)});
      }
      if(options.ambiguousCreate&&commits===1)throw Error('Connection lost after committed create with secret details');
      return Response.json({writeResults:[{updateTime:'version-'+version}]});
    }
    assert.match(suffix,/^\/documents\/_pgt_dev_diagnostics\/[a-f0-9-]{36}$/);
    return records.has(DEV_DATABASE_NAME+suffix)?Response.json(records.get(DEV_DATABASE_NAME+suffix)):Response.json({}, {status:404});
  };
  return {transport,records,calls,get oauth(){return oauth;}};
}
test('DEV OAuth validates identity before transport, signs scoped JWT, coalesces and caches without exposing key',async()=>{
  for(const changed of [{...account,project_id:'other-project'},{...account,client_email:'other@example.test'},{...account,type:'authorized_user'}])
    assert.throws(()=>new FirestoreIdentity(JSON.stringify(changed),()=>{throw Error('must not call');}),/FIRESTORE_DEV_IDENTITY_REQUIRED/);
  const f=fixture(),identity=new FirestoreIdentity(JSON.stringify(account),f.transport);
  assert.deepEqual(await Promise.all(Array.from({length:12},()=>identity.token())),Array(12).fill('synthetic-oauth-token'));
  assert.equal(await identity.token(),'synthetic-oauth-token');assert.equal(f.oauth,1);
});
test('DEV preflight proves metadata, read/write, CAS, anonymous denial and cleanup using only synthetic path',async()=>{
  const f=fixture(),r=await firestorePreflight(env,f.transport);
  assert.equal(r.location,'europe-west1');assert.equal(r.edition,'STANDARD');assert.equal(r.mode,'FIRESTORE_NATIVE');assert.equal(r.createReadUpdateDelete,true);
  assert.equal(r.staleWriteRejected,true);assert.equal(r.anonymousReadDenied,true);assert.equal(r.anonymousWriteDenied,true);assert.equal(f.records.size,0);
  assert.match(r.rulesSource,/NOT_READ/);assert.ok(!JSON.stringify(r).includes('synthetic-oauth-token'));assert.ok(!JSON.stringify(r).includes(privateKey));
});
test('Project/database misconfiguration fails closed before network, with no fallback to GitHub',async()=>{
  const f=fixture();await assert.rejects(firestorePreflight({...env,FIRESTORE_PROJECT_ID:'other-project'},f.transport),/FIRESTORE_DEV_TARGET_REQUIRED/);assert.equal(f.calls.length,0);
  await assert.rejects(firestorePreflight({...env,FIRESTORE_DATABASE_ID:'other'},f.transport),/FIRESTORE_DEV_TARGET_REQUIRED/);assert.equal(f.calls.length,0);
});
test('Google HTTP 400 FAILED_PRECONDITION is a rejected stale version; unrelated HTTP 400 is not proof of CAS',async()=>{
  const valid=fixture({googlePrecondition:true});const report=await firestorePreflight(env,valid.transport);
  assert.equal(report.staleWriteStatus,400);assert.equal(report.staleWriteRejected,true);assert.equal(valid.records.size,0);
  assert.ok(!JSON.stringify(report).includes('Synthetic private detail'));
  const invalid=fixture({invalidArgument:true});await assert.rejects(firestorePreflight(env,invalid.transport),/FIRESTORE_PREFLIGHT_CAS_NOT_ENFORCED/);assert.equal(invalid.records.size,0);
});
for(const [name,options,error] of [
  ['metadata permission',{metadataDenied:true},'FIRESTORE_METADATA_403'],
  ['wrong edition',{badEdition:true},'FIRESTORE_DATABASE_CONFIGURATION_MISMATCH'],
  ['open anonymous read',{anonymousOpen:true},'FIRESTORE_ANONYMOUS_ACCESS_NOT_DENIED'],
  ['stale CAS accepted',{staleAccepted:true},'FIRESTORE_PREFLIGHT_CAS_NOT_ENFORCED'],
  ['ambiguous create',{ambiguousCreate:true},'FIRESTORE_NETWORK_UNAVAILABLE'],
] as const)test('Preflight rejects '+name+' and removes its temporary diagnostic',async()=>{
  const f=fixture(options);await assert.rejects(firestorePreflight(env,f.transport),new RegExp(error));assert.equal(f.records.size,0);
});
test('Deployment authorization pins account and script; invalid, redirected and absent auth cannot reach Google',async()=>{
  let called=0;
  const valid:Transport=async(url,init)=>{called++;assert.equal(url,'https://api.cloudflare.com/client/v4/accounts/'+env.DEV_ACCOUNT_ID+'/workers/scripts/pgt-github-probe-dev/settings');assert.equal(init?.redirect,'manual');return Response.json({success:true,result:{bindings:[]}});};
  await assert.rejects(authorizePreflight(new Request('https://example'),env,valid),/DEPLOYMENT_AUTH_REQUIRED/);assert.equal(called,0);
  const request=new Request('https://example',{headers:{Authorization:'Bearer '+'synthetic-deployment-token'}});
  await authorizePreflight(request,env,valid);assert.equal(called,1);
  await assert.rejects(authorizePreflight(request,{...env,DEV_ACCOUNT_ID:'bad'},valid),/DEV_ACCOUNT_NOT_CONFIGURED/);assert.equal(called,1);
  await assert.rejects(authorizePreflight(request,env,async()=>new Response(null,{status:302})),/DEV_DEPLOYMENT_AUTH_REQUIRED/);
  await assert.rejects(authorizePreflight(request,env,async()=>Response.json({success:false})),/DEV_DEPLOYMENT_AUTH_REQUIRED/);
});
