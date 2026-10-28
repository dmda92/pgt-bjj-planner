import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect} from '@playwright/test';
import {campaign} from './case-test.mjs';
const exactDEV='https://pgt-github-probe-dev.david-dzm5.workers.dev';
export async function createAccessWorld(browser){
 const config=JSON.parse(readFileSync('.qa/credentials.local.json','utf8'));if(config.baseURL!==exactDEV)throw Error('DEV URL guard failed');
 const path=resolve(campaign,'access-users.private.json');
 const state=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{users:{},created:[],network:[]};
 const persist=()=>{writeFileSync(path,JSON.stringify(state,null,2));writeFileSync(resolve(campaign,'access-users.json'),JSON.stringify(Object.fromEntries(Object.entries(state.users).map(([k,v])=>[k,{mail:v.mail,nombre:v.nombre,apellidos:v.apellidos,role:'alumno'}])),null,2));};
 const world={state,baseURL:exactDEV,contexts:[],persist,
  user(role,password){if(!state.users[role]){state.users[role]={mail:`qa-access-${Date.now()}-${role.toLowerCase()}@example.test`,password:password||'QA-'+crypto.randomUUID(),nombre:'QA Access '+role,apellidos:'Campaign 20261026'};persist();}return state.users[role];},
  async session(viewport={width:1440,height:1000}){const context=await browser.newContext({viewport});world.contexts.push(context);const page=await context.newPage();page.on('dialog',d=>d.accept());page.on('response',response=>{const url=new URL(response.url());if(url.origin===exactDEV&&url.pathname.startsWith('/api/')){state.network.push({method:response.request().method(),path:url.pathname,status:response.status(),time:new Date().toISOString()});persist();}});await page.goto(exactDEV);return{context,page};},
  async submit(page,kind){for(let attempt=0;attempt<3;attempt++){const pending=page.waitForResponse(r=>r.url()===exactDEV+'/api/v2/auth/'+kind&&r.request().method()==='POST');await page.getByRole('button',{name:kind==='register'?'Crear cuenta de alumno':'Entrar',exact:true}).click();const response=await pending;if(response.status()!==429)return response;const seconds=Number(response.headers()['retry-after']);if(!Number.isFinite(seconds)||seconds<1||seconds>120)throw Error('QA rate limit missing bounded Retry-After');await new Promise(resolve=>setTimeout(resolve,seconds*1000));}throw Error('QA rate limit persisted after bounded retries');},
  async register(page,role,password){const user=world.user(role,password);await page.getByRole('button',{name:'Registrarme',exact:true}).click();for(const[label,value]of[['Correo',user.mail],['Nombre',user.nombre],['Apellidos',user.apellidos],['Contrase\u00f1a',user.password],['Repetir contrase\u00f1a',user.password]])await page.getByLabel(label,{exact:true}).fill(value);const response=await world.submit(page,'register');expect(response.status()).toBe(201);const safe=await response.json();expect(JSON.stringify(safe).includes(user.password)).toBe(false);expect(safe.profile).not.toHaveProperty('pwd');await page.getByRole('heading',{name:'Tu repertorio'}).waitFor();await page.locator('.sync-success').waitFor();if(!state.created.includes(user.mail))state.created.push(user.mail);persist();return user;},
  async login(page,user,mail=user.mail,password=user.password){await page.getByLabel('Correo',{exact:true}).fill(mail);await page.getByLabel('Contrase\u00f1a',{exact:true}).fill(password);const response=await world.submit(page,'login');return response;},
  async snapshot(page){return page.evaluate(async()=>{const i=JSON.parse(localStorage.getItem('pgt-session'));const r=await fetch('/api/v2/users/'+encodeURIComponent(i.mail)+'/snapshot?known=%7B%7D',{headers:{Authorization:'Bearer '+i.token}});return{status:r.status,data:await r.json()};});},
  async logout(page){await page.getByRole('button',{name:'Salir',exact:true}).click();await page.getByRole('button',{name:'Entrar',exact:true}).waitFor();},
  async close(){for(const c of world.contexts)await c.close();}
 };return world;
}
