import {test,expect} from '@playwright/test';
import {createLocalAcademy} from '../playwright/helpers/local-academy.mjs';
import {editor,userPath,heldCommand,uiSession} from '../playwright/helpers/fault-contracts.mjs';

test('CON04: resolving one conflicting technique retains another independent local description', async ({browser},info) => {
 const a=await createLocalAcademy();let one,two;
 try {
  const u=await a.register('con04granular');one=await uiSession(browser,a,u);two=await uiSession(browser,a,u);
  const initial=await a.call(userPath(u),undefined,u.token),techniques=initial.data.positions.flatMap(p=>p.tecnicas);
  const firstId=techniques[0].id,secondId=techniques[1].id;
  await editor(one.page);await editor(two.page);
  const second=one.page.locator('[id="technique-'+secondId+'"]');
  await second.evaluate(e=>e.closest('details').open=true);
  const field=(page,id)=>page.locator('[id="technique-'+id+'"]').getByLabel('Descripción de técnica o enlace de vídeo');
  const hold=await heldCommand(one.page);
  await field(one.page,firstId).fill('Local conflicting description');await hold.hit;
  await field(one.page,secondId).fill('Independent local description');
  await field(two.page,firstId).fill('Remote conflicting description');
  await expect.poll(async()=>(await a.call(userPath(u),undefined,u.token)).data.positions.flatMap(p=>p.tecnicas).find(t=>t.id===firstId).descripcion_del_alumno).toBe('Remote conflicting description');
  hold.release();await one.page.getByRole('button',{name:'Reintentar guardado',exact:true}).waitFor();
  await one.page.getByRole('button',{name:'Revisar versión actual',exact:true}).click();
  // The review keeps compatible edits before and after choosing the other value.
  await expect(field(one.page,secondId)).toHaveValue('Independent local description');
  const save=one.page.getByRole('button',{name:'Guardar resolución',exact:true});
  await expect(save).toBeDisabled();
  await one.page.getByRole('button',{name:'Usar versión remota',exact:true}).click();
  await expect(save).toBeEnabled();await save.click();
  const read=async()=> (await a.call(userPath(u),undefined,u.token)).data.positions.flatMap(p=>p.tecnicas);
  await expect.poll(async()=>{
   const data=await read();return[firstId,secondId].map(id=>data.find(t=>t.id===id).descripcion_del_alumno);
  }).toEqual(['Remote conflicting description','Independent local description']);
  await one.page.locator('.sync-success').waitFor();
  for(const session of [one,two]){
   await session.page.reload();await session.page.getByRole('heading',{name:'Tu repertorio'}).waitFor();
   await session.page.locator('.sync-success').waitFor();
   for(const id of [firstId,secondId])await session.page.locator('[id="technique-'+id+'"]').evaluate(e=>e.closest('details').open=true);
   await expect(field(session.page,firstId)).toHaveValue('Remote conflicting description');
   await expect(field(session.page,secondId)).toHaveValue('Independent local description');
  }
  await info.attach('conflict-contract',{body:JSON.stringify({firstId,secondId,independentLocalPreserved:true,remoteConflictChosen:true,twoBrowserContexts:true,reloadConvergence:true}),contentType:'application/json'});
 } finally {await one?.close();await two?.close();await a.close();}
});
