import {files,api,server,origin} from './qa-recovery-fixture.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const password='synthetic-notification-password';
async function call(path,method='GET',body,token='') {
 const req=new Request(origin+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const res=await api.handle(req,new URL(req.url));assert.ok(res.ok,`${method} ${path}: ${res.status}`);return res.json();
}
async function register(mail){return (await call('/api/app/register','POST',{mail,password,confirm:password,nombre:mail.split('@')[0],apellidos:'Fixture'})).token;}
const teacher='notification-trainer@example.com',pupil='notification-pupil@example.com',other='notification-other@example.com';
const trainerToken=await register(teacher);files.get(`PGT/users_data/${teacher}/user_data.json`).data.perfil='entrenador';await register(pupil);await register(other);
const techniques=files.get(`PGT/users_data/${pupil}/tecnics.json`).data;
const first=techniques.positions[0].tecnicas[0],last=techniques.positions.at(-1).tecnicas.at(-1);
const endpoint=`/api/app/users/${encodeURIComponent(pupil)}/comments`;
async function comments(rows){const old=structuredClone(files.get(`PGT/users_data/${pupil}/trainer_comments.json`));await call(endpoint,'PUT',{sha:old.sha,data:{...old.data,comments:rows}},trainerToken);}
const browser=await chromium.launch({headless:true,executablePath:process.env.PGT_TEST_CHROMIUM_PATH||undefined,args:JSON.parse(process.env.PGT_TEST_CHROMIUM_ARGS||'[]')});
const context=await browser.newContext({viewport:{width:1440,height:950}}),page=await context.newPage();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
async function login(mail){await page.getByLabel('Correo',{exact:true}).fill(mail);await page.getByLabel('Contraseña',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.getByRole('heading',{name:'Tu repertorio'}).waitFor();}
const bell=n=>page.getByRole('button',{name:`Notificaciones, ${n} pendientes`,exact:true});
async function sync(){await page.getByRole('button',{name:'Sincronizar',exact:true}).click();await page.locator('.sync').filter({hasText:'Sincronizado'}).waitFor();}
try {
 await page.goto(origin);await login(pupil);await bell(0).waitFor();
 await comments([{techniqueId:first.id,comment:'Ajusta el agarre superior'},{techniqueId:last.id,comment:'Controla primero la cadera'}]);await sync();await bell(2).waitFor();
 await page.reload();await bell(2).waitFor();await sync();await bell(2).waitFor();
 await page.getByLabel('Buscar posiciones').fill('ninguna posición coincide');await page.getByRole('button',{name:/^Mis planes/}).click();await bell(2).click();
 assert.equal(await page.locator('.notification-panel li').count(),2);
 await page.getByRole('button').filter({hasText:'Controla primero la cadera'}).click();await bell(1).waitFor();
 const target=page.locator(`[id="technique-${last.id}"]`);await target.waitFor();assert.equal(await target.evaluate(el=>el.closest('details').open),true);await target.evaluate(el=>{if(document.activeElement!==el)throw Error('Notification target not focused');});
 assert.equal(await page.getByLabel('Buscar posiciones').inputValue(),'');assert.match(await target.innerText(),/notification-trainer Fixture: Controla primero la cadera/);
 await context.setOffline(true);await page.reload();await bell(1).waitFor();assert.match(await page.locator(`[id="technique-${last.id}"]`).textContent(),/notification-trainer Fixture: Controla primero la cadera/);await bell(1).click();await page.getByRole('button').filter({hasText:'Ajusta el agarre superior'}).click();await bell(0).waitFor();
 await context.setOffline(false);await sync();await bell(0).waitFor();
 await comments([{techniqueId:first.id,comment:'Ajusta el agarre superior'},{techniqueId:last.id,comment:'Nuevo detalle de cadera'}]);await sync();await bell(1).waitFor();await bell(1).click();assert.equal(await page.locator('.notification-panel li').count(),1);
 await fs.mkdir('.browser-artifacts/notifications',{recursive:true});
 await page.screenshot({path:'.browser-artifacts/notifications/desktop.png',fullPage:false});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'.browser-artifacts/notifications/mobile.png',fullPage:false});
 await page.getByRole('button',{name:'Cerrar notificaciones'}).click();await page.getByRole('button',{name:'Salir',exact:true}).click();await login(other);await bell(0).waitFor();await page.getByRole('button',{name:'Salir',exact:true}).click();await login(pupil);await bell(1).waitFor();
 await comments([]);await sync();await bell(0).waitFor();await bell(0).click();await page.getByText('No tienes notificaciones pendientes.').waitFor();await page.keyboard.press('Escape');assert.equal(await page.locator('.notification-panel').count(),0);
 assert.deepEqual(errors,[]);console.log('Comment notifications Chromium: per-technique updates, sync deduplication, reload/offline read persistence, target navigation/focus, deletion, account isolation and 390px/desktop PASS.');
} finally {await browser.close();server.close();}
