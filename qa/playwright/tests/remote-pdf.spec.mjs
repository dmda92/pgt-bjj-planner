import { test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { caseTest, expect, campaign } from '../helpers/case-test.mjs';
import { getWorld } from '../helpers/remote-world.mjs';
import { createCompetition, ensurePlan, plan, selectStudent, describe, datePlus, madridToday, openPosition, awaitCommand } from '../helpers/remote-actions.mjs';
import { createLocalAcademy } from '../helpers/local-academy.mjs';
let w;
test.beforeEach(async ({}, info) => {
    // PRE06 reads only this campaign's independent oracle and local evidence.
    // Filtering that case must not register or authenticate remote users.
    if (info.title.startsWith('PRE 06 ')) return;
    if (!w) { w = await getWorld(); for (const role of ['T', 'A', 'B', 'C']) await w.login(role); }
});
test.afterAll(async () => w?.close());
const norm = s => s.normalize('NFC').replace(/\s+/g, ' ').trim();
const compact = s => s.normalize('NFC').replace(/\s+/g, '');
async function comment(role,text) {
    const page=await selectStudent(w,role),pos=await openPosition(page),tech=(await w.snapshot(role)).techniques.data.positions[0].tecnicas[0];
    const field=page.locator('[id="trainer-comment-'+tech.id+'"]'),form=field.locator('..');
    if(await field.inputValue()!==text){await field.fill(text);await awaitCommand(page,'comments',()=>form.getByRole('button',{name:'Guardar comentario remoto',exact:true}).click());}
    const pupil=await w.login(role);await pupil.getByRole('button',{name:'Mis técnicas',exact:true}).click();
    const pupilPos=pupil.locator('[data-position-id="'+(await w.snapshot(role)).techniques.data.positions[0].id+'"]');if(!await pupilPos.evaluate(e=>e.open))await pupilPos.locator('summary').click();
    await expect.poll(()=>pupil.locator('body').textContent(),{timeout:60000}).toContain(text);
}
const spanishDate = d => d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4);
async function download(page, r, name) {
    const pending = page.waitForEvent('download', { timeout: 60000 }); await page.getByRole('button', { name: 'Exportar PDF', exact: true }).last().click();
    const actual = await pending, path = resolve(r.dir, name + '.pdf'); await actual.saveAs(path); r.result.evidence.push(path);
    const inspected = JSON.parse(execFileSync('python', ['qa/tools/pdf_inspect.py', path], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }));
    await r.json(name + '-inspection', inspected); return inspected;
}
async function ownPlan(role, id) { const page = await w.login(role); await page.getByRole('button', { name: /^Mis planes/ }).click(); await page.getByLabel('Mi plan', { exact: true }).selectOption(id); return page; }
async function longFixture() {
    if (!w.state.pdfLongPlan) { w.state.pdfLongPlan = await createCompetition(w, { start: datePlus(1), end: datePlus(2), days: [1, 2, 3, 4, 5, 6, 7], roles: ['C'] }); w.persist(); }
    return w.state.pdfLongPlan;
}
caseTest('PRE 05', { users: ['T', 'A', 'B'] }, async ({}, r) => {
    await r.step('Preparar PA/PF/PH reales solo con cuentas QA', async () => {
        const pa = await ensurePlan(w), pf = await createCompetition(w, { start: datePlus(-10), end: datePlus(-2), roles: ['A', 'B'], days: [1, 2, 3, 4, 5, 6, 7] }), ph = await createCompetition(w, { start: datePlus(-4), end: madridToday(), roles: ['A', 'B'], days: [1, 2, 3, 4, 5, 6, 7] });
        w.state.temporalPlans = { pa, pf, ph }; w.persist(); const values = {};
        for (const [label, id] of Object.entries(w.state.temporalPlans)) values[label] = await plan(w, 'A', id);
        const dates = values.pa.sessions.map(s => s.date); expect(dates).toContain(datePlus(-1)); expect(dates).toContain(madridToday()); expect(dates).toContain(datePlus(1));
        await r.json('temporal-snapshots', { cutoff: madridToday(), ...values }); writeFileSync(resolve(campaign, 'temporal-snapshots.json'), JSON.stringify(values, null, 2));
    });
    r.finish('APROBADO', 'PA incluye ayer/hoy/mañana, PF terminó y PH tiene torneo hoy Madrid; snapshots completos conservados. Reloj controlable local se ejecuta en AUT10, sin cambiar reloj ni datos reales.', 'Datos de campaña reales en DEV; clock de fallos solo en fixture local.');
});
caseTest('PRE 06', { environment: 'Patrones independientes del protocolo y evidencia de Worker local', users: ['F1', 'F2'] }, async ({}, r) => {
    await r.step('Conservar oráculos literales antes de comparar distribución', async () => {
        const annex = JSON.parse(readFileSync(resolve(campaign, 'annex.json'), 'utf8'));
        const f1 = [1, 2, 1, 3, 2, 4, 3, 5, 4, 1, 5, 2, 1, 3];
        const f2 = ['a1', 'a2', 'a3', 'b1', 'b2', 'c1', 'c2', 'a1', 'a2', 'a3', 'b1', 'b2', 'd1', 'c1', 'c2', 'a1'];
        expect(annex.some(x => JSON.stringify(x).includes('Fixture F1'))).toBe(true); expect(annex.some(x => JSON.stringify(x).includes('Fixture F2'))).toBe(true);
        await r.json('independent-oracles', { f1, f2, method: 'Secuencias literales del protocolo, no calculadas por generatePlan', verifiedByCases: ['GEN 03', 'GEN 06'] });
        for (const id of ['GEN-03', 'GEN-06']) { const row = JSON.parse(readFileSync(resolve(campaign, 'results', id + '.json'), 'utf8')); expect(row.status).toBe('APROBADO'); r.result.evidence.push(...row.evidence); }
    });
    r.finish('APROBADO', 'F1/F2 se verifican con secuencias literales independientes conservadas; los casos GEN adjuntos cargan esos repertorios y comparan Worker/PWA.');
});
caseTest('PDF 01', { users: ['A', 'T'] }, async ({}, r) => {
    const id = await ensurePlan(w), actual = await plan(w, 'A', id); let student, trainer;
    await r.step('Descargar mismo plan desde alumno y ficha de entrenador', async () => {
        student = await download(await ownPlan('A', id), r, 'alumno'); const p = await selectStudent(w, 'A', 'Planes'); await p.getByLabel('Plan del alumno', { exact: true }).selectOption(id); trainer = await download(p, r, 'entrenador');
        expect(norm(trainer.text)).toBe(norm(student.text));
        let cursor=0; const text=compact(student.text);
        for (const session of actual.sessions) {
            expect(student.text).toContain(spanishDate(session.date));
            for (const exercise of session.exercises) {
                const next=text.indexOf(compact(exercise.tipo),cursor);expect(next, 'ordered technique '+exercise.techniqueId).toBeGreaterThanOrEqual(cursor);cursor=next+compact(exercise.tipo).length;
                for(const value of [exercise.posicion,exercise.descripcion_del_alumno||'',exercise.comment||'','Prioridad '+exercise.prioridad]) expect(text).toContain(compact(value));
            }
        }
        expect(student.pages.length).toBeGreaterThan(0); await r.json('source-plan', actual);
    });
    r.finish('APROBADO', 'Alumno y entrenador descargan el mismo contenido del plan; todas las fechas y nombres de ejercicios están presentes en el texto extraído del PDF.');
});
caseTest('PDF 02', { users: ['A'] }, async ({}, r) => {
    const id = await ensurePlan(w), pdf = await download(await ownPlan('A', id), r, 'design');
    await r.step('Contrastar introducción literal, logo y páginas de PDF', async () => {
        const annex = JSON.parse(readFileSync(resolve(campaign, 'annex.json'), 'utf8')), i = annex.findIndex(x => x.text === 'Introducción literal del PDF');
        expect(norm(pdf.text)).toContain(norm(annex[i + 1].text)); expect(norm(pdf.text)).toContain(norm(annex[i + 2].text));
        expect(pdf.pages.every(p => p.images > 0)).toBe(true); expect(pdf.text).not.toContain('pgt-github-probe-dev.david-dzm5.workers.dev');
        await r.json('layout-basics', { pages: pdf.pages.length, imageEveryPage: pdf.pages.every(p => p.images > 0), reviewedPages: [1, Math.ceil(pdf.pages.length / 2), pdf.pages.length] });
    });
    r.finish('PARCIAL', 'Introducción literal completa, logo y ausencia de cabeceras de impresión comprobados automáticamente.', 'Pendiente de revisión visual real del PDF descargado en esta campaña; no se adjunta una evidencia visual inexistente.');
});
caseTest('PDF 03', { users: ['C', 'T'] }, async ({}, r) => {
    const id = await longFixture(), text = Array.from({ length: 100 }, (_, i) => `QA línea extensa ${String(i).padStart(3, '0')}: descripción completa para practicar con continuidad y conservar todo el texto.`).join('\n') + '\nFIN_TEXTO_PDF_LARGO';
    await r.step('Guardar descripción extensa de C y exportar sesión multipágina', async () => {
        await describe(w, text, 'C');const longComment=Array.from({length:60},(_,i)=>'COMENTARIO_EXTENSO_'+String(i).padStart(3,'0')+' contenido del entrenador').join('\n')+'\nFIN_COMENTARIO_LARGO';await comment('C',longComment);
        const page=await ownPlan('C',id);await expect.poll(()=>page.locator('body').textContent(),{timeout:60000}).toContain('FIN_COMENTARIO_LARGO');
        const pdf = await download(page, r, 'long-session'); expect(pdf.pages.length).toBeGreaterThan(1); expect(pdf.text).toMatch(/Continuación/); expect(pdf.text).toContain('FIN_TEXTO_PDF_LARGO');expect(pdf.text).toContain('FIN_COMENTARIO_LARGO');
        for(let i=0;i<60;i++)expect(pdf.text).toContain('COMENTARIO_EXTENSO_'+String(i).padStart(3,'0'));
        for (let i = 0; i < 100; i++) expect(norm(pdf.text)).toContain('QA línea extensa ' + String(i).padStart(3, '0'));
        const source = await plan(w, 'C', id); expect(source.sessions).toHaveLength(1); expect(source.sessions[0].exercises.some(e => e.descripcion_del_alumno === text)).toBe(true); await r.json('long-source', source);
    });
    r.finish('APROBADO', 'Una sesión real continúa en páginas adicionales con fecha/continuación; cien marcadores y texto final aparecen íntegros y la fuente no se trunca. Exportaciones cortas se contrastan en PDF01/02.');
});
caseTest('PDF 04', { users: ['C'] }, async ({}, r) => {
    const id = await longFixture(), url = 'https://example.test/video/' + 'ruta-larga/'.repeat(40), text = 'Áéíóú ñ ü «comillas»\nSegunda línea: ' + url;
    await r.step('Comparar Unicode soportado y enlace largo en PDF extraído', async () => {
        await describe(w, text, 'C'); const pdf = await download(await ownPlan('C', id), r, 'unicode'); expect(norm(pdf.text)).toContain(norm('Áéíóú ñ ü «comillas»'));
        expect(pdf.text.replace(/\s/g, '')).toContain(url); expect(pdf.text).toContain('Segunda línea:');
    });
    await r.step('Carácter fuera de cobertura da error explícito sin PDF incompleto', async () => {
        await describe(w, text + ' 😀', 'C'); const page = await ownPlan('C', id); let downloads = 0; const count = () => downloads++; page.on('download', count);
        await page.getByRole('button', { name: 'Exportar PDF', exact: true }).click(); await expect(page.locator('[role=alert]').first()).toBeVisible(); expect(downloads).toBe(0); page.off('download', count); await r.capture(page, 'unsupported-character');
        await describe(w, text, 'C');
    });
    r.finish('APROBADO', 'Texto español, comillas, salto y URL larga completos; emoji fuera de cobertura se rechaza explícitamente sin descargar PDF incompleto.', 'Adaptado al contrato Barlow vigente: no se exige soporte Unicode arbitrario.');
});
caseTest('PDF 05', { environment: 'DEV real + plan legado en Worker local sintético', users: ['A', 'legado local'] }, async ({ browser }, r) => {
    const defaultPdf = await download(await ownPlan('A', w.state.defaultPlan), r, 'default-tabata'); expect(defaultPdf.text).toContain('32:10');
    const id = await createCompetition(w, { start: datePlus(1), end: datePlus(2), days: [1, 2, 3, 4, 5, 6, 7], N: 7, work: '2:35', roles: ['A'] });
    const real = await plan(w, 'A', id), expected = (2 * 155 + 10) * 7 + 20 * 6; expect(expected).toBe(2360);
    const variable = await download(await ownPlan('A', id), r, 'variable-tabata'); expect(variable.text).toContain('39:20');
    const a = await createLocalAcademy(), user = await a.register('pdf-legacy'), c = { fecha_comienzo: datePlus(1), fecha_torneo: datePlus(2), alumnos: [user.profile.mail], dias_de_entrenamiento: [1, 2, 3, 4, 5, 6, 7], ejercicios_por_sesion: 5, tiempo_por_tecnica_segundos: 180, descanso_entre_ciclos_segundos: 10, descanso_entre_tecnicas_segundos: 20 };
    const context = await browser.newContext(), p = await context.newPage();
    try {
        await r.step('Publicar solo fixture legado con descansos cero y exportar PDF', async () => {
            const catalog = await a.call('catalog', undefined, a.trainer.token);
            const created = await a.call('commands/competition', { competition: c, expected: catalog.version, operationId: crypto.randomUUID() }, a.trainer.token), legacyId = created.metadata.planId;
            const source = (await a.call('users/' + encodeURIComponent(user.profile.mail) + '/plans/' + legacyId, undefined, user.token)).data;
            source.descanso_entre_ciclos_segundos = 0; source.descanso_entre_tecnicas_segundos = 0; await a.seedPlan(source);
            await a.login(p, user.profile.mail); await p.getByRole('button', { name: /^Mis planes/ }).click(); await p.getByLabel('Mi plan', { exact: true }).selectOption(legacyId);
            const legacy = await download(p, r, 'legacy-zero-rest'); expect(legacy.text).toContain('30:00'); await r.json('independent-tabata', { defaultSeconds: 1930, variableSeconds: expected, legacySeconds: 1800, real, legacySource: source });
        });
        r.finish('APROBADO', 'Duración y parámetros impresos coinciden con fórmulas independientes para defaults, variable y legado con descansos cero.', 'Legado solo se prepara en fixture sintético; nuevas altas reales siguen rechazando descanso cero.');
    } finally { await context.close(); await a.close(); }
});
caseTest('PDF 06', { users: ['A', 'T', 'B'] }, async ({}, r) => {
    const temporal = w.state.temporalPlans; expect(temporal).toBeTruthy(); const before = {};
    for (const [label, id] of Object.entries(temporal)) before[label] = await plan(w, 'A', id);
    const b = await w.snapshot('B'), text = 'PDF HISTORIA Y FUTURO ' + Date.now();
    await r.step('Cambiar descripción y comparar profundamente PA/PF/PH', async () => {
        await describe(w, text); const after = {};
        for (const [label, id] of Object.entries(temporal)) after[label] = await plan(w, 'A', id);
        expect(after.pf).toEqual(before.pf); expect(after.ph).toEqual(before.ph);
        expect(after.pa.sessions.filter(s => s.date <= madridToday())).toEqual(before.pa.sessions.filter(s => s.date <= madridToday()));
        expect(after.pa.sessions.some(s => s.date > madridToday() && s.exercises.some(e => e.descripcion_del_alumno === text))).toBe(true); expect(await w.snapshot('B')).toEqual(b);
        for (const [label, id] of Object.entries(temporal)) { const pdf = await download(await ownPlan('A', id), r, label); if (label !== 'pa') expect(pdf.text).not.toContain(text); }
        await r.json('temporal-deep-comparison', { before, after });
    });
    await r.step('Comentario y eliminación: exportar futuro y conservar instantáneas protegidas',async()=>{
        const memo='COMENTARIO_PDF_FUTURO_'+Date.now();await comment('A',memo);
        const withComment=await plan(w,'A',temporal.pa);expect(withComment.sessions.some(s=>s.date>madridToday()&&s.exercises.some(e=>e.comment===memo))).toBe(true);
        for(const [label,id] of Object.entries(temporal)){const page=await ownPlan('A',id);if(label==='pa')await expect.poll(()=>page.locator('body').textContent(),{timeout:60000}).toContain(memo);const pdf=await download(page,r,label+'-comment');if(label==='pa')expect(pdf.text).toContain(memo);else expect(pdf.text).not.toContain(memo);}
        const p=await w.login('A');await p.getByRole('button',{name:'Mis técnicas',exact:true}).click();const pos=await openPosition(p),deleted=(await w.snapshot()).techniques.data.positions[0].tecnicas[0].id;
        p.once('dialog',d=>d.accept());await awaitCommand(p,'repertoire',()=>pos.getByRole('button',{name:'Borrar técnica',exact:true}).first().click());
        const final=await plan(w,'A',temporal.pa);expect(final.sessions.filter(s=>s.date<=madridToday())).toEqual(before.pa.sessions.filter(s=>s.date<=madridToday()));
        expect(final.sessions.filter(s=>s.date>madridToday()).flatMap(s=>s.exercises).some(e=>e.techniqueId===deleted)).toBe(false);
        expect(final.sessions.map(s=>[s.date,s.exercises.length])).toEqual(before.pa.sessions.map(s=>[s.date,s.exercises.length]));
        expect(await plan(w,'A',temporal.pf)).toEqual(before.pf);expect(await plan(w,'A',temporal.ph)).toEqual(before.ph);expect(await w.snapshot('B')).toEqual(b);
        const pdf=await download(await ownPlan('A',temporal.pa),r,'after-deletion');expect(pdf.text).toContain(spanishDate(final.sessions.at(-1).date));await r.json('deletion-deep-proof',{deleted,before:withComment,after:final,protectedHistoricalOccurrences:before.pa.sessions.filter(s=>s.date<=madridToday()).flatMap(s=>s.exercises).filter(e=>e.techniqueId===deleted).length});
    });
    r.finish('APROBADO', 'Descripción y comentario actualizan únicamente futuro; PF/PH e histórico literal intactos. Tras borrado, PDF exportado desde PA recalculado sin UUID retirado en futuro y con N/fechas e histórico conservados; B íntegro.');
});
caseTest('PDF 07', { users: ['A'], environment: 'DEV real; Chromium Windows sin red' }, async ({}, r) => {
    const id = await ensurePlan(w), page = await ownPlan('A', id), before = await w.snapshot();
    await r.step('Exportar plan completo offline sin petición API ni datos vacíos', async () => {
        await page.evaluate(() => navigator.serviceWorker.ready); await w.contexts.A.setOffline(true);
        try { const pdf = await download(page, r, 'offline'); expect(pdf.pages.length).toBeGreaterThan(0); expect(pdf.text.length).toBeGreaterThan(200); }
        finally { await w.contexts.A.setOffline(false); }
        expect((await w.snapshot()).plans).toEqual(before.plans); await r.capture(page, 'offline-plan');
    });
    r.finish('PARCIAL', 'PDF completo descargado y leído sin red en Chromium Windows, sin modificaciones de planes.', 'Falta descarga y apertura con visor de Android físico.');
});
