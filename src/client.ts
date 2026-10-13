export {};
declare const API_BASE:string;
const input=(id:string)=>document.getElementById(id) as HTMLInputElement;
const output=document.getElementById('result')!;
let session='',identity='',sha:string|null=null;
async function call(path:string,method='GET',body?:unknown,admin=false):Promise<Record<string,unknown>>{
  const credential=admin?input('admin').value:session;
  const response=await fetch(API_BASE+path,{method,headers:{...(credential?{Authorization:`Bearer ${credential}`}:{ }),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store'});
  const data=await response.json() as Record<string,unknown>;
  const {token:omitted,...safe}=data;output.textContent=JSON.stringify({http:response.status,...safe},null,2);
  if(!response.ok)throw Error(String(data.error||'Error de API'));return data;
}
function event(id:string,action:()=>Promise<unknown>){document.getElementById(id)!.addEventListener('click',async()=>{try{await action();}catch(error){output.textContent=`${error instanceof Error?error.message:'Error de red'}\n${output.textContent}`;}});}
const path=(mail=identity)=>'/api/probe/users/'+encodeURIComponent(mail)+'/json';
event('check',()=>call('/api/admin/check','POST',{},true));
event('create-user',async()=>{try{await call('/api/admin/test-user','POST',{mail:input('new-mail').value,password:input('new-password').value},true);}finally{input('new-password').value='';}});
event('login',async()=>{
  // Switching test users clears previous in-memory state even if the next login fails.
  session='';identity='';sha=null;input('value').value='';document.getElementById('identity')!.textContent='Sin sesión';
  try{const data=await call('/api/auth/login','POST',{mail:input('mail').value,password:input('password').value});session=String(data.token);identity=String(data.mail);document.getElementById('identity')!.textContent=`Sesión PGT: ${identity}`;}finally{input('password').value='';input('admin').value='';}
});
event('logout',async()=>{try{await call('/api/auth/logout','POST',{});}finally{session='';identity='';sha=null;input('value').value='';document.getElementById('identity')!.textContent='Sin sesión';}});
event('read',async()=>{try{const current=await call(path());sha=String(current.sha);input('value').value=String((current.data as {value:string}).value);}catch(error){sha=null;throw error;}});
event('write',async()=>{const current=await call(path(),'PUT',{value:input('value').value,sha});sha=String(current.sha);});
event('delete',async()=>{await call(path(),'DELETE',{sha});sha=null;input('value').value='';});
event('cross',()=>call(path(input('other').value)));
event('stale',()=>call(path(),'PUT',{value:'No debe guardarse',sha:'0'.repeat(40)}));
