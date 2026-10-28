import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFirestoreTarget } from '../worker/firestore-target.ts';
import { FirestoreIdentity } from '../worker/firestore-auth.ts';
import { NativeFirestore } from '../worker/structured/firestore.ts';
const config = (environment: 'dev' | 'pro') => ({ FIRESTORE_ENVIRONMENT: environment, FIRESTORE_PROJECT_ID: `pgt-bjj-${environment}`, FIRESTORE_DATABASE_ID: '(default)', FIRESTORE_SERVICE_ACCOUNT_EMAIL: `pgt-worker-${environment}@pgt-bjj-${environment}.iam.gserviceaccount.com` });
for (const environment of ['dev','pro'] as const) test(`${environment} pins project/database/principal and rejects crossed credentials before HTTP`, async () => {
 const env=config(environment), target=resolveFirestoreTarget(env); let calls=0;
 const transport=async()=>{calls++;return Response.json({});};
 const credential={type:'service_account',project_id:target.project,client_email:target.serviceAccountEmail,private_key:'-----BEGIN PRIVATE KEY-----synthetic'};
 assert.equal(new FirestoreIdentity(JSON.stringify(credential),transport,Date.now,target).principal,target.serviceAccountEmail);
 const other=environment==='dev'?'pro':'dev';
 assert.throws(()=>new FirestoreIdentity(JSON.stringify({...credential,project_id:`pgt-bjj-${other}`}),transport,Date.now,target));
 assert.throws(()=>new FirestoreIdentity(JSON.stringify({...credential,client_email:config(other).FIRESTORE_SERVICE_ACCOUNT_EMAIL}),transport,Date.now,target));
 assert.throws(()=>resolveFirestoreTarget({...env,FIRESTORE_PROJECT_ID:`pgt-bjj-${other}`}));
 assert.throws(()=>resolveFirestoreTarget({...env,FIRESTORE_DATABASE_ID:'other'}));
 assert.throws(()=>resolveFirestoreTarget({...env,FIRESTORE_SERVICE_ACCOUNT_EMAIL:undefined}));
 const db=new NativeFirestore({...env,FIRESTORE_SERVICE_ACCOUNT_JSON:JSON.stringify(credential)},transport);
 assert.equal(db.project,target.project); assert.equal(db.database,'(default)');
 assert.throws(()=>db.row({name:`projects/pgt-bjj-${other}/databases/(default)/documents/pgt_v2/control`,fields:{},updateTime:'x'}));
 assert.equal(calls,0);
});
test('runtime resolution rejects missing and arbitrary configurations; legacy compatibility is DEV only',()=>{
 for(const env of [{}, {FIRESTORE_PROJECT_ID:'pgt-bjj-dev',FIRESTORE_DATABASE_ID:'(default)'}, {...config('pro'),FIRESTORE_ENVIRONMENT:'staging'}, {...config('pro'),FIRESTORE_PROJECT_ID:'arbitrary'}]) assert.throws(()=>resolveFirestoreTarget(env));
 assert.equal(resolveFirestoreTarget({FIRESTORE_PROJECT_ID:'pgt-bjj-dev',FIRESTORE_DATABASE_ID:'(default)'},{legacyDev:true}).environment,'dev');
 assert.throws(()=>resolveFirestoreTarget({FIRESTORE_PROJECT_ID:'pgt-bjj-pro',FIRESTORE_DATABASE_ID:'(default)'},{legacyDev:true}));
});

test('PRO metadata preflight is read-only, rejects mismatched metadata and DEV CRUD preflight', async()=>{
 const {firestoreFixture}=await import('./firestore-fixture.ts');
 const {firestoreTargetPreflight,firestorePreflight}=await import('../worker/firestore-preflight.ts');
 const f=await firestoreFixture(), env=config('pro'), key=JSON.parse(f.env.FIRESTORE_SERVICE_ACCOUNT_JSON);
 key.project_id=env.FIRESTORE_PROJECT_ID;key.client_email=env.FIRESTORE_SERVICE_ACCOUNT_EMAIL;
 const full={...env,FIRESTORE_SERVICE_ACCOUNT_JSON:JSON.stringify(key)}, calls:{url:string;method:string}[]=[]; let wrong=false;
 const transport=async(url:string,init:RequestInit={})=>{
  calls.push({url,method:init.method||'GET'});
  if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic-token',token_type:'Bearer',expires_in:3600});
  assert.equal(url,'https://firestore.googleapis.com/v1/projects/pgt-bjj-pro/databases/(default)');assert.equal(init.method,undefined);
  return Response.json({name:`projects/${wrong?'pgt-bjj-dev':'pgt-bjj-pro'}/databases/(default)`,type:'FIRESTORE_NATIVE',databaseEdition:'STANDARD',locationId:'europe-west1'});
 };
 assert.equal((await firestoreTargetPreflight(full,transport)).writesPerformed,false);
 assert.equal(calls.filter(c=>c.url.includes('firestore')).length,1);
 wrong=true;await assert.rejects(()=>firestoreTargetPreflight(full,transport));
 const before=calls.length;await assert.rejects(()=>firestorePreflight(full,transport));assert.equal(calls.length,before);
 assert.ok(calls.every(c=>c.url.includes('oauth2')||c.method==='GET'));
});
