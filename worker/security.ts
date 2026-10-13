export class ApiError extends Error {
  status: number;
  retryAfter?: number;
  constructor(status: number, code: string, retryAfter?: number) {super(code);this.status=status;this.retryAfter=retryAfter;}
}
export function reject(status: number, code: string, retryAfter?: number): never {throw new ApiError(status,code,retryAfter);}
export function normalizedMail(value: unknown): string {
  if(typeof value!=='string')return reject(400,'MAIL_INVALID');
  const result=value.trim().toLowerCase();
  if(result.length>180||result.includes('..')||! /^[a-z0-9][a-z0-9._+-]{0,63}@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,24}$/.test(result))return reject(400,'MAIL_INVALID');
  return result;
}
export function equal(a:string,b:string):boolean {
  let diff=a.length^b.length;
  for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);
  return diff===0;
}
function base64(bytes:Uint8Array):string {return btoa(String.fromCharCode(...bytes));}
export function opaqueToken():string {return base64(crypto.getRandomValues(new Uint8Array(32))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');}
export async function fingerprint(value:string):Promise<string>{return base64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));}
export async function passwordHash(value:unknown,salt=opaqueToken()):Promise<string>{
  if(typeof value!=='string'||value.length<12||value.length>128)return reject(400,'PASSWORD_LENGTH_12_128');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(value),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode(salt),iterations:600000},key,256);
  return `pbkdf2-sha256$600000$${salt}$${base64(new Uint8Array(bits))}`;
}
export async function passwordMatches(value:unknown,stored:string):Promise<boolean>{
  const [kind,rounds,salt,hash,...extra]=stored.split('$');
  if(kind!=='pbkdf2-sha256'||rounds!=='600000'||!salt||!hash||extra.length)return false;
  return equal(await passwordHash(value,salt),stored);
}
export function ownResource(sessionMail:string,requestedMail:string):void{
  if(normalizedMail(sessionMail)!==normalizedMail(requestedMail))reject(403,'OTHER_USER_FORBIDDEN');
}
export async function jsonBody(request:Request):Promise<Record<string,unknown>>{
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))return reject(415,'JSON_REQUIRED');
  const reader=request.body?.getReader();if(!reader)return reject(400,'BODY_REQUIRED');
  const parts:Uint8Array[]=[];let length=0;
  for(;;){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>16384){await reader.cancel();reject(413,'BODY_TOO_LARGE');}parts.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  try{const value:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!value||typeof value!=='object'||Array.isArray(value))reject(400,'JSON_OBJECT_REQUIRED');return value as Record<string,unknown>;}catch{return reject(400,'JSON_INVALID');}
}
export function onlyFields(value:Record<string,unknown>,fields:string[]):void{if(Object.keys(value).some(key=>!fields.includes(key)))reject(400,'UNEXPECTED_FIELD');}
