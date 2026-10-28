import { test } from '@playwright/test';
import { caseTest, expect } from '../helpers/case-test.mjs';
import { getWorld } from '../helpers/remote-world.mjs';
import { ownTech, openPosition, awaitCommand, fillCompetition, plan, datePlus, describe } from '../helpers/remote-actions.mjs';
let w;
test.afterAll(async () => w?.close());
async function world() { w ||= await getWorld(); await w.login('A'); w.users.A2 ||= w.users.A; await w.login('A2','A'); await w.login('T'); return w; }
caseTest('PRE 01', { users: ['T','A','B'], environment: 'DEV real; tres contextos Chromium independientes Windows' }, async ({ browser }, r) => {
    r.includePrevious();
    const contexts = await Promise.all([0,1,2].map(() => browser.newContext()));
    try {
        await r.step('Verificar localStorage, cookies e IndexedDB aislados en tres contextos reales', async () => {
            const pages = await Promise.all(contexts.map(c => c.newPage()));
            for (let i=0;i<pages.length;i++) {
                await pages[i].goto('https://pgt-github-probe-dev.david-dzm5.workers.dev/');
                expect(await pages[i].evaluate(() => localStorage.getItem('qa-isolation-probe'))).toBeNull();
                await pages[i].evaluate(async index => {
                    localStorage.setItem('qa-isolation-probe',String(index));
                    document.cookie='qa-isolation-probe='+index+'; path=/; Secure; SameSite=Strict';
                    await new Promise((ok,no)=>{const q=indexedDB.open('qa-isolation-'+index,1);q.onsuccess=()=>{q.result.close();ok();};q.onerror=no;});
                },i);
            }
            const stores=[];
            for(let i=0;i<pages.length;i++) {
                const x=await pages[i].evaluate(async()=>({local:localStorage.getItem('qa-isolation-probe'),cookie:document.cookie,db:(await indexedDB.databases()).map(d=>d.name).filter(n=>n.startsWith('qa-isolation-'))}));
                expect(x.local).toBe(String(i));expect(x.cookie).toContain('qa-isolation-probe='+i);expect(x.db).toEqual(['qa-isolation-'+i]);stores.push(x);
            }
            await r.json('three-independent-stores',{chromium:browser.version(),os:process.platform,stores,physicalMobile:false});
        });
        r.finish('APROBADO','Versión DEV/URL/Chromium registrados y tres almacenes completos independientes comprobados. La autenticación y el registro de usuarios se evalúan por separado en PRE02.','Windows Chromium headless; Android/iOS físicos no disponibles ni declarados probados.');
    } finally { for(const c of contexts) await c.close(); }
});
caseTest('TEC 04',{users:['A','A2','C','C2']}, async ({},r)=>{
    await world();r.includePrevious();await w.login('C');w.users.C2=w.users.C;w.persist();await w.login('C2','C');const p=await ownTech(w,'C'),before=await w.snapshot('C'),pos=await openPosition(p);
    await r.step('Alta con ACK perdido: reintento idempotente no duplica UUID',async()=>{
        let resolveReceipt;const receipt=new Promise(ok=>resolveReceipt=ok);
        await p.route('**/api/v2/commands/repertoire',async route=>{try{const response=await route.fetch({timeout:60000});const status=response.status();await r.json('lost-ack-receipt',{status,body:await response.json()});resolveReceipt(status);if(status===200)await route.abort('failed');else await route.fulfill({response});}catch(error){resolveReceipt({error:error.name});await route.abort('failed').catch(()=>{});}},{times:1});
        await pos.getByRole('button',{name:'Añadir técnica',exact:true}).click();expect(await receipt).toBe(200);
        const retry=p.getByRole('button',{name:'Reintentar guardado',exact:true});
        if(await retry.isVisible())await awaitCommand(p,'repertoire',()=>retry.click());
        await expect(p.locator('.sync-success')).toBeVisible({timeout:60000});
    });
    const ids=x=>x.techniques.data.positions.flatMap(p=>[p.id,...p.tecnicas.map(t=>t.id)]),old=ids(before),after=await w.snapshot('C'),added=ids(after).filter(id=>!old.includes(id));expect(added).toHaveLength(1);
    await r.step('Borrar y volver a añadir produce otro UUID y llega a A2',async()=>{
        const target=p.locator('[id="technique-'+added[0]+'"]');
        p.once('dialog',d=>d.accept());await awaitCommand(p,'repertoire',()=>target.getByRole('button',{name:'Borrar técnica',exact:true}).click());
        await awaitCommand(p,'repertoire',()=>pos.getByRole('button',{name:'Añadir técnica',exact:true}).click());
        const final=await w.snapshot('C'),newIds=ids(final).filter(id=>!ids(after).includes(id));expect(newIds).toHaveLength(1);expect(ids(final)).not.toContain(added[0]);
        await w.pages.C2.reload();expect((await w.snapshot('C2')).techniques.data).toEqual(final.techniques.data);await r.json('uuid-retry-delete-readd',{old:added,new:newIds,final:final.techniques});
    });
    r.finish('APROBADO','Altas, orden y recarga previos de A/A2 completados con ACK perdido/reintento sin duplicación y UUID eliminado nunca reutilizado, usando C/C2 para ese ensayo aislado.');
});
caseTest('TEC 06',async({},r)=>{
    await world();r.includePrevious();const p=await ownTech(w),pos=await openPosition(p),field=pos.getByLabel('Tipo de técnica',{exact:true}).first();
    await r.step('Comprobar negrita computada y lectura de descripción extensa',async()=>{
        const weight=await field.evaluate(e=>getComputedStyle(e).fontWeight);await r.json('font-weight',{weight});expect(Number(weight)).toBeGreaterThanOrEqual(600);
        const before=await w.snapshot(),text=Array.from({length:80},(_,i)=>'LECTURA '+i+' contenido largo conservado').join('\n')+'\nFINAL_LECTURA_QA';await describe(w,text);
        const textarea=pos.getByLabel('Descripción de técnica o enlace de vídeo').first();expect(await textarea.inputValue()).toBe(text);await textarea.evaluate(e=>{e.scrollTop=e.scrollHeight;});
        expect(await textarea.evaluate(e=>e.scrollTop+e.clientHeight>=e.scrollHeight-2)).toBe(true);await r.capture(p,'long-readable');
        await describe(w,before.techniques.data.positions[0].tecnicas[0].descripcion_del_alumno);
    });
    r.finish('APROBADO','Filtros previos conservan íntegra la lista; tipo con negrita computada y texto extenso íntegro legible hasta el final.');
});
caseTest('PRO 04',async({},r)=>{
    await world();r.includePrevious();const p=w.pages.A;await p.getByRole('button',{name:'Perfil',exact:true}).click();const before=await w.snapshot(),checks=[];
    await r.step('Límite de nombre/apellidos también evita envío inválido desde formulario',async()=>{
        for(const name of ['nombre','apellidos']) {
            const field=p.locator('[name='+name+']'),initial=await field.inputValue(),count=w.state.network.filter(x=>x.path.endsWith('/commands/profile')).length;
            await field.fill('x'.repeat(201));const value=await field.inputValue();
            const response=p.waitForResponse(x=>x.url().endsWith('/commands/profile'));await p.getByRole('button',{name:'Guardar en este dispositivo',exact:true}).click();const rejected=await response;expect(rejected.status()).toBe(400);await expect(p.locator('[role=alert]').first()).toBeVisible();
            checks.push({name,inputLength:value.length,rejectedBeforePersistence:true,status:rejected.status()});await field.fill(initial);
        }
        expect((await w.snapshot()).profile).toEqual(before.profile);await r.json('ui-profile-boundaries',checks);
    });
    r.finish('APROBADO','Cinco cinturones, opcionales y recarga previos; nombres/apellidos fuera de límite dan rechazo visible desde formulario y se conserva el perfil persistido.','El formulario admite escribir 201 caracteres; servidor valida antes de persistir (HTTP400), sin truncar.');
});
caseTest('COM 03',async({},r)=>{
    await world();r.includePrevious();const {p,form}=await fillCompetition(w,{start:datePlus(1),end:datePlus(2),roles:['A']});
    await r.step('Guardar frontera máxima 3600 en ambos descansos',async()=>{
        await form.locator('[name=change]').fill('3600');await form.locator('[name=rest]').fill('3600');const saved=await awaitCommand(p,'competition',()=>form.getByRole('button',{name:'Crear competición',exact:true}).click());
        const actual=await plan(w,'A',saved.metadata.planId);expect(actual.descanso_entre_ciclos_segundos).toBe(3600);expect(actual.descanso_entre_tecnicas_segundos).toBe(3600);await r.json('max-rests',actual);
    });r.finish('APROBADO','Matrices previas de ejercicios/descansos completadas con persistencia de frontera máxima 3600 en ambos descansos.');
});
caseTest('COM 04',async({},r)=>{
    await world();r.includePrevious();const before=await w.api('T','catalog');
    await r.step('Fechas imposibles no llegan a persistencia al evitar input date',async()=>{
        const cases=[];
        for(const date of ['2026-02-30','2027-02-29','2026-13-01']){
            const response=await w.api('T','commands/competition',{competition:{fecha_comienzo:date,fecha_torneo:datePlus(10),alumnos:[w.users.A.mail],dias_de_entrenamiento:[1],ejercicios_por_sesion:5,tiempo_por_tecnica_segundos:180,descanso_entre_ciclos_segundos:10,descanso_entre_tecnicas_segundos:20},expected:before.data.version,operationId:crypto.randomUUID()});expect(response.status).toBe(400);cases.push({date,status:response.status});
        }expect((await w.api('T','catalog')).data).toEqual(before.data);await r.json('impossible-date-api',cases);
    });r.finish('APROBADO','Validaciones UI previas completadas con fechas imposibles y bisiesta inválida rechazadas en servidor sin mutación.');
});
