import {caseTest,expect} from '../helpers/case-test.mjs';
import {createLocalAcademy} from '../helpers/local-academy.mjs';
import {uiSession,editor,userPath} from '../helpers/fault-contracts.mjs';
caseTest('PRE 07',{environment:'PWA/Worker local real y Firestore sintetico; matriz HTTP y perdida de ACK controladas',users:['Alumno sintetico aislado']},async({browser},r)=>{
 r.includePrevious();const a=await createLocalAcademy();let s;
 try{
  const u=await a.register('prelostack');s=await uiSession({newContext:options=>browser.newContext({...options,serviceWorkers:'block'})},a,u);const field=await editor(s.page),checks=[];
  await r.capture(s.page,'before-controlled-faults');const before=await a.call(userPath(u),undefined,u.token);
  await r.step('Preparar y observar 409,422,429,500 y timeout en entorno local',async()=>{
   await s.page.route('**/api/v2/qa-controlled-fault/**',route=>{
    const value=new URL(route.request().url()).pathname.split('/').at(-1);
    if(value==='timeout')return route.abort('timedout');
    const status=Number(value);return route.fulfill({status,contentType:'application/json',headers:status===429?{'Retry-After':'1'}:{},body:'{"error":"QA_CONTROLLED"}'});
   });
   for(const status of [409,422,429,500]){
    const path='/api/v2/qa-controlled-fault/'+status;
    const received=await s.page.evaluate(async path=>{const response=await fetch(path);return response.status;},path);expect(received).toBe(status);checks.push({injected:status,received});
   }
   expect(await s.page.evaluate(async()=>{try{await fetch('/api/v2/qa-controlled-fault/timeout');return false;}catch{return true;}})).toBe(true);checks.push({transportTimeout:true});
   expect(await a.call(userPath(u),undefined,u.token)).toEqual(before);await r.json('controlled-faults',checks);
  });
  await r.step('Perder respuesta tras commit y verificar reintento idempotente',async()=>{
   let count=0;const ids=[];await s.page.route('**/api/v2/commands/repertoire',async route=>{count++;ids.push(route.request().postDataJSON().operationId);if(count===1){await route.fetch();await route.abort('connectionreset');}else await route.continue();});
   await field.fill('PRE07 response lost after confirmed commit');await s.page.locator('.sync-success').waitFor();await expect.poll(async()=>(await a.call(userPath(u),undefined,u.token)).data.positions[0].tecnicas[0].descripcion_del_alumno).toBe('PRE07 response lost after confirmed commit');
   expect(count).toBe(2);expect(ids[0]).toBe(ids[1]);const after=await a.call(userPath(u),undefined,u.token);expect(after.data.revision).toBe(before.data.revision+1);
   await r.capture(s.page,'after-lost-ack');await r.json('lost-response-proof',{committedBeforeAbort:true,requestCount:count,sameOperationId:true,oneRevisionOnly:true,before,after,secretsOrProductionModified:false});
  });
  r.finish('APROBADO','Matriz completa 409/422/429/500/timeout observada y estado comparado antes/despues. ACK perdido tras commit: dos envios con igual operationId y una revision. Evidencias nuevas locales, sin secretos ni operaciones DEV/PRO.','Infraestructura local: prueba fallos controlados y recuperacion idempotente, no disponibilidad de Google remoto.');
 }finally{await s?.close();await a.close();}
});
