import assert from 'node:assert/strict';
import {generateKeyPairSync,verify} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const credential=JSON.stringify({type:'service_account',project_id:'pgt-bjj-dev',client_email:'pgt-worker-dev@pgt-bjj-dev.iam.gserviceaccount.com',private_key:privateKey.export({type:'pkcs8',format:'pem'})});
const bundle=await build({entryPoints:['worker/dev.ts'],bundle:true,write:false,format:'esm',target:'es2022'});
const name='projects/pgt-bjj-dev/databases/(default)',base='https://firestore.googleapis.com/v1/'+name;
const records=new Map();let version=0,outgoing=0,authorized=true;
const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-13',durableObjects:{SECURITY:{className:'ProbeSecurity',useSQLite:true}},bindings:{FIRESTORE_PROJECT_ID:'pgt-bjj-dev',FIRESTORE_DATABASE_ID:'(default)',DEV_ACCOUNT_ID:'a'.repeat(32),FIRESTORE_SERVICE_ACCOUNT_JSON:credential,DATA_BRANCH:'main',ALLOWED_ORIGINS:'https://pgt-github-probe-dev.david-dzm5.workers.dev'},outboundService:async request=>{
  outgoing++;
  if(request.url==='https://api.cloudflare.com/client/v4/accounts/'+'a'.repeat(32)+'/workers/scripts/pgt-github-probe-dev/settings'){
    assert.equal(request.headers.get('Authorization'),'Bearer synthetic-deployment-token');
    return Response.json(authorized?{success:true,result:{bindings:[]}}:{success:false},{status:authorized?200:403});
  }
  if(request.url==='https://oauth2.googleapis.com/token'){
    const body=new URLSearchParams(await request.text()),parts=body.get('assertion').split('.');
    assert.equal(verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),publicKey,Buffer.from(parts[2],'base64url')),true);
    assert.equal(JSON.parse(Buffer.from(parts[1],'base64url').toString()).iss,'pgt-worker-dev@pgt-bjj-dev.iam.gserviceaccount.com');
    return Response.json({access_token:'synthetic-google-token',token_type:'Bearer',expires_in:3600});
  }
  assert.ok(request.url.startsWith(base),'DEV may not contact GitHub, PRO or arbitrary hosts');
  if(!request.headers.has('Authorization'))return Response.json({error:'denied'},{status:403});
  assert.equal(request.headers.get('Authorization'),'Bearer synthetic-google-token');
  const suffix=request.url.slice(base.length);
  if(!suffix)return Response.json({name,locationId:'europe-west1',databaseEdition:'STANDARD',type:'FIRESTORE_NATIVE'});
  if(suffix==='/documents:commit'){
    const {writes}=await request.json();
    for(const w of writes){const path=w.update?.name||w.delete;assert.ok(path.startsWith(name+'/documents/_pgt_dev_diagnostics/'));
      const previous=records.get(path);
      if(w.currentDocument?.exists===false&&previous)return Response.json({},{status:409});
      if(w.currentDocument?.updateTime&&previous?.updateTime!==w.currentDocument.updateTime)return Response.json({error:{code:400,status:'FAILED_PRECONDITION'}},{status:400});
      if(w.delete)records.delete(path);else records.set(path,{...w.update,updateTime:'revision-'+(++version)});
    }return Response.json({writeResults:[]});
  }
  return records.has(name+suffix)?Response.json(records.get(name+suffix)):Response.json({},{status:404});
}}));
const url='http://localhost/api/dev/firestore-preflight';
const headers={Origin:'https://pgt-github-probe-dev.david-dzm5.workers.dev',Authorization:'Bearer synthetic-deployment-token'};
try{
  assert.equal((await runtime.dispatchFetch(url,{method:'POST',headers:{Origin:headers.Origin}})).status,401);assert.equal(outgoing,0);
  assert.equal((await runtime.dispatchFetch(url,{method:'POST',headers:{...headers,Origin:'https://unauthorized.example'}})).status,403);assert.equal(outgoing,0);
  assert.equal((await runtime.dispatchFetch(url,{headers})).status,405);assert.equal(outgoing,0);
  authorized=false;assert.equal((await runtime.dispatchFetch(url,{method:'POST',headers})).status,403);assert.equal(records.size,0);
  authorized=true;const response=await runtime.dispatchFetch(url,{method:'POST',headers});const report=await response.json();
  assert.equal(response.status,200,JSON.stringify(report));assert.equal(report.status,'FIRESTORE_DEV_CONNECTION_VERIFIED');assert.equal(report.location,'europe-west1');assert.equal(report.staleWriteRejected,true);assert.equal(report.staleWriteStatus,400);assert.equal(report.anonymousWriteDenied,true);assert.equal(records.size,0);
  assert.ok(!JSON.stringify(report).includes('synthetic-google-token'));assert.ok(!JSON.stringify(report).includes('BEGIN PRIVATE KEY'));
  console.log('DEV entrypoint + inherited SQLite DO + native RS256 OAuth + fixed-host authorization + Firestore CRUD/CAS/anonymous denial/cleanup PASS (intercepted transport; not remote Firestore).');
}finally{await runtime.dispose();}
