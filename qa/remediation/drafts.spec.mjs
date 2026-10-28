import {test, expect} from '@playwright/test';
import {createLocalAcademy} from '../playwright/helpers/local-academy.mjs';
import {editor, userPath} from '../playwright/helpers/fault-contracts.mjs';
import {readFileSync} from 'node:fs';

for (const id of ['SYN06', 'SYN11', 'PWD07']) {
 test(`${id}: failed online draft survives reload and identity boundary without automatic upload`, async ({page, context}, info) => {
  const a = await createLocalAcademy();
  try {
   const u = await a.register(id.toLowerCase()), other = await a.register('other');
   await a.login(page, u.profile.mail);
   await page.route('**/api/v2/commands/repertoire', route => route.fulfill({status:500,contentType:'application/json',body:'{"error":"SYNTHETIC_FAILURE"}'}));
   const text = `${id} retained private text`;
   await (await editor(page)).fill(text);
   await page.getByRole('button',{name:'Reintentar guardado',exact:true}).waitFor();
   const before = await a.call(userPath(u),undefined,u.token);
   await page.unroute('**/api/v2/commands/repertoire');
   let automaticWrites=0;
   page.on('request',r=>{if(r.url().endsWith('/commands/repertoire')) automaticWrites++;});
   if(id==='SYN11') {
    await context.setOffline(true); await context.setOffline(false);
    await expect(page.getByRole('button',{name:'Reintentar guardado',exact:true})).toBeVisible();
   }
   if (id === 'PWD07') {
    const p = await a.call(userPath(u,'profile'),undefined,a.trainer.token);
    await a.call('commands/password',{mail:u.profile.mail,password:'Replacement-password-2026',confirm:'Replacement-password-2026',expected:p.version,operationId:crypto.randomUUID()},a.trainer.token);
    await expect(page.getByRole('button',{name:'Entrar',exact:true})).toBeVisible();
    await a.login(page,u.profile.mail,'Replacement-password-2026');
   } else if (id === 'ISO02') {
    await page.getByRole('button',{name:'Salir',exact:true}).click();
    await a.login(page,other.profile.mail);
    await expect(await editor(page)).not.toHaveValue(text);
    await page.getByRole('button',{name:'Salir',exact:true}).click();
    await a.login(page,u.profile.mail);
   } else await page.reload();
   await expect(await editor(page)).toHaveValue(text);
   await expect(page.getByRole('button',{name:'Reintentar guardado',exact:true})).toBeVisible();
   expect(automaticWrites).toBe(0);
   if (id !== 'PWD07') expect((await a.call(userPath(u),undefined,u.token)).data).toEqual(before.data);
   await page.getByRole('button',{name:'Reintentar guardado',exact:true}).click();
   await page.locator('.sync-success').waitFor();
   const auth=id==='PWD07'?await a.call('auth/login',{mail:u.profile.mail,password:'Replacement-password-2026'}):u;
   expect((await a.call(userPath(u),undefined,auth.token)).data.positions[0].tecnicas[0].descripcion_del_alumno).toBe(text);
   await info.attach('identity-and-draft',{body:JSON.stringify({case:id,restored:true,remoteUnchanged:true}),contentType:'application/json'});
  } finally {await a.close();}
 });
}

test('ISO02: account switch is blocked until failed private draft is explicitly resolved', async ({page})=>{
 const a=await createLocalAcademy();
 try{
  const u=await a.register('iso02'),v=await a.register('iso02-other');await a.login(page,u.profile.mail);
  await page.route('**/api/v2/commands/repertoire',r=>r.fulfill({status:500,contentType:'application/json',body:'{"error":"SYNTHETIC_FAILURE"}'}));
  await(await editor(page)).fill('Private draft blocks account switch');await page.getByRole('button',{name:'Reintentar guardado',exact:true}).waitFor();
  await page.getByRole('button',{name:'Salir',exact:true}).click();
  await expect(page.getByRole('button',{name:'Entrar',exact:true})).toHaveCount(0);
  await expect(page.locator('[role=alert]').filter({hasText:/borrador/}).first()).toBeVisible();
  await page.unroute('**/api/v2/commands/repertoire');await page.getByRole('button',{name:'Reintentar guardado',exact:true}).click();
  await page.locator('.sync-success').waitFor();await page.getByRole('button',{name:'Salir',exact:true}).click();await a.login(page,v.profile.mail);
  await expect(await editor(page)).not.toHaveValue('Private draft blocks account switch');
 }finally{await a.close();}
});

test('PWA06: service worker update retains failed draft without replay', async ({page},info)=>{
 const a=await createLocalAcademy();
 try {
  const u=await a.register('pwa06');await a.login(page,u.profile.mail);
  await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await page.locator('.sync-success').waitFor();
  await page.route('**/api/v2/commands/repertoire',route=>route.fulfill({status:500,contentType:'application/json',body:'{"error":"SYNTHETIC_FAILURE"}'}));
  await(await editor(page)).fill('Draft survives actual SW update');await page.getByRole('button',{name:'Reintentar guardado',exact:true}).waitFor();
  const source=readFileSync('dist/sw.js','utf8'),version='pgt-app-remediation-'+Date.now();
  a.overrideAsset('/sw.js',source.replace(/const CACHE = [^;]+;/,`const CACHE = "${version}";`));
  await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();});
  const update=page.getByRole('button',{name:'Actualizar aplicación',exact:true});await update.waitFor({timeout:60000});
  await Promise.all([page.waitForEvent('load'),update.click()]);
  await expect(await editor(page)).toHaveValue('Draft survives actual SW update');
  await expect(page.getByRole('button',{name:'Reintentar guardado',exact:true})).toBeVisible();
 }finally{await a.close();}
});

test('ISO02: changed-tab identity cannot bypass pending-owner guard before another login',async({page})=>{
 const a=await createLocalAcademy();
 try{
  const u=await a.register('iso02-broadcast'),v=await a.register('iso02-new');await a.login(page,u.profile.mail);
  await page.route('**/api/v2/commands/repertoire',r=>r.fulfill({status:500,contentType:'application/json',body:'{"error":"SYNTHETIC_FAILURE"}'}));
  await(await editor(page)).fill('Pending before identity broadcast');await page.getByRole('button',{name:'Reintentar guardado',exact:true}).waitFor();
  await page.evaluate(()=>{const c=new BroadcastChannel('pgt-session');c.postMessage('session-changed');setTimeout(()=>c.close(),0);});
  await page.getByRole('button',{name:'Entrar',exact:true}).waitFor();
  let loginRequests=0;page.on('request',r=>{if(r.url().endsWith('/auth/login'))loginRequests++;});
  await page.getByLabel('Correo',{exact:true}).fill(v.profile.mail);await page.getByLabel('Contraseña',{exact:true}).fill(a.password);
  await page.getByRole('button',{name:'Entrar',exact:true}).click();
  await expect(page.locator('[role=alert]').filter({hasText:/cuenta anterior/})).toBeVisible();expect(loginRequests).toBe(0);
  await page.getByLabel('Correo',{exact:true}).fill(u.profile.mail);await page.getByRole('button',{name:'Entrar',exact:true}).click();
  await expect(await editor(page)).toHaveValue('Pending before identity broadcast');
 }finally{await a.close();}
});
