import { test } from '@playwright/test';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { caseTest, expect, campaign } from '../helpers/case-test.mjs';
import { getWorld } from '../helpers/remote-world.mjs';
import { createCompetition, ownTech, openPosition, awaitCommand, selectStudent, plan, madridToday, datePlus, competitionCard } from '../helpers/remote-actions.mjs';
let w;
test.afterAll(async()=>w?.close());
caseTest('DEP 01',{environment:'Local Windows; Worker y transporte Firestore sintéticos; dry-run Wrangler sin publicación',users:['sin identidad remota']},async({},r)=>{
    await r.step('Comprobar todos los gates ejecutados y logs atribuibles',async()=>{
        const gates=JSON.parse(readFileSync(resolve(campaign,'gates.json'),'utf8'));expect(gates.rows.length).toBeGreaterThanOrEqual(13);
        r.result.evidence.push(...gates.rows.map(x=>x.evidence));await r.json('gate-summary',{...gates,head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dev:JSON.parse(readFileSync(resolve(campaign,'build.json'),'utf8'))});
        expect(gates.rows.filter(x=>x.status!==0)).toEqual([]);
    });r.finish('APROBADO','Instalación reproducible y todos los gates locales finalizados con código cero; logs por comando. Worker/Firestore de tests son sintéticos; comprobación remota DEV se registra por separado. No se despliega.');
});
caseTest('FIN 01',{users:['T','A','A2','B']},async({},r)=>{
    w=await getWorld();for(const role of ['T','A','B'])await w.login(role);w.users.A2 ||= w.users.A;await w.login('A2','A');
    const id=await createCompetition(w,{start:datePlus(-2),end:datePlus(4),days:[1,2,3,4,5,6,7],roles:['A','B']}),before=await plan(w,'A',id),b=await w.snapshot('B'),source=await w.snapshot(),target=before.sessions.find(s=>s.date>madridToday()).exercises[0],position=source.techniques.data.positions.find(p=>p.id===target.positionId),tech=position.tecnicas.find(t=>t.id===target.techniqueId),text='INTEGRAL_DESCRIPCION_'+Date.now(),comment='INTEGRAL_COMENTARIO_'+Date.now();
    await r.step('Editar texto y comentario en mismo UUID y comprobar propagación real A/A2',async()=>{
        const p=await ownTech(w),pos=p.locator('[data-position-id="'+position.id+'"]');if(!await pos.evaluate(e=>e.open))await pos.locator('summary').click();await awaitCommand(p,'repertoire',()=>p.locator('[id="technique-'+tech.id+'"]').getByLabel('Descripción de técnica o enlace de vídeo').fill(text));
        const t=await selectStudent(w,'A'),tp=t.locator('[data-position-id="'+position.id+'"]');if(!await tp.evaluate(e=>e.open))await tp.locator('summary').click();const field=tp.locator('[id="trainer-comment-'+tech.id+'"]');await field.fill(comment);await awaitCommand(t,'comments',()=>field.locator('..').getByRole('button',{name:'Guardar comentario remoto',exact:true}).click());
        await expect.poll(async()=>{const s=await w.snapshot('A2');return s.techniques.data.positions.flatMap(p=>p.tecnicas).find(t=>t.id===tech.id)?.descripcion_del_alumno;}).toBe(text);
        const changed=await plan(w,'A',id);expect(changed.sessions.filter(s=>s.date<=madridToday())).toEqual(before.sessions.filter(s=>s.date<=madridToday()));
        expect(changed.sessions.filter(s=>s.date>madridToday()).flatMap(s=>s.exercises).some(e=>e.techniqueId===tech.id&&e.descripcion_del_alumno===text&&e.comment===comment)).toBe(true);
        await r.json('text-and-comment',{id,uuid:tech.id,before,after:changed});
    });
    await r.step('Eliminar técnica, reconectar caché offline y exportar plan convergente',async()=>{
        await w.contexts.A2.setOffline(true);const p=await ownTech(w),pos=p.locator('[data-position-id="'+position.id+'"]');if(!await pos.evaluate(e=>e.open))await pos.locator('summary').click();p.once('dialog',d=>d.accept());await awaitCommand(p,'repertoire',()=>p.locator('[id="technique-'+tech.id+'"]').getByRole('button',{name:'Borrar técnica',exact:true}).click());
        const after=await plan(w,'A',id);expect(after.sessions.filter(s=>s.date<=madridToday())).toEqual(before.sessions.filter(s=>s.date<=madridToday()));expect(after.sessions.filter(s=>s.date>madridToday()).flatMap(s=>s.exercises).some(e=>e.techniqueId===tech.id)).toBe(false);expect(after.sessions.map(s=>[s.date,s.exercises.length])).toEqual(before.sessions.map(s=>[s.date,s.exercises.length]));
        expect(await w.snapshot('B')).toEqual(b);await w.contexts.A2.setOffline(false);await expect.poll(async()=>await plan(w,'A2',id)).toEqual(after);
        await p.getByRole('button',{name:/^Mis planes/}).click();await p.getByLabel('Mi plan',{exact:true}).selectOption(id);await w.contexts.A.setOffline(true);
        try{const pending=p.waitForEvent('download');await p.getByRole('button',{name:'Exportar PDF',exact:true}).click();const d=await pending,path=resolve(r.dir,'integral-offline.pdf');await d.saveAs(path);r.result.evidence.push(path);const inspected=JSON.parse(execFileSync('python',['qa/tools/pdf_inspect.py',path],{encoding:'utf8'}));expect(inspected.pages.length).toBeGreaterThan(1);expect(inspected.text.length).toBeGreaterThan(500);}finally{await w.contexts.A.setOffline(false);}
        await r.json('integrated-final',{id,deletedUUID:tech.id,before,after,sourceBefore:source.techniques,sourceAfter:(await w.snapshot()).techniques});await r.capture(w.pages.A,'integrated-final');
    });
    r.result.evidence.push(resolve(campaign,'results','PRE-02.json'),resolve(campaign,'results','GEN-03.json'),resolve(campaign,'results','GEN-06.json'));
    r.finish('APROBADO','Recorrido real con cuentas registradas en esta campaña: asignación, UUID/textos, comentario, eliminación, protección profunda de histórico, N fijo, caché offline/reconexión y PDF. A/A2/servidor convergen y B permanece literal.','Escritura offline antigua sustituida por consulta/exportación offline; algoritmo independiente contrastado en GEN03/06.');
});
caseTest('FIN 02',{environment:'Auditoría de retests de esta campaña',users:['responsable QA']},async({},r)=>{
    await r.step('Distinguir errores del harness de incidencias de producto no corregidas',async()=>{
        const attempts=readdirSync(resolve(campaign,'attempts')).filter(x=>x.endsWith('.json')),current=readdirSync(resolve(campaign,'results')).map(f=>JSON.parse(readFileSync(resolve(campaign,'results',f),'utf8')));
        const failed=current.filter(x=>x.status==='FALLIDO').map(x=>({id:x.id,incident:x.incident,evidence:x.evidence}));
        await r.json('retest-audit',{applicationFixesDuringCampaign:[],deploymentDuringCampaign:false,attemptFiles:attempts,openFailures:failed,policy:'Los reintentos corrigen únicamente selectores/precondiciones/lector QA; no cierran incidencias de aplicación sin cambio funcional posterior autorizado.'});
        expect(failed.length).toBeGreaterThan(0);
    });r.finish('NO APLICA','No se ha corregido ni desplegado código funcional durante la campaña, conforme al encargo. Incidencias reales quedan abiertas; fallos de infraestructura QA y sus reintentos se conservan en attempts y evidencias.','El retest tras corregir cada defecto de producto requiere un encargo y versión posterior; no se declara cierre de esas incidencias.');
});
caseTest('FIN 03',{users:['T','A','B','C']},async({},r)=>{
    test.setTimeout(600000); // Every owned competition is removed and verified individually.
    w ||= await getWorld();await w.login('T');const catalog=await w.api('T','catalog'),owned=new Set(w.state.planIds),foreign=catalog.data.data.plans.filter(p=>!owned.has(p.planId)),deleted=[];
    const supplementaryAccounts=existsSync(resolve(campaign,'access-users.json'))?JSON.parse(readFileSync(resolve(campaign,'access-users.json'),'utf8')):{};
    await r.step('Inventariar y borrar exclusivamente competiciones creadas en esta campaña',async()=>{
        await r.json('cleanup-before',{createdPlanIds:[...owned],foreignBefore:foreign,users:JSON.parse(readFileSync(resolve(campaign,'users.json'),'utf8')),supplementaryAccounts});
        for(const item of catalog.data.data.plans.filter(p=>owned.has(p.planId))){
            expect(item.alumnos.every(mail=>Object.values(w.users).some(u=>u.mail===mail))).toBe(true);
            const {p,card}=await competitionCard(w,item.planId),count=await p.locator('.competition-card').count();p.once('dialog',d=>d.accept());await awaitCommand(p,'delete-competition',()=>card.getByRole('button',{name:'Borrar competición completa',exact:true}).click());await expect(p.locator('.competition-card')).toHaveCount(count-1);deleted.push(item.planId);
        }
        const final=await w.api('T','catalog');expect(final.data.data.plans.filter(p=>!owned.has(p.planId))).toEqual(foreign);expect(final.data.data.plans.some(p=>owned.has(p.planId))).toBe(false);
        const value={at:new Date().toISOString(),deletedPlanIds:deleted,retainedAccounts:JSON.parse(readFileSync(resolve(campaign,'users.json'),'utf8')),supplementaryAccounts,reason:'No existe borrado de cuenta soportado en la aplicación; conservar cuentas QA para revisión del propietario.',foreignCatalogUnchanged:true};writeFileSync(resolve(campaign,'cleanup.json'),JSON.stringify(value,null,2));await r.json('cleanup-final',value);
    });r.finish('APROBADO','Competiciones QA inventariadas retiradas por UI; catálogo ajeno comparado profundamente antes/después y sin cambios. Cuentas QA y evidencias conservadas e inventariadas para revisión, sin API de borrado de cuenta.','No se afirma limpieza de cuentas no soportada; perfiles privados permiten reanudar y evidencias no se eliminan.');
});
