import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
/** Test-only headers identify the actual outbound DO, not a repository cache.
 * Also force the existing JS PBKDF2 fallback used when native iteration limits apply. */
export const limitedRuntimePlugin={name:'actual-do-budgets',setup(build){
 build.onLoad({filter:/worker\/dev\.ts$/},async({path})=>{
  let source=await readFile(path,'utf8');const target="const send=(url:string,options:RequestInit)=>fetch(url,{...options,redirect:'manual',signal:AbortSignal.timeout(20000)});";assert.ok(source.includes(target));
  source=source.replace(target,"const send=(url:string,options:RequestInit)=>{const headers=new Headers(options.headers);headers.set('X-QA-IO-Invocation',this.ctx.id.toString());return fetch(url,{...options,headers,redirect:'manual',signal:AbortSignal.timeout(20000)});};");
  return {contents:source,loader:'ts'};
 });
 build.onLoad({filter:/worker\/security\.ts$/},async({path})=>{
  let source=await readFile(path,'utf8');assert.ok(source.includes('await crypto.subtle.deriveBits('));
  // Simulates the known native platform restriction without weakening the KDF.
  source=source.replace('await crypto.subtle.deriveBits(',"await (async()=>{throw new DOMException('PBKDF2 iterations exceed maximum 100000','NotSupportedError');})(");
  return {contents:source,loader:'ts'};
 });
}};
export function limitedOutbound(transport){
 const counts=new Map();
 return {counts,async fetch(request){
  const invocation=request.headers.get('X-QA-IO-Invocation');
  if(invocation){const n=(counts.get(invocation)||0)+1;counts.set(invocation,n);assert.ok(n<=32,'Actual outbound DO exhausted its bounded HTTP budget: '+n);}
  return transport(request.url,{method:request.method,headers:request.headers,body:['GET','HEAD'].includes(request.method)?undefined:await request.text()});
 }};
}
