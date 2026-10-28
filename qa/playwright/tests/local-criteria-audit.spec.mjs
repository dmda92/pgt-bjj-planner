import {spawn,execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {caseTest,expect,campaign} from '../helpers/case-test.mjs';
import {createLocalAcademy} from '../helpers/local-academy.mjs';
import {uiSession,editor,userPath,publicState,operation,exportedCopy,competition} from '../helpers/fault-contracts.mjs';
const options={environment:'Chromium y Worker reales locales; transporte Firestore sintetico; auditoria de criterios completos',users:['Identidades sinteticas nuevas por caso']};

caseTest('BAK 02',options,async({browser},r)=>{
 r.includePrevious();const a=await createLocalAcademy(),u=await a.register('backup-audit'),v=await a.register('backup-control');let s,d2;
 try{
  await competition(a,[u]);s=await uiSession(browser,a,u);const control=await publicState(a,v),before=await publicState(a,u),backup=await exportedCopy(s.page);
  await r.step('Modificar perfil y catalogo, importar copia propia y restaurar desde segundo contexto limpio',async()=>{
   const data=structuredClone(before.techniques.data);data.positions[0].tecnicas[0].descripcion_del_alumno='Changed before backup recovery';
   await a.call('commands/repertoire',operation(data,before.techniques.sha),u.token);
   await a.call('commands/profile',operation({...before.profile.data,nombre:'Changed backup profile'},before.profile.sha),u.token);
   await expect.poll(async()=>(await publicState(a,u)).profile.data.nombre).toBe('Changed backup profile');
   await s.page.reload();await s.page.getByRole('heading',{name:'Tu repertorio'}).waitFor();await s.page.getByRole('button',{name:'Perfil',exact:true}).click();
   const commands=[];s.page.on('request',q=>{if(q.url().includes('/commands/'))commands.push(new URL(q.url()).pathname);});
   await s.page.locator('input[type=file]').setInputFiles({name:'own-copy.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
   await expect.poll(async()=>(await publicState(a,u)).profile.data.nombre).toBe(before.profile.data.nombre);
   await expect.poll(async()=>(await publicState(a,u)).techniques.data.positions).toEqual(before.techniques.data.positions);
   const fields=p=>{const {revision,updatedAt,...rest}=p;return rest;};const after=await publicState(a,u);expect(fields(after.profile.data)).toEqual(fields(before.profile.data));for(const k of ['comments','index'])expect(after[k]).toEqual(before[k]);expect(after.plans.map(p=>p.data.sessions)).toEqual(before.plans.map(p=>p.data.sessions));
   d2=await uiSession(browser,a,u);const copy2=await exportedCopy(d2.page);expect(copy2.entries.find(e=>e.key==='profile').data).toEqual(after.profile.data);expect(copy2.entries.find(e=>e.key==='techniques').data.positions).toEqual(before.techniques.data.positions);
   expect(commands.every(p=>/commands\/(profile|repertoire)$/.test(p))).toBe(true);expect(await publicState(a,v)).toEqual(control);
   await r.capture(d2.page,'restored-second-context');await r.json('backup-profile-catalogue-matrix',{profileRestored:true,catalogueDeepRestored:true,uuidAndOrderPreserved:true,secondContextCompared:true,remoteAuthoritiesDeepUnchanged:true,controlDeepUnchanged:true,commands});
  });
  r.finish('APROBADO','Copia propia restaura campos de perfil y catalogo modificados, incluidos UUID/orden/textos; segundo contexto limpio exporta ambos identicos. Comentarios, indice, sesiones de planes y cuenta control permanecen profundamente iguales. Solo comandos de campos importables.','Metadatos revision/updatedAt avanzan por los guardados CAS; no se restablecen artificialmente a versiones antiguas. Modelo online vigente sin cola offline. Todo local sintetico, sin afirmar Firestore Google.');
 }finally{await s?.close();await d2?.close();await a.close();}
});

caseTest('SEC 05',options,async({},r)=>{
 r.includePrevious();const a=await createLocalAcademy(),u=await a.register('cors-audit'),checks=[];
 try{
  await r.step('Ejecutar OPTIONS y peticiones reales login/snapshot desde cuatro origenes, antes y despues de logout',async()=>{
   const dispatch=async(url,init)=>{try{return await a.runtime.dispatchFetch(url,init);}catch(error){if(error.message!=='fetch failed')throw error;return a.runtime.dispatchFetch(url,init);}};
   for(const afterLogout of [false,true]){
    if(afterLogout)await a.call('auth/logout',{},u.token);
    for(const origin of ['https://synthetic.test','https://synthetic.test.evil.test','https://sub.synthetic.test','https://evil.test']){
     const allowed=origin==='https://synthetic.test';
     for(const endpoint of ['auth/login','users/'+encodeURIComponent(u.profile.mail)+'/snapshot']){
      const login=endpoint==='auth/login',url='https://local/api/v2/'+endpoint;
      const preflight=await dispatch(url,{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':login?'POST':'GET'}});await preflight.arrayBuffer();
      expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(allowed?origin:null);
      const response=await dispatch(url,{method:login?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',...(login?{}:{Authorization:'Bearer '+u.token})},...(login?{body:JSON.stringify({mail:u.profile.mail,password:a.password})}:{})});const text=await response.text();
      expect(response.status).toBe(allowed?(login?200:afterLogout?401:200):403);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(allowed?origin:null);
      if(!allowed){expect(text).not.toContain(u.profile.mail);expect(text).not.toContain(a.password);expect(text).not.toContain(u.token);}
      checks.push({afterLogout,origin,endpoint:login?'auth/login':'own snapshot',preflightStatus:preflight.status,status:response.status,allowOrigin:response.headers.get('Access-Control-Allow-Origin')});
     }
    }
   }
   await r.json('cors-real-request-matrix',checks);
  });
  r.finish('APROBADO','OPTIONS y peticiones reales POST login/GET snapshot comprobadas para origen exacto, host parecido, subdominio y host hostil; matriz repetida tras logout. Origen hostil403 sin datos, sin wildcard; token revocado401 desde origen permitido.','Origenes configurados solo en Worker sintetico local. No cambia CORS remoto ni prueba configuracion Google. Respuestas de autenticacion no se guardan en evidencias.');
 }finally{await a.close();}
});

caseTest('PWD 01',options,async({browser},r)=>{
 r.includePrevious();const a=await createLocalAcademy(),u=await a.register('password-two-sessions'),v=await a.register('password-control'),sessions=[];const password='QA-'+crypto.randomUUID();
 try{
  const d1=await uiSession(browser,a,u),d2=await uiSession(browser,a,u);sessions.push(d1,d2);const oldTokens=await Promise.all([d1,d2].map(s=>s.page.evaluate(()=>JSON.parse(localStorage.getItem('pgt-session')).token)));expect(new Set(oldTokens).size).toBe(2);
  const before=await publicState(a,u),control=await publicState(a,v),privateBefore=await a.store.read({kind:'profile',id:u.profile.mail});
  await r.step('Cambiar contrasena por formulario y rechazar ambas sesiones previas y credencial antigua',async()=>{
   await d1.page.getByRole('button',{name:'Perfil',exact:true}).click();const form=d1.page.locator('.password-form');await form.getByLabel('Contraseña nueva',{exact:true}).fill(password);await form.getByLabel('Repetir contraseña',{exact:true}).fill(password);
   const saved=d1.page.waitForResponse(q=>q.url().endsWith('/commands/password'));await form.getByRole('button',{name:'Confirmar cambio remoto',exact:true}).click();expect((await saved).status()).toBe(200);
   const checks=[];for(const [i,token]of oldTokens.entries())for(const write of [false,true]){const x=await a.response(write?'commands/repertoire':userPath(u),write?operation(before.techniques.data,before.techniques.sha):undefined,token);expect(x.status).toBe(401);checks.push({session:i+1,kind:write?'write':'read',status:x.status});}
   expect((await a.response('auth/login',{mail:u.profile.mail,password:a.password})).status).toBe(401);
   const context=await browser.newContext(),page=await context.newPage();sessions.push({close:()=>context.close()});await a.login(page,u.profile.mail,password);await r.capture(page,'new-credential-clean-context');const auth=await a.call('auth/login',{mail:u.profile.mail,password});u.token=auth.token;
   const after=await publicState(a,u),privateAfter=await a.store.read({kind:'profile',id:u.profile.mail});expect(after.profile.data).toEqual(before.profile.data);for(const k of ['techniques','comments','index','plans'])expect(after[k]).toEqual(before[k]);expect(await publicState(a,v)).toEqual(control);
   const publicFields=p=>{const {pwd,sessionEpoch,...rest}=p;return rest;};expect(publicFields(privateAfter.data)).toEqual(publicFields(privateBefore.data));expect(privateAfter.data.pwd).toMatch(/^pbkdf2-sha256\$/);expect(privateAfter.data.pwd).not.toBe(privateBefore.data.pwd);expect(privateAfter.data.sessionEpoch).not.toBe(privateBefore.data.sessionEpoch);
   await r.json('two-session-revocation',{checks,oldCredentialRejected:true,newCredentialCleanLogin:true,saltedHashChanged:true,serverRevocationEpochRotated:true,publicProfileAndBusinessDeepEqual:true,controlDeepEqual:true,secretValuesRecorded:false});
  });
  r.finish('APROBADO','Cambio por formulario revoca lecturas y escrituras de dos sesiones independientes previas. Credencial antigua rechazada; nueva funciona desde contexto limpio. Hash con sal y epoch servidor cambian; perfil publico y negocio/control permanecen identicos.','El epoch server-owned es metadato de revocacion autorizado por la remediacion, adicional al hash; no cambio de datos de negocio. Worker/Firestore sinteticos, no Google.');
 }finally{for(const s of sessions)await s.close();await a.close();}
});

// A dedicated Node parent owns this Chromium process tree and its unique profile.
// Killing that child simulates a crash without touching the user's browsers.
const crashChild=`import {chromium} from 'playwright';process.on('message',async cfg=>{try{let context=await chromium.launchPersistentContext(cfg.profile,{headless:true,serviceWorkers:'block'}),page=context.pages()[0]||await context.newPage();await page.goto(cfg.origin);await page.getByLabel('Correo',{exact:true}).fill(cfg.mail);await page.getByLabel('Contraseña',{exact:true}).fill(cfg.password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.getByRole('heading',{name:'Tu repertorio'}).waitFor();await page.locator('.sync-success').waitFor();await context.close();context=await chromium.launchPersistentContext(cfg.profile,{headless:true,serviceWorkers:'block'});page=context.pages()[0]||await context.newPage();await page.goto(cfg.origin);await page.getByRole('heading',{name:'Tu repertorio'}).waitFor();await page.locator('details.repertoire-position').first().locator('summary').click();if(cfg.mode==='before')await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='drafts')throw new DOMException('QA before durable draft','QuotaExceededError');return put.apply(this,args);};});await page.route('**/api/v2/commands/repertoire',route=>route.fulfill({status:500,contentType:'application/json',body:'{"error":"QA_CRASH_DRAFT"}'}));await page.getByLabel('Descripción de técnica o enlace de vídeo').first().fill(cfg.text);await page.getByRole('button',{name:'Reintentar guardado',exact:true}).waitFor();const rows=await page.evaluate(()=>new Promise((ok,no)=>{const q=indexedDB.open('pgt-active-user-v1');q.onsuccess=()=>{const db=q.result,r=db.transaction('drafts').objectStore('drafts').getAll();r.onsuccess=()=>{db.close();ok(r.result);};r.onerror=()=>no(r.error);};q.onerror=()=>no(q.error);}));if(cfg.mode==='after'&&!rows.some(r=>JSON.stringify(r.data).includes(cfg.text)))throw Error('No durable journal before crash');if(cfg.mode==='before'&&rows.length)throw Error('Unexpected durable journal before failed persistence');const body=await page.locator('body').innerText();if(cfg.mode==='before'&&await page.locator('.sync-success').count())throw Error('False success before durable persistence');process.send({ready:true,mode:cfg.mode,durableDrafts:rows.length,persistenceFailureVisible:cfg.mode==='before'&&/IndexedDB|almacen|cuota|persist/i.test(body),noFalseSuccess:!await page.locator('.sync-success').count()});}catch(e){process.send({error:e.message});}});`;
caseTest('OFF 06',options,async({playwright},r)=>{
 r.includePrevious();const a=await createLocalAcademy();const matrix=[];let child,context;
 try{
  for(const mode of ['before','after'])await r.step('Interrumpir proceso '+mode+' persistencia local y reabrir perfil real',async()=>{
   const u=await a.register('crash-'+mode),before=await publicState(a,u),text='Crash draft '+mode+' '+crypto.randomUUID(),profile=resolve(campaign,'profiles','crash-audit-'+mode+'-'+Date.now());
   child=spawn(process.execPath,['--input-type=module','-e',crashChild],{cwd:process.cwd(),stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});let stderr='';child.stderr.on('data',b=>stderr+=b.toString());
   const ready=new Promise((ok,no)=>{child.once('message',m=>m.error?no(Error(m.error)):ok(m));child.once('error',no);child.once('exit',code=>{if(code)no(Error('QA browser child exited '+code));});});child.send({profile,origin:a.origin,mail:u.profile.mail,password:a.password,text,mode});const proof=await ready;
   const pid=child.pid;expect(Number.isInteger(pid)&&pid>0).toBe(true);execFileSync('taskkill',['/pid',String(pid),'/T','/F'],{windowsHide:true,stdio:'pipe'});child=undefined;
   context=await playwright.chromium.launchPersistentContext(profile,{headless:true,serviceWorkers:'block'});const page=context.pages()[0]||await context.newPage();let automaticCommands=0;page.on('request',q=>{if(q.url().includes('/commands/'))automaticCommands++;});await page.goto(a.origin);await page.getByRole('heading',{name:'Tu repertorio'}).or(page.getByRole('button',{name:'Entrar',exact:true})).first().waitFor();const freshLoginRequired=await page.getByRole('button',{name:'Entrar',exact:true}).isVisible();if(freshLoginRequired)await a.login(page,u.profile.mail);await page.getByRole('heading',{name:'Tu repertorio'}).waitFor();
   if(mode==='after'){
    let field=await editor(page);if(await field.inputValue()!==text){await page.getByRole('button',{name:'Perfil',exact:true}).click();await page.getByRole('button',{name:'Recuperar borrador de técnicas',exact:true}).click();await page.getByRole('button',{name:'Mis técnicas',exact:true}).click();field=await editor(page);}
    await expect(field).toHaveValue(text);await expect(page.getByRole('button',{name:'Reintentar guardado',exact:true})).toBeVisible();expect(automaticCommands).toBe(0);expect(await publicState(a,u)).toEqual(before);
    await page.getByRole('button',{name:'Reintentar guardado',exact:true}).click();await page.locator('.sync-success').waitFor();expect((await a.call(userPath(u),undefined,u.token)).data.positions[0].tecnicas[0].descripcion_del_alumno).toBe(text);
   }else{expect(await publicState(a,u)).toEqual(before);await expect(await editor(page)).toHaveValue(before.techniques.data.positions[0].tecnicas[0].descripcion_del_alumno);expect(automaticCommands).toBe(0);}
   await r.capture(page,'actual-profile-reopened-'+mode);matrix.push({...proof,processTreeKilled:true,actualProfileReopened:true,freshLoginRequired,automaticCommandsBeforeRecovery:0,unconfirmedVolatileLossExpected:mode==='before',durableDraftRecoveredAndRetried:mode==='after'});await context.close();context=undefined;
  });
  await r.json('crash-persistence-boundaries',matrix);r.finish('APROBADO','Dos procesos Chromium propios interrumpidos realmente: antes de persistir con fallo IndexedDB inyectado y sin exito verde conserva remoto confirmado; despues de journal durable, reapertura del mismo perfil recupera texto completo y solo reintento explicito lo confirma. Cero subida automatica y ninguna mezcla de versiones.','Cierre abrupto real en Windows PC con perfiles propios, no dispositivo fisico movil. La variante anterior al guardado fuerza fallo IndexedDB: el texto solo volatil se pierde tras kill sin promesa de recuperacion durable. Firestore sintetico local.');
 }finally{if(child?.pid)try{execFileSync('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'pipe'});}catch{}await context?.close();await a.close();}
});

caseTest('OFF 05',options,async({browser},r)=>{
 r.includePrevious();const a=await createLocalAcademy(),u=await a.register('offline-pdf-audit');let s;
 try{
  const source=await a.call(userPath(u),undefined,u.token),data=structuredClone(source.data);let n=0;for(const p of data.positions)for(const t of p.tecnicas)t.descripcion_del_alumno='Texto PDF completo '+(++n)+' con enlace https://example.test/qa/'+n;
  await a.call('commands/repertoire',operation(data,source.version),u.token);const c=await competition(a,[u],{days:20,exercises:5}),plan=(await a.call(userPath(u,'plans/'+c.planId),undefined,u.token)).data;
  s=await uiSession(browser,a,u);await s.page.getByRole('button',{name:/Mis planes/}).click();await s.page.getByLabel('Mi plan',{exact:true}).selectOption(c.planId);await s.page.locator('.plan-card').waitFor();await s.page.evaluate(()=>navigator.serviceWorker.ready);const before=await publicState(a,u);
  await r.step('Primera exportacion sin red: comparar todas las sesiones/textos y fuentes/logo embebidos',async()=>{
   let apiRequests=0,externalRequests=0;const origin=new URL(a.origin).origin;s.page.on('request',q=>{if(q.url().includes('/api/'))apiRequests++;if(/^https?:/.test(q.url())&&new URL(q.url()).origin!==origin)externalRequests++;});
   await s.context.setOffline(true);const pending=s.page.waitForEvent('download');await s.page.getByRole('button',{name:'Exportar PDF',exact:true}).click();const download=await pending,path=resolve(r.dir,'first-export-complete-offline.pdf');await download.saveAs(path);r.result.evidence.push(path);
   const script=`import sys,json,hashlib;sys.path.insert(0,'.qa/python-deps');from pypdf import PdfReader
doc=PdfReader(sys.argv[1]);fonts=[];images=[];texts=[]
for p in doc.pages:
 texts.append(p.extract_text() or '')
 resources=p.get('/Resources',{}).get_object()
 for ref in resources.get('/XObject',{}).get_object().values():
  obj=ref.get_object()
  if obj.get('/Subtype')=='/Image':images.append({'sha256':hashlib.sha256(obj.get_data()).hexdigest(),'width':obj.get('/Width'),'height':obj.get('/Height')})
 for ref in resources.get('/Font',{}).get_object().values():
  font=ref.get_object();parts=font.get('/DescendantFonts',[font])
  for part in parts:
   obj=part.get_object();descriptor=obj.get('/FontDescriptor');descriptor=descriptor.get_object() if descriptor else {};stream=descriptor.get('/FontFile2') or descriptor.get('/FontFile3') or descriptor.get('/FontFile');data=stream.get_object().get_data() if stream else b'';fonts.append({'name':str(obj.get('/BaseFont','')),'embeddedBytes':len(data),'regularName':b'Regular' in data or 'Regular'.encode('utf-16-be') in data,'semiBoldName':b'SemiBold' in data or 'SemiBold'.encode('utf-16-be') in data})
print(json.dumps({'pages':len(doc.pages),'text':'\\n'.join(texts),'fonts':fonts,'images':images},ensure_ascii=True))`;
   const pdf=JSON.parse(execFileSync('python',['-c',script,path],{encoding:'utf8'})),compact=x=>x.replace(/\s/g,'');const text=compact(pdf.text);
   expect(pdf.pages).toBeGreaterThan(1);for(const session of plan.sessions){expect(text).toContain(session.date.split('-').reverse().join('/'));for(const e of session.exercises)for(const value of [e.posicion,e.tipo,e.descripcion_del_alumno,e.comment||''])if(value)expect(text).toContain(compact(value));}
   const logoHash=createHash('sha256').update(readFileSync('public/logo-pgt.jpg')).digest('hex');expect(pdf.images.some(image=>image.sha256===logoHash)).toBe(true);expect(pdf.fonts.some(font=>/Barlow/i.test(font.name)&&font.regularName&&!font.semiBoldName&&font.embeddedBytes>1000)).toBe(true);expect(pdf.fonts.some(font=>/Barlow/i.test(font.name)&&font.semiBoldName&&font.embeddedBytes>1000)).toBe(true);
   expect(apiRequests).toBe(0);expect(externalRequests).toBe(0);await s.context.setOffline(false);expect(await publicState(a,u)).toEqual(before);await r.capture(s.page,'complete-offline-pdf-plan');await r.json('offline-pdf-integrity',{firstExportOfThisPlan:true,sessionCount:plan.sessions.length,everySavedTextAndSessionDateFound:true,pdfPages:pdf.pages,fonts:pdf.fonts,images:pdf.images,officialLogoSHA256:logoHash,apiRequests,externalRequests,snapshotDeepUnchanged:true});
  });
  r.finish('APROBADO','Primera exportacion del plan realizada totalmente offline: PDF multipagina contiene fechas de todas las sesiones y todos los textos guardados, fuentes Barlow Regular/SemiBold embebidas y JPEG del logo oficial con SHA256 exacto. Cero peticiones API/CDN; snapshot completo permanece identico.','Chromium escritorio y Worker/Firestore sinteticos locales. No acredita visor PDF Android ni dispositivo fisico.');
 }finally{await s?.context.setOffline(false);await s?.close();await a.close();}
});
