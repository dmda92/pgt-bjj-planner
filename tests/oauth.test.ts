import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PgtControl} from '../worker/index.ts';
import {seal, unseal} from '../worker/security.ts';

function fixture() {
  const data=new Map<string,unknown>();
  const storage={get:async(k:string)=>data.get(k),put:async(k:string,v:unknown)=>{data.set(k,v);},delete:async(k:string)=>data.delete(k),list:async()=>new Map(data)};
  const env={ALLOWED_ORIGIN:'https://pgt.example',PUBLIC_BASE_URL:'https://api.example',ADMIN_SETUP_KEY:'admin-example',OWNER_MAIL:'pgt.bjj@outlook.es',MS_CLIENT_ID:'public-id',MS_CLIENT_SECRET:'mock-secret',TOKEN_ENCRYPTION_KEY:btoa('k'.repeat(32))};
  const instance=new PgtControl({storage} as unknown as DurableObjectState, env as never);
  const admin=(path:string)=>instance.fetch(new Request('https://api.example'+path,{method:'POST',headers:{Authorization:'Bearer admin-example'}}));
  return {data,env,instance,admin};
}
test('OAuth guarda tokens cifrados, PKCE y estado de un solo uso; renovación persistente serializada',async()=>{
  const {data,env,instance,admin}=fixture();const original=globalThis.fetch;let refreshes=0;
  globalThis.fetch=async(url,init)=>{
    if(String(url).includes('/token')) {
      const params=new URLSearchParams(String(init?.body));
      if(params.get('grant_type')==='refresh_token') {refreshes++;assert.equal(params.get('refresh_token'),refreshes===1?'initial-refresh':'rotated-1');}
      else assert.ok(params.get('code_verifier'));
      return Response.json({access_token:'example-access',refresh_token:refreshes?'rotated-'+refreshes:'initial-refresh',expires_in:3600});
    }
    return Response.json({mail:env.OWNER_MAIL});
  };
  try {
    const start=await (await admin('/admin/oauth/start')).json() as {url:string};const auth=new URL(start.url);
    assert.equal(auth.searchParams.get('code_challenge_method'),'S256');assert.equal(auth.searchParams.get('redirect_uri'),'https://api.example/oauth/callback');
    const callback='https://api.example/oauth/callback?state='+auth.searchParams.get('state')+'&code=mock-code';
    assert.equal((await instance.fetch(new Request(callback))).status,200);
    assert.equal((await instance.fetch(new Request(callback))).status,403);
    const saved=data.get('tokens') as string;assert.ok(!saved.includes('initial-refresh'));
    assert.equal((await unseal<{refresh_token:string}>(saved,env.TOKEN_ENCRYPTION_KEY)).refresh_token,'initial-refresh');
    const responses=await Promise.all([admin('/admin/refresh'),admin('/admin/refresh')]);assert.ok(responses.every(r=>r.status===200));assert.equal(refreshes,2);
    assert.equal((await unseal<{refresh_token:string}>(data.get('tokens') as string,env.TOKEN_ENCRYPTION_KEY)).refresh_token,'rotated-2');
  }finally{globalThis.fetch=original;}
});
test('Revocación Microsoft invalida tokens; fallos transitorios conservan autorización',async()=>{
  const {data,env,admin}=fixture();const original=globalThis.fetch;
  await data.set('tokens',await seal({access_token:'sample',refresh_token:'sample-refresh',expiresAt:0},env.TOKEN_ENCRYPTION_KEY));
  try{
    globalThis.fetch=async()=>new Response('{}',{status:503});
    assert.equal((await admin('/admin/refresh')).status,503);assert.ok(data.has('tokens'));
    globalThis.fetch=async()=>Response.json({error:'invalid_grant'},{status:400});
    const response=await admin('/admin/refresh');assert.equal(response.status,503);assert.equal(data.has('tokens'),false);
    assert.ok((await response.text()).includes('MICROSOFT_REAUTH_REQUIRED'));
  }finally{globalThis.fetch=original;}
});
test('Una cuenta Microsoft ajena no reemplaza la autorización del propietario',async()=>{
  const {data,instance,admin}=fixture();const original=globalThis.fetch;
  globalThis.fetch=async(url)=>String(url).includes('/token')?Response.json({access_token:'example',refresh_token:'example',expires_in:3600}):Response.json({mail:'someone@example.com'});
  try{
    const start=await (await admin('/admin/oauth/start')).json() as {url:string};const state=new URL(start.url).searchParams.get('state');
    const response=await instance.fetch(new Request('https://api.example/oauth/callback?state='+state+'&code=example'));
    assert.equal(response.status,403);assert.equal(data.has('tokens'),false);
  }finally{globalThis.fetch=original;}
});
