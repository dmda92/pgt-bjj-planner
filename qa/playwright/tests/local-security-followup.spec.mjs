import {caseTest,expect} from '../helpers/case-test.mjs';
import {createLocalAcademy} from '../helpers/local-academy.mjs';
import {userPath,operation,publicState,competition,exportedCopy,editor} from '../helpers/fault-contracts.mjs';
import {execFileSync} from 'node:child_process';

const environment='Chromium HTTP y Worker reales locales; transporte Firestore sintetico, sin Google/DEV/PRO';
caseTest('SEC 01',{environment,users:['Alumno y control nuevos sinteticos','Entrenador sintetico']},async({browser},r)=>{
 const a=await createLocalAcademy();const context=await browser.newContext(),page=await context.newPage();
 try{
  const u=await a.register('sec01-http'),v=await a.register('sec01-control');
  const before=await publicState(a,u),control=await publicState(a,v);await page.goto(a.origin);
  const request=async(path,token,post=false)=>page.evaluate(async({path,token,post})=>{
   const response=await fetch('/api/v2/'+path,{method:post?'POST':'GET',headers:token?{Authorization:'Bearer '+token}:{}});
   const body=await response.json();return{status:response.status,body};
  },{path,token,post});
  const matrix=[];
  await a.call('auth/logout',{},u.token);
  for(const [kind,token]of[['absent',''],['invalid','invalid'],['logout-revoked',u.token]]){
   for(const path of[userPath(u,'profile'),userPath(u),'catalog',userPath(u,'assignment'),'roster']){
    const result=await request(path,token);expect(result.status).toBe(401);expect(Object.keys(result.body)).toEqual(['error']);matrix.push({kind,path,status:result.status});
   }
   for(const path of['commands/profile','commands/repertoire','commands/comments','commands/assignment']){
    const result=await request(path,token,true);expect(result.status).toBe(401);expect(Object.keys(result.body)).toEqual(['error']);matrix.push({kind,path,status:result.status});
   }
  }
  u.token=(await a.call('auth/login',{mail:u.profile.mail,password:a.password})).token;
  expect(await publicState(a,u)).toEqual(before);expect(await publicState(a,v)).toEqual(control);
  const stale=u.token;
  for(const perfil of['entrenador','alumno']){const old=await a.call(userPath(u,'profile'),undefined,a.trainer.token);await a.call('commands/role',{mail:u.profile.mail,perfil,expected:old.version,operationId:crypto.randomUUID()},a.trainer.token);}
  expect((await request(userPath(u),stale)).status).toBe(401);
  await a.restart();expect((await request(userPath(u),stale)).status).toBe(401);
  const fresh=await a.call('auth/login',{mail:u.profile.mail,password:a.password});expect((await request(userPath(u),fresh.token)).status).toBe(200);
  expect(await publicState(a,v)).toEqual(control);u.token=fresh.token;
  const after=await publicState(a,u);for(const key of['techniques','comments','index','plans'])expect(after[key]).toEqual(before[key]);
  const fields=p=>{const{revision,updatedAt,...business}=p;return business;};expect(fields(after.profile.data)).toEqual(fields(before.profile.data));expect(after.profile.data.revision).toBe(before.profile.data.revision+2);expect(Date.parse(after.profile.data.updatedAt)).toBeGreaterThanOrEqual(Date.parse(before.profile.data.updatedAt));
  await r.json('http-denial-matrix',{matrix,revokedRoleCycleDeniedWarmAndAfterRestart:true,freshAuthenticationValid:true,unrelatedAccountDeepEqual:true,businessDeepEqual:true,responseBodiesContainOnlyError:true});
  r.result.steps.push('27 peticiones Chromium HTTP: cinco GET y cuatro POST sin credencial, invalida y revocada por logout; comparar estado completo sujeto/control.','Cambiar rol alumno-entrenador-alumno con CAS, rechazar token antiguo en caliente y tras reiniciar coordinador; autenticar de nuevo y comprobar negocio/control intactos.');
  r.finish('APROBADO','Matriz privada rechaza 27 peticiones con401 y solo error; logout revoca credencial real. Ciclo de rol no revive token en caliente ni tras reinicio; credencial nueva funciona y negocio/cuenta independiente permanecen integros.','Worker/Chromium reales locales con Firestore sintetico; no verifica IAM ni acceso Google remoto.');
 }finally{await context.close();await a.close();}
});

caseTest('PWD 06',{environment,users:['Alumno y control nuevos sinteticos','Entrenador sintetico']},async({browser},r)=>{
 const a=await createLocalAcademy();let context;
 try{
  const u=await a.register('pwd06-both'),v=await a.register('pwd06-control');await competition(a,[u]);
  const notes=await a.call(userPath(u,'comments'),undefined,a.trainer.token),catalog=await a.call(userPath(u),undefined,u.token);
  await a.call('commands/comments',operation({...notes.data,comments:[{techniqueId:catalog.data.positions[0].tecnicas[0].id,comment:'Integrity comment reference'}]},notes.version,{owner:u.profile.mail}),a.trainer.token);
  const before=await publicState(a,u),control=await publicState(a,v),secrets=[a.password,(await a.store.read({kind:'profile',id:u.profile.mail})).data.pwd];const changes=[];
  for(const [mode,password]of[['own-change','Synthetic-own-password-2026'],['trainer-reset','Synthetic-reset-password-2026']]){
   const p=await a.call(userPath(u,'profile'),undefined,a.trainer.token),oldToken=u.token;
   await a.call('commands/password',{mail:u.profile.mail,password,confirm:password,expected:p.version,operationId:crypto.randomUUID()},mode==='own-change'?u.token:a.trainer.token);
   expect((await a.response(userPath(u),undefined,oldToken)).status).toBe(401);u.token=(await a.call('auth/login',{mail:u.profile.mail,password})).token;
   const after=await publicState(a,u);for(const key of['profile','techniques','comments','index','plans'])expect(after[key].data??after[key]).toEqual(before[key].data??before[key]);expect(await publicState(a,v)).toEqual(control);
   secrets.push(password,(await a.store.read({kind:'profile',id:u.profile.mail})).data.pwd,u.token);
   context=await browser.newContext();const page=await context.newPage(),logs=[];page.on('console',m=>logs.push(m.text()));await a.login(page,u.profile.mail,password);await editor(page);
   const ui=await page.content(),copy=await exportedCopy(page);await page.getByRole('button',{name:/Mis planes/}).click();await page.getByLabel('Mi plan',{exact:true}).selectOption({index:1});const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Exportar PDF',exact:true}).click();const stream=await(await pending).createReadStream(),parts=[];for await(const part of stream)parts.push(part);
   const text=execFileSync('python',['-c',"import sys,io;sys.path.insert(0,'.qa/python-deps');from pypdf import PdfReader;print('\\n'.join(p.extract_text() or '' for p in PdfReader(io.BytesIO(sys.stdin.buffer.read())).pages))"],{input:Buffer.concat(parts),encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'}});
   const artifacts={ui,copy:JSON.stringify(copy),browserConsole:logs.join('\n'),pdfText:text};for(const value of Object.values(artifacts))for(const secret of secrets)expect(value.includes(secret)).toBe(false);
   changes.push({mode,deepProfileAndAllBusinessEqual:true,unrelatedUserDeepEqual:true,oldTokenRejected:true,artifactKinds:Object.keys(artifacts),knownPasswordsHashesAndTokensAbsent:true,pdfBytes:Buffer.concat(parts).length});await r.capture(page,mode+'-plans');await context.close();context=null;
  }
  await r.json('change-reset-integrity-and-secret-matrix',changes);r.result.steps.push('Crear plan y comentario; cambio propio y reset por entrenador sobre misma identidad; comparar profundamente perfil publico, tecnicas, comentarios, indice, planes y usuario control antes/despues de cada operacion.','En cada credencial nueva abrir sesion Chromium independiente, exportar copia JSON y PDF real, inspeccionar HTML y consola sin persistir valores secretos.');
  r.finish('APROBADO','Cambio y reset conservan profundamente datos de entrenamiento y rol; credenciales antiguas revocadas. Contraseñas, hashes y tokens conocidos ausentes de UI, copias, consola y texto PDF tras ambas operaciones.','Logs comprobados: consola del cliente. No se descargan logs internos Cloudflare; comandos de password ejecutados mediante API autorizada local, formularios se cubren en PWD01/03.');
 }finally{await context?.close();await a.close();}
});
