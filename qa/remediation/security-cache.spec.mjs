import {test, expect} from '@playwright/test';
import {createLocalAcademy} from '../playwright/helpers/local-academy.mjs';
import {build} from 'esbuild';

test('ISO08: trainer HTTP 403 revokes cached pupil views and days before offline reuse', async ({page, context}, info) => {
 const a = await createLocalAcademy();
 try {
  const u = await a.register('iso08-pupil');
  await a.login(page, a.trainer.profile.mail);
  await page.getByRole('button', {name:'Entrenador', exact:true}).click();
  await page.getByRole('button', {name:'Equipo', exact:true}).click();
  await page.locator('.student-card').filter({hasText:u.profile.nombre+' '+u.profile.apellidos}).click();
  await expect(page.locator('.student-detail')).toContainText(u.profile.mail);
  const counts = async (seed = false) => page.evaluate(async seed => {
   const db = await new Promise((resolve,reject) => {const r=indexedDB.open('pgt-active-user-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   const owner=JSON.parse(localStorage.getItem('pgt-session')).mail;
   if(seed) await new Promise((resolve,reject)=>{const t=db.transaction('trainerDays','readwrite');t.objectStore('trainerDays').put({key:JSON.stringify([owner,'2030-01-01']),owner,data:{date:'2030-01-01',groups:[]}});t.oncomplete=resolve;t.onerror=()=>reject(t.error);});
   const count=name=>new Promise(resolve=>{const r=db.transaction(name).objectStore(name).count();r.onsuccess=()=>resolve(r.result);});
   const result={views:await count('trainerViews'),days:await count('trainerDays')};db.close();return result;
  }, seed);
  await expect.poll(async () => (await counts()).views).toBeGreaterThan(0);
  await counts(true);
  await page.route('**/api/v2/users/*/profile',route=>route.fulfill({status:403,contentType:'application/json',body:'{"error":"TRAINER_REQUIRED"}'}));
  const denied=page.waitForResponse(r=>r.url().includes('/profile')&&r.status()===403);
  await page.getByRole('button',{name:'Administración',exact:true}).click();
  await denied;
  await expect.poll(counts).toEqual({views:0,days:0});
  await context.setOffline(true);
  // Denial now retires the rendered selection as well as its cached copy.
  // There is deliberately no stale detail/retry control to reopen offline.
  await expect(page.locator('.student-detail')).toHaveCount(0);
  await expect(page.locator('.student-card')).toHaveCount(0);
  await expect(page.locator('.student-detail textarea')).toHaveCount(0);
  await info.attach('revoked-local-cache',{body:JSON.stringify(await counts()),contentType:'application/json'});
 } finally {await a.close();}
});

test('ISO08: failed cache deletion stays denied after reload and can recover by a fresh login', async ({page,context}, info) => {
 const a=await createLocalAcademy();
 try {
  const pupil=await a.register('iso08-clear-failure');
  const harness=await build({stdin:{contents:`import {FirestoreClient} from './src/application/firestore-client.ts';import {db} from './src/infrastructure/local.ts';import {trainerCache} from './src/application/trainer-cache.ts'; const client=new FirestoreClient();client.connect=async()=>{};window.qa={client,db,trainerCache};`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',define:{'import.meta.env':'{}'}});
  a.overrideAsset('/qa-cache.html','<!doctype html><html><body><script type="module" src="/qa-cache.js"></script></body></html>');a.overrideAsset('/qa-cache.js',harness.outputFiles[0].text);
  await page.goto(a.origin+'/qa-cache.html');await page.waitForFunction(()=>!!window.qa);
  await page.evaluate(async({mail,password,pupil})=>{await window.qa.client.login(mail,password);await window.qa.client.trainerView(pupil,'techniques');window.qa.trainerCache.clear=async()=>{throw Error('Synthetic IndexedDB deletion failure');};},{mail:a.trainer.profile.mail,password:a.password,pupil:pupil.profile.mail});
  await page.route('**/api/v2/training-day?date=*',route=>route.fulfill({status:403,contentType:'application/json',body:'{"error":"TRAINER_REQUIRED"}'}));
  await page.evaluate(async()=>{try{await window.qa.client.trainingDay('2030-01-01');}catch{}});
  expect(await page.evaluate(()=>window.qa.db.trainerViews.count())).toBeGreaterThan(0);
  await page.reload();await page.waitForFunction(()=>!!window.qa);await context.setOffline(true);
  const denied=await page.evaluate(async mail=>{try{await window.qa.client.cachedTrainer(mail,'techniques');return false;}catch{return true;}},pupil.profile.mail);expect(denied).toBe(true);
  await context.setOffline(false);
  await page.evaluate(async({mail,password})=>{await window.qa.client.login(mail,password);},{mail:a.trainer.profile.mail,password:a.password});
  expect(await page.evaluate(()=>window.qa.db.trainerViews.count())).toBe(0);
  await page.evaluate(async mail=>{await window.qa.client.trainerView(mail,'techniques');},pupil.profile.mail);
  expect(await page.evaluate(()=>window.qa.db.trainerViews.count())).toBe(1);
  await info.attach('failed-clear-reload',{body:JSON.stringify({deniedAfterReload:denied,freshLoginRecovered:true}),contentType:'application/json'});
 } finally {await a.close();}
});

for (const {status,crossTab} of [{status:401,crossTab:false},{status:403,crossTab:false},{status:403,crossTab:true}]) test(`ISO08: HTTP ${status} fences a successful older in-flight cache writer${crossTab?' in another tab':''}`, async ({page, context}, info) => {
 const a = await createLocalAcademy(); let release = () => {};
 try {
  const pupil = await a.register('iso08-race');
  // Dedicated test-only asset uses the real client and IndexedDB implementation;
  // it exposes no debug contract in the product bundle or deployed Worker.
  const harness = await build({stdin:{contents:`import {FirestoreClient} from './src/application/firestore-client.ts'; import {db} from './src/infrastructure/local.ts'; const client=new FirestoreClient(); client.connect=async()=>{}; window.qa={client,db,denials:[]}; window.addEventListener('pgt-private-access-denied',e=>window.qa.denials.push(e.detail));`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',define:{'import.meta.env':'{}'}});
  a.overrideAsset('/qa-cache.html','<!doctype html><html><body><script type="module" src="/qa-cache.js"></script></body></html>');
  a.overrideAsset('/qa-cache.js',harness.outputFiles[0].text);
  await page.goto(a.origin+'/qa-cache.html'); await page.waitForFunction(()=>!!window.qa);
  await page.evaluate(async ({mail,password,pupil})=>{
   await window.qa.client.login(mail,password);
   await window.qa.client.trainerView(pupil,'techniques');
   await window.qa.db.trainerDays.put({key:JSON.stringify([mail,'2030-01-01']),owner:mail,data:{date:'2030-01-01',groups:[]}});
  },{mail:a.trainer.profile.mail,password:a.password,pupil:pupil.profile.mail});
  const loader = crossTab ? await context.newPage() : page;
  if(crossTab) {await loader.goto(a.origin+'/qa-cache.html');await loader.waitForFunction(()=>!!window.qa);}
  let entered; const seen=new Promise(r=>entered=r), gate=new Promise(r=>release=r);
  await loader.route('**/api/v2/users/*/comments',async route=>{entered();await gate;await route.continue();},{times:1});
  await loader.evaluate(mail=>{window.qa.pending=window.qa.client.trainerView(mail,'techniques').then(()=>({accepted:true}),e=>({accepted:false,error:e.message}));},pupil.profile.mail);
  await seen;
  await page.route('**/api/v2/training-day?date=*',route=>route.fulfill({status,contentType:'application/json',body:'{"error":"SESSION_REVOKED"}'}));
  const denied=await page.evaluate(async()=>{try{await window.qa.client.trainingDay('2030-01-01');return false;}catch{return true;}});
  expect(denied).toBe(true); release();
  await expect.poll(()=>loader.evaluate(()=>window.qa.denials.length)).toBe(1);
  const pending=await loader.evaluate(()=>window.qa.pending);
  expect(pending.accepted).toBe(false);
  const state=await page.evaluate(async()=>({views:await window.qa.db.trainerViews.count(),days:await window.qa.db.trainerDays.count()}));
  expect(state).toEqual({views:0,days:0});
  await context.setOffline(true);
  const reusable=await page.evaluate(async mail=>{try{return !!await window.qa.client.cachedTrainer(mail,'techniques');}catch{return false;}},pupil.profile.mail);
  expect(reusable).toBe(false);
  await info.attach('denial-during-inflight',{body:JSON.stringify({status,crossTab,pending,state,reusable}),contentType:'application/json'});
 } finally {release();await a.close();}
});
