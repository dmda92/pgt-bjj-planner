import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PgtControl} from '../worker/index.ts';
import {digest,seal} from '../worker/security.ts';

test('API crea, lee, actualiza JSON y rechaza revisión/versión antigua sin modificarlo',async()=>{
  const store=new Map<string,unknown>();
  const storage={get:async(k:string)=>store.get(k),put:async(k:string,v:unknown)=>{store.set(k,v);},delete:async(k:string)=>store.delete(k),list:async()=>new Map(store)};
  const secret=btoa('k'.repeat(32)); const token='c'.repeat(43);
  store.set('tokens',await seal({access_token:'mock-access',refresh_token:'mock-refresh',expiresAt:Date.now()+3600000},secret));
  store.set('session:'+await digest(token),{mail:'a@example.com',expiresAt:Date.now()+3600000});
  const instance=new PgtControl({storage} as unknown as DurableObjectState,{TOKEN_ENCRYPTION_KEY:secret,ALLOWED_ORIGIN:'https://pgt.example'} as never);
  const original=globalThis.fetch;let version=0;let document:unknown=null;
  globalThis.fetch=async(url,init)=>{
    assert.ok(String(url).startsWith('https://graph.microsoft.com/'));
    if(init?.method==='PUT') {
      if(version && new Headers(init.headers).get('If-Match')!==`"v${version}"`)return new Response('{}',{status:412});
      document=JSON.parse(String(init.body));version++;return Response.json({eTag:`"v${version}"`});
    }
    if(!document)return new Response('{}',{status:404});
    return String(url).includes(':/content')?Response.json(document):Response.json({id:'mock-id',eTag:`"v${version}"`,size:100});
  };
  const call=(method='GET',body?:unknown,etag?:string)=>instance.fetch(new Request('https://api.example/poc/users/a@example.com/json',{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(etag?{'If-Match':etag}:{})},body:body?JSON.stringify(body):undefined}));
  try{
    assert.equal((await call()).status,404);
    assert.equal((await call('PUT',{value:'initial',revision:1})).status,200);
    const first=await (await call()).json() as {data:{value:string};etag:string};assert.equal(first.data.value,'initial');assert.equal(first.etag,'"v1"');
    assert.equal((await call('PUT',{value:'updated',revision:2},first.etag)).status,200);
    assert.equal((await call('PUT',{value:'discard-me',revision:3},first.etag)).status,412);
    assert.equal((await call('PUT',{value:'discard-me',revision:99},'"v2"')).status,400);
    const current=await (await call()).json() as {data:{value:string}};assert.equal(current.data.value,'updated');assert.equal(version,2);
  }finally{globalThis.fetch=original;}
});
