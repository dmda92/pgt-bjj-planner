import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { caseTest,expect } from '../helpers/case-test.mjs';
import { createLocalAcademy } from '../helpers/local-academy.mjs';
import { datePlus } from '../helpers/remote-actions.mjs';
caseTest('TEC 10',{environment:'DEV real previo + suplemento PWA/Worker local con Firestore sintético',users:['A real','alumno local','entrenador local']},async({browser},r)=>{
    r.includePrevious();const a=await createLocalAcademy(),u=await a.register('text-safety'),c=await browser.newContext(),tc=await browser.newContext(),p=await c.newPage(),t=await tc.newPage(),payload='<script>window.__qa_xss=1</script><b>QA</b> javascript:alert(1) {"qa":true}';
    let dialogs=0;for(const page of [p,t])page.on('dialog',async d=>{dialogs++;await d.dismiss();});
    try{
        await r.step('Guardar marcado literal por UI y contrastar alumno y entrenador',async()=>{
            await a.login(p,u.profile.mail);const pos=p.locator('details.repertoire-position').first();await pos.locator('summary').click();
            await pos.getByLabel('Tipo de técnica',{exact:true}).first().fill(payload);await pos.getByLabel('Descripción de técnica o enlace de vídeo').first().fill(payload);await expect(p.locator('.sync-success')).toBeVisible({timeout:60000});
            const actual=await a.call('users/'+encodeURIComponent(u.profile.mail)+'/snapshot',undefined,u.token);expect(actual.techniques.data.positions[0].tecnicas[0].tipo).toBe(payload);expect(actual.techniques.data.positions[0].tecnicas[0].descripcion_del_alumno).toBe(payload);
            await a.login(t,a.trainer.profile.mail);await t.getByRole('button',{name:'Entrenador',exact:true}).click();await t.getByRole('button',{name:'Equipo',exact:true}).click();await t.locator('.student-card').filter({hasText:u.profile.nombre}).click();await expect(t.locator('.student-detail')).toContainText(u.profile.mail);await t.locator('details.repertoire-position').first().locator('summary').click();
            await expect(t.getByLabel('Tipo de técnica del alumno',{exact:true}).first()).toHaveValue(payload);await expect(t.getByLabel('Descripción del alumno',{exact:true}).first()).toHaveValue(payload);
            for(const page of [p,t]){expect(await page.evaluate(()=>window.__qa_xss)).toBeUndefined();expect(await page.locator('script').filter({hasText:'window.__qa_xss=1'}).count()).toBe(0);}expect(dialogs).toBe(0);await r.capture(p,'student-literal');await r.capture(t,'trainer-literal');await r.json('literal-source',actual.techniques);
        });
        await r.step('Exportar PDF y comprobar marcado completo como texto sin ejecución',async()=>{
            const created=await a.call('commands/competition',{competition:{fecha_comienzo:datePlus(1),fecha_torneo:datePlus(2),alumnos:[u.profile.mail],dias_de_entrenamiento:[1,2,3,4,5,6,7],ejercicios_por_sesion:5,tiempo_por_tecnica_segundos:180,descanso_entre_ciclos_segundos:10,descanso_entre_tecnicas_segundos:20},expected:'1',operationId:crypto.randomUUID()},a.trainer.token);
            await p.reload();await expect(p.locator('.sync-success')).toBeVisible();await p.getByRole('button',{name:/^Mis planes/}).click();await p.getByLabel('Mi plan',{exact:true}).selectOption(created.metadata.planId);
            const pending=p.waitForEvent('download');await p.getByRole('button',{name:'Exportar PDF',exact:true}).click();const d=await pending,path=resolve(r.dir,'literal-markup.pdf');await d.saveAs(path);r.result.evidence.push(path);const inspected=JSON.parse(execFileSync('python',['qa/tools/pdf_inspect.py',path],{encoding:'utf8'}));expect(inspected.text.replace(/\s/g,'')).toContain(payload.replace(/\s/g,''));await r.json('literal-pdf-inspection',inspected);expect(dialogs).toBe(0);
        });r.finish('APROBADO','Marcado literal no ejecutado en alumno DEV real; suplemento con alumno, entrenador y PDF del Worker/PWA local verifica textos íntegros, ausencia de scripts y diálogos.','El suplemento de entrenador/PDF es local sintético, diferenciado de la evidencia DEV inicial.');
    }finally{await c.close();await tc.close();await a.close();}
});
