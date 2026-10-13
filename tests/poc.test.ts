import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mail, requireOwnMail, hashPassword, verifyPassword, seal, unseal, Fault} from '../worker/security.ts';
import {Graph} from '../worker/graph.ts';
import {PgtControl} from '../worker/index.ts';

test('Correos normalizados y rutas ambiguas rechazadas', () => {
  assert.equal(mail(' Alumno@Ejemplo.com '), 'alumno@ejemplo.com');
  for (const value of ['../foo@example.com','a/b@example.com','a%2f@example.com','a..b@example.com',null,'a@example.com/']) assert.throws(()=>mail(value));
});
test('Acceso cruzado rechazado aunque el cliente conozca la ruta', () => {
  requireOwnMail('a@example.com','A@example.com');
  assert.throws(()=>requireOwnMail('a@example.com','b@example.com'), (e: unknown)=>e instanceof Fault && e.status===403);
});
test('Contraseñas con sal independiente y verificación sin reversibilidad', async () => {
  const one = await hashPassword('sample-poc-password'); const two = await hashPassword('sample-poc-password');
  assert.notEqual(one,two); assert.equal(await verifyPassword('sample-poc-password',one),true);
  assert.equal(await verifyPassword('wrong-poc-password',one),false);
  await assert.rejects(hashPassword('short'));
});
test('Tokens cifrados con AES-GCM: persistencia, clave incorrecta e integridad', async () => {
  const key=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const value={access_token:'access-example',refresh_token:'refresh-example',expiresAt:123};
  const encrypted=await seal(value,key); assert.ok(!encrypted.includes('refresh-example'));
  assert.deepEqual(await unseal(encrypted,key),value);
  await assert.rejects(unseal(encrypted,btoa('0'.repeat(32))));
});
test('Graph conserva If-Match y propaga 412 sin sobrescritura', async () => {
  let header='';
  const transport: typeof fetch=async (_url,init)=>{header=new Headers(init?.headers).get('If-Match')||'';return new Response('{}',{status:412});};
  await assert.rejects(new Graph('example',transport).update('PGT/users_data/a@example.com/viability.json',{},'"v1"'), (e: unknown)=>e instanceof Fault&&e.status===412);
  assert.equal(header,'"v1"');
});
test('Graph no acepta rutas fuera de PGT ni comodín de versión', async () => {
  let count=0; const transport: typeof fetch=async()=>{count++;return new Response('{}');};
  const graph=new Graph('example',transport);
  for(const path of ['other/file.json','PGT/../outside','PGT/%2e%2e/secret']) await assert.rejects(graph.read(path));
  await assert.rejects(graph.update('PGT/a.json',{},'*')); assert.equal(count,0);
});
test('Graph pide crear sin sobrescribir archivos existentes', async () => {
  let observed=''; const transport: typeof fetch=async(url)=>{observed=String(url);return Response.json({});};
  await new Graph('example',transport).create('PGT/users_data/a@example.com','viability.json',{});
  assert.ok(observed.includes('conflictBehavior=fail'));
});

function control() {
  const data=new Map<string,unknown>();
  const storage={get:async(key:string)=>data.get(key),put:async(key:string,value:unknown)=>{data.set(key,value);},delete:async(key:string)=>data.delete(key),list:async()=>new Map(data)};
  const env={ALLOWED_ORIGIN:'https://pgt.example',ADMIN_SETUP_KEY:'poc-admin-example',OWNER_MAIL:'pgt.bjj@outlook.es'};
  return {instance:new PgtControl({storage} as unknown as DurableObjectState,env as never),data};
}
test('API bloquea orígenes ajenos, rutas genéricas y admin sin clave', async()=>{
  const {instance}=control();
  assert.equal((await instance.fetch(new Request('https://api.example/admin/refresh',{method:'POST',headers:{Origin:'https://evil.example'}}))).status,403);
  assert.equal((await instance.fetch(new Request('https://api.example/admin/refresh',{method:'POST'}))).status,403);
  assert.equal((await instance.fetch(new Request('https://api.example/graph?path=anything'))).status,404);
});
test('Estado OAuth ausente/reutilizado y sesión no válida se rechazan', async()=>{
  const {instance}=control();
  assert.equal((await instance.fetch(new Request('https://api.example/oauth/callback?state=unknown&code=sample'))).status,403);
  assert.equal((await instance.fetch(new Request('https://api.example/poc/users/a@example.com/json'))).status,401);
});
test('Sesión válida de A no puede leer ni escribir B; sin llamada Graph', async()=>{
  const {instance,data}=control(); const token='a'.repeat(43);
  const {digest}=await import('../worker/security.ts');
  data.set('session:'+await digest(token),{mail:'a@example.com',expiresAt:Date.now()+60000});
  for(const method of ['GET','PUT']) assert.equal((await instance.fetch(new Request('https://api.example/poc/users/b@example.com/json',{method,headers:{Authorization:'Bearer '+token}}))).status,403);
});
test('Cerrar sesión revoca inmediatamente en servidor', async()=>{
  const {instance,data}=control(); const token='b'.repeat(43); const {digest}=await import('../worker/security.ts');
  const key='session:'+await digest(token);data.set(key,{mail:'a@example.com',expiresAt:Date.now()+60000});
  assert.equal((await instance.fetch(new Request('https://api.example/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+token}}))).status,200);
  assert.equal(data.has(key),false);
  assert.equal((await instance.fetch(new Request('https://api.example/poc/users/a@example.com/json',{headers:{Authorization:'Bearer '+token}}))).status,401);
});
