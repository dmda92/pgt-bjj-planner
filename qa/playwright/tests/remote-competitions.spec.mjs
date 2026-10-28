import { test } from '@playwright/test';
import { caseTest, expect } from '../helpers/case-test.mjs';
import { getWorld } from '../helpers/remote-world.mjs';
import { createCompetition, fillCompetition, competitionCard, trainer, awaitCommand, plan, datePlus, ensurePlan } from '../helpers/remote-actions.mjs';
let w;
test.beforeAll(async () => { w = await getWorld(); for (const role of ['T', 'A', 'B']) await w.login(role); w.users.A2 ||= w.users.A; await w.login('A2', 'A'); });
test.afterAll(async () => w?.close());
async function assign(id, roles) {
    const { p, card } = await competitionCard(w, id);
    for (const role of ['A', 'B', 'C', 'T']) await card.locator(`input[name=student][value="${w.users[role].mail}"]`).setChecked(roles.includes(role));
    await awaitCommand(p, 'assignment', () => card.getByRole('button', { name: 'Guardar datos', exact: true }).click());
}
caseTest('COM 01', async ({}, r) => {
    const { p, form } = await fillCompetition(w, { end: datePlus(21), roles: ['A'] });
    expect(await form.locator('[name=sets]').inputValue()).toBe('5'); expect(await form.locator('[name=work]').inputValue()).toBe('3:00');
    expect(await form.locator('[name=change]').inputValue()).toBe('10'); expect(await form.locator('[name=rest]').inputValue()).toBe('20');
    let release; const held = new Promise(resolve => { release = resolve; });
    await p.route('**/api/v2/commands/competition', async route => { await held; await route.continue(); }, { times: 1 });
    let saved;
    await r.step('Crear torneo por defecto observando spinner y bloqueo inmediato', async () => {
        const response = p.waitForResponse(x => x.url().endsWith('/commands/competition'), { timeout: 90000 });
        response.catch(() => {});
        await form.getByRole('button', { name: 'Crear competición', exact: true }).click();
        await expect(form.getByRole('button', { name: 'Crear competición', exact: true })).toBeDisabled();
        await expect(p.getByRole('status', { name: 'Creando competición', exact: true })).toBeVisible(); await r.capture(p, 'creando'); release();
        const received = await response; expect(received.status()).toBe(200); saved = await received.json();
    });
    const id = saved.metadata.planId; if (!w.state.planIds.includes(id)) w.state.planIds.push(id); w.state.defaultPlan = id; w.persist();
    const actual = await plan(w, 'A', id); expect(actual.tiempo_por_tecnica_segundos).toBe(180); expect(actual.ejercicios_por_sesion).toBe(5);
    expect(actual.descanso_entre_ciclos_segundos).toBe(10); expect(actual.descanso_entre_tecnicas_segundos).toBe(20);
    await r.json('created-plan', actual); r.finish('APROBADO', 'Defaults, spinner/bloqueo, planId único y parámetros confirmados en plan del backend.');
});
caseTest('COM 02', async ({}, r) => {
    const checks = [];
    for (const [work, seconds] of [['2:35', 155], ['0:01', 1], ['60:00', 3600]]) {
        const id = await r.step('Guardar trabajo ' + work, () => createCompetition(w, { end: datePlus(22 + checks.length), work, roles: ['A'] }));
        expect((await plan(w, 'A', id)).tiempo_por_tecnica_segundos).toBe(seconds); checks.push({ work, seconds, id });
    }
    const { p, form } = await fillCompetition(w, { end: datePlus(27), roles: ['A'] });
    await r.step('Rechazar formatos y límites de temporizador antes de red', async () => {
        for (const value of ['0:00', '3:60', '60:01', '180', '3:']) {
            const count = w.state.network.filter(n => n.path.endsWith('/commands/competition')).length;
            await form.locator('[name=work]').fill(value); await form.getByRole('button', { name: 'Crear competición', exact: true }).click();
            expect(await form.locator('[name=work]').evaluate(e => e.checkValidity())).toBe(false);
            expect(w.state.network.filter(n => n.path.endsWith('/commands/competition')).length).toBe(count); checks.push({ work: value, rejected: true });
        }
        await form.locator('[name=work]').fill('3:00'); await awaitCommand(p, 'competition', () => form.getByRole('button', { name: 'Crear competición', exact: true }).click());
    });
    await r.json('duration-matrix', checks); r.finish('APROBADO', 'Tres límites válidos persistidos en segundos; cinco inválidos sin petición y corrección funcional sin recarga.');
});
caseTest('COM 03', async ({}, r) => {
    const checks = [];
    for (const N of [1, 100]) { const id = await createCompetition(w, { N, end: datePlus(31 + N), roles: ['A'] }); expect((await plan(w, 'A', id)).ejercicios_por_sesion).toBe(N); checks.push({ N, id }); }
    const { p, form } = await fillCompetition(w, { end: datePlus(34), roles: ['A'] });
    await r.step('Validar ejercicios y los dos descansos en sus fronteras', async () => {
        for (const [name, values] of [['sets', ['0', '-1', '1.5', '', '101']], ['change', ['0', '-1', '1.5', '', '3601']], ['rest', ['0', '-1', '1.5', '', '3601']]]) {
            for (const value of values) {
                await form.locator(`[name=${name}]`).fill(value); await form.getByRole('button', { name: 'Crear competición', exact: true }).click();
                expect(await form.locator(`[name=${name}]`).evaluate(e => e.checkValidity())).toBe(false); checks.push({ name, value, rejected: true });
            }
            await form.locator(`[name=${name}]`).fill(name === 'sets' ? '5' : '1');
        }
        const saved = await awaitCommand(p, 'competition', () => form.getByRole('button', { name: 'Crear competición', exact: true }).click());
        const actual = await plan(w, 'A', saved.metadata.planId); expect(actual.descanso_entre_ciclos_segundos).toBe(1); expect(actual.descanso_entre_tecnicas_segundos).toBe(1);
    });
    await r.json('numeric-matrix', checks); r.finish('PARCIAL', 'N=1/100 y matrices inválidas de ejercicios/descansos verificadas; ambos descansos=1 persistidos.', 'Falta persistir explícitamente ambos descansos=3600; no se presenta esa frontera como comprobada.');
});
caseTest('COM 04', async ({}, r) => {
    const { p, form } = await fillCompetition(w, { roles: ['A'] }), checks = [];
    await r.step('Fechas vacías, iguales, anteriores y más de 730 días', async () => {
        for (const [start, end] of [['', datePlus(5)], [datePlus(1), datePlus(1)], [datePlus(2), datePlus(1)], [datePlus(1), datePlus(732)]]) {
            await form.locator('[name=start]').fill(start); await form.locator('[name=end]').fill(end);
            await form.getByRole('button', { name: 'Crear competición', exact: true }).click();
            expect(await form.locator('form').evaluate(e => e.checkValidity())).toBe(false); checks.push({ start, end, rejected: true });
        }
        await form.locator('[name=start]').fill(datePlus(1)); await form.locator('[name=end]').fill(datePlus(5));
        await form.locator('[name=start]').fill(datePlus(6)); expect(await form.locator('form').evaluate(e => e.checkValidity())).toBe(false);
        await form.locator('[name=start]').fill(datePlus(1)); await awaitCommand(p, 'competition', () => form.getByRole('button', { name: 'Crear competición', exact: true }).click());
    });
    await r.json('date-matrix', checks); r.finish('PARCIAL', 'Validación cruzada, igualdad/anterioridad, vacío, rango y corrección desde UI comprobados.', 'Fecha imposible es saneada por input date de Chromium; no se ha enviado manualmente en este caso al backend.');
});
caseTest('COM 05', async ({}, r) => {
    const { p, form } = await fillCompetition(w, { roles: ['A'] });
    await r.step('Rechazar cero días y aceptar combinación corregida', async () => {
        for (const input of await form.locator('[name=day]').all()) await input.setChecked(false);
        await form.getByRole('button', { name: 'Crear competición', exact: true }).click(); await expect(p.getByText('Selecciona al menos un día de entrenamiento.', { exact: false })).toBeVisible();
        await form.locator('[name=day][value="1"]').check(); await awaitCommand(p, 'competition', () => form.getByRole('button', { name: 'Crear competición', exact: true }).click());
    });
    let offset=1;while(new Date(datePlus(offset)+'T12:00:00Z').getUTCDay()!==1)offset++;
    const id = await createCompetition(w, { start: datePlus(offset), end: datePlus(offset+1), days: [7], roles: ['A'] });
    const actual = await plan(w, 'A', id); expect(actual.sessions).toHaveLength(0); await r.json('no-training-dates', actual);
    r.finish('APROBADO', 'Cero días muestra error; corregir permite alta. Intervalo sin coincidencias conserva plan sin sesiones inventadas.');
});
caseTest('COM 06', async ({}, r) => {
    const end = datePlus(45), one = await createCompetition(w, { end, N: 3, roles: ['A'] }), two = await createCompetition(w, { end, N: 7, roles: ['A'] });
    await r.step('Contrastar dos competiciones con misma fecha e identidad independiente', async () => {
        expect(one).not.toBe(two); const a = await plan(w, 'A', one), b = await plan(w, 'A', two); expect(a.ejercicios_por_sesion).toBe(3); expect(b.ejercicios_por_sesion).toBe(7);
        const { card } = await competitionCard(w, one); expect(await card.locator('input[name=start],input[name=sets]').count()).toBe(0);
        await r.json('same-date-plans', { one: a, two: b });
    });
    r.finish('APROBADO', 'Misma fecha no colisiona: dos planId distintos, parámetros propios y sin edición de configuración.');
});
caseTest('COM 07', async ({}, r) => {
    const id = await ensurePlan(w), before = await w.api('T', 'catalog'), { card } = await competitionCard(w, id);
    await r.step('Cambiar participantes sin guardar y deshacer', async () => {
        const count = w.state.network.filter(n => n.path.endsWith('/commands/assignment')).length;
        for (const role of ['A', 'B', 'T']) { const input = card.locator(`[name=student][value="${w.users[role].mail}"]`); const checked = await input.isChecked(); await input.setChecked(!checked); await input.setChecked(checked); }
        await expect(card.getByRole('button', { name: 'Guardar datos', exact: true })).toBeDisabled();
        expect(w.state.network.filter(n => n.path.endsWith('/commands/assignment')).length).toBe(count); expect((await w.api('T', 'catalog')).data).toEqual(before.data);
    });
    await r.capture(w.pages.T, 'participants-draft'); r.finish('APROBADO', 'Casillas inmediatas, sin envío; deshacer deshabilita Guardar datos y conserva remoto.');
});
caseTest('COM 08', async ({}, r) => {
    const id = await ensurePlan(w), { p, card } = await competitionCard(w, id);
    await card.locator(`[name=student][value="${w.users.T.mail}"]`).check();
    let release; const held = new Promise(resolve => { release = resolve; });
    await p.route('**/api/v2/commands/assignment', async route => { await held; await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"QA_CONTROLLED_FAILURE"}' }); }, { times: 1 });
    await r.step('Guardar retenido, error controlado y reintento real', async () => {
        const failure = p.waitForResponse(x => x.url().endsWith('/commands/assignment') && x.status() === 500);
        await card.getByRole('button', { name: 'Guardar datos', exact: true }).click(); await expect(card.getByRole('button', { name: 'Guardar datos', exact: true })).toBeDisabled();
        await expect(card.locator('input[name=student]').first()).toBeDisabled(); await r.capture(p, 'saving-held'); release(); await failure;
        await expect(card.getByRole('button', { name: 'Guardar datos', exact: true })).toBeEnabled(); expect(await card.locator(`[name=student][value="${w.users.T.mail}"]`).isChecked()).toBe(true);
        await awaitCommand(p, 'assignment', () => card.getByRole('button', { name: 'Guardar datos', exact: true }).click());
    });
    const c = (await w.api('T', 'catalog')).data.data.plans.find(x => x.planId === id); expect(c.alumnos).toContain(w.users.T.mail); await r.json('confirmed-assignment', c);
    r.finish('APROBADO', 'Petición bloquea controles, fallo HTTP simulado conserva selección; reintento confirma lista final en Firestore DEV.', 'Fallo inyectado en transporte; reintento y persistencia contra DEV real.');
});
caseTest('COM 09', async ({}, r) => {
    const id = await createCompetition(w, { end: datePlus(51), roles: ['B'] });
    await r.step('Asignar A mientras ambos clientes están sin red y reconectar', async () => {
        await w.contexts.A.setOffline(true); await w.contexts.A2.setOffline(true); await assign(id, ['A', 'B']);
        await w.contexts.A.setOffline(false); await expect.poll(async () => (await w.snapshot()).plans.some(x => x.data.planId === id)).toBe(true);
        await w.pages.A.getByRole('button', { name: /^Mis planes/ }).click(); await expect(w.pages.A.getByLabel('Mi plan', { exact: true }).locator(`option[value="${id}"]`)).toHaveCount(1);
        await w.contexts.A2.setOffline(false); await expect.poll(async () => (await w.snapshot('A2')).plans.filter(x => x.data.planId === id).length).toBe(1);
        await w.pages.A2.getByRole('button', { name: /^Mis planes/ }).click(); await expect(w.pages.A2.getByLabel('Mi plan', { exact: true }).locator(`option[value="${id}"]`)).toHaveCount(1);
    });
    await r.json('reconnected-index', { a: (await w.snapshot()).index, a2: (await w.snapshot('A2')).index }); r.finish('APROBADO', 'Asignación confirmada con A offline; reconexión de cada perfil recibe un único plan sin borrar almacenamiento ni nuevo login.');
});
caseTest('COM 10', async ({}, r) => {
    r.includePrevious();
    const id = await createCompetition(w, { end: datePlus(53), roles: ['T', 'A'] });
    const t = await plan(w, 'T', id); expect(t.mail).toBe(w.users.T.mail);
    await r.step('Entrenador participante consulta su plan de solo lectura', async () => {
        const p = w.pages.T; await p.getByRole('button', { name: /^Mis planes/ }).click(); await p.getByLabel('Mi plan', { exact: true }).selectOption(id);
        await expect(p.locator('.plan-card')).toBeVisible(); await expect(p.locator('.plan-card details.session')).toHaveCount(t.sessions.length); expect(await p.locator('.plan-card input,.plan-card textarea,.plan-card [contenteditable=true]').count()).toBe(0); await expect(p.getByRole('button',{name:'Exportar PDF',exact:true})).toBeVisible(); await r.capture(p, 'trainer-participant');
    });
    await r.json('trainer-plan', t); r.finish('PARCIAL', 'T puede incluirse al crear y recibe plan propio de solo lectura.', 'La consulta desde otro entrenador y su matriz completa de textos/histórico se ejercitan en escenarios aislados, no en este plan concreto.');
});
caseTest('COM 11', async ({}, r) => {
    const id = await createCompetition(w, { end: datePlus(55), roles: ['A', 'B'] }), beforeB = await plan(w, 'B', id);
    await w.snapshot(); await w.snapshot('A2');
    for (const role of ['A', 'A2']) { await w.pages[role].getByRole('button', { name: /^Mis planes/ }).click(); await w.pages[role].getByLabel('Mi plan', { exact: true }).selectOption(id); }
    await r.step('Desasignar A con copia en dos perfiles, uno offline', async () => {
        await w.contexts.A2.setOffline(true); await assign(id, ['B']);
        await expect.poll(async () => (await w.snapshot()).plans.some(x => x.data.planId === id)).toBe(false);
        await w.contexts.A2.setOffline(false); await expect.poll(async () => (await w.snapshot('A2')).plans.some(x => x.data.planId === id)).toBe(false);
        for (const role of ['A', 'A2']) await expect(w.pages[role].getByLabel('Mi plan', { exact: true }).locator(`option[value="${id}"]`)).toHaveCount(0);
        expect(await plan(w, 'B', id)).toEqual(beforeB); const removed = await w.api('A', 'users/' + encodeURIComponent(w.users.A.mail) + '/plans/' + id); expect([403, 404]).toContain(removed.status);
    });
    await r.json('unassigned', { id, a: (await w.snapshot()).index, b: beforeB }); r.finish('APROBADO', 'Desasignación real elimina acceso/plan de A en ambos perfiles, conserva torneo y plan de B; no queda archivo visible archivado.');
});
caseTest('COM 12', async ({}, r) => {
    const id = await createCompetition(w, { end: datePlus(57), roles: ['A', 'B'] }), beforeB=await plan(w,'B',id);
    await r.step('Perder ACK tras desasignacion confirmada, verificar reintento idempotente y reasignar', async () => {
        const { p, card } = await competitionCard(w, id); await card.locator(`[name=student][value="${w.users.A.mail}"]`).uncheck();
        const payloads=[],capture=req=>{if(req.url().endsWith('/api/v2/commands/assignment')&&req.method()==='POST')payloads.push(req.postDataJSON());};p.on('request',capture);
        let committed;
        await p.route('**/api/v2/commands/assignment', async route => { const response = await route.fetch(); expect(response.status()).toBe(200); committed=await response.json(); await route.abort('failed'); }, { times: 1 });
        const lost=p.waitForEvent('requestfailed',{predicate:req=>req.url().endsWith('/api/v2/commands/assignment')&&req.method()==='POST',timeout:60000});
        const recovered=p.waitForResponse(response=>response.url().endsWith('/api/v2/commands/assignment')&&response.request().method()==='POST',{timeout:60000});
        try{
            await card.getByRole('button', { name: 'Guardar datos', exact: true }).click();
            const failed=await lost;expect(failed.failure()).toBeTruthy();
            // The current contract performs exactly one immediate retry of this
            // lost ACK with the same operationId/body; never a reconnect replay.
            const receipt=await recovered;expect(receipt.status()).toBe(200);const replayed=await receipt.json();
            expect(payloads).toHaveLength(2);expect(payloads[1]).toEqual(payloads[0]);expect(replayed).toEqual(committed);
            await expect(card.getByRole('button',{name:'Guardar datos',exact:true})).toBeDisabled();
            expect((await w.snapshot()).index.data.deletedPlanIds).toContain(id);expect(await plan(w,'B',id)).toEqual(beforeB);
            const absent=await w.api('A','users/'+encodeURIComponent(w.users.A.mail)+'/plans/'+id);expect([403,404]).toContain(absent.status);
            await r.capture(p,'lost-ack-recovered');await r.json('lost-ack-idempotence',{failed:failed.failure(),payloads,receipt:replayed,bPlanUnchanged:true});
        }finally{p.off('request',capture);await p.unroute('**/api/v2/commands/assignment');}
        await assign(id, ['A', 'B']);
        expect((await w.snapshot()).index.data.deletedPlanIds || []).not.toContain(id); expect((await plan(w, 'A', id)).sessions.length).toBeGreaterThan(0);expect(await plan(w,'B',id)).toEqual(beforeB);
        const catalog=(await w.api('T','catalog')).data.data;expect(catalog.plans.find(c=>c.planId===id).alumnos.sort()).toEqual([w.users.A.mail,w.users.B.mail].sort());
    });
    await r.json('reassigned', (await w.snapshot()).index); r.finish('APROBADO', 'ACK perdido observado como requestfailed tras commit200; reintento inmediato usa exactamente mismo payload/operationId y devuelve mismo recibo. Tombstone y acceso retirado A, reasignacion elimina tombstone y recupera plan; plan B profundo intacto.', 'Commit Firestore atomico: no existe fase visible indice/JSON separada. Se inyecta perdida de ACK en Chromium; reintento y persistencia son DEV real.');
});
caseTest('COM 13', async ({}, r) => {
    const id = await createCompetition(w, { end: datePlus(59), roles: ['A', 'B'] }), before = await w.snapshot(), { p, card } = await competitionCard(w, id);
    await r.step('Cancelar borrado y después confirmar con respuesta retenida', async () => {
        p.once('dialog', d => d.dismiss()); await card.getByRole('button', { name: 'Borrar competición completa', exact: true }).click(); expect((await w.snapshot()).index).toEqual(before.index);
        let release; const held = new Promise(resolve => { release = resolve; }); await p.route('**/api/v2/commands/delete-competition', async route => { await held; await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"QA_DELETE_FAILURE"}' }); }, { times: 1 });
        p.once('dialog', d => d.accept()); await card.getByRole('button', { name: 'Borrar competición completa', exact: true }).click();
        await expect(card.locator('[role=status]')).toBeVisible(); await expect(card.locator('input').first()).toBeDisabled(); await r.capture(p, 'deleting'); release();
        await expect(card.getByRole('button', { name: 'Borrar competición completa', exact: true })).toBeEnabled();
        const count = await p.locator('.competition-card').count();
        p.once('dialog', d => d.accept()); await awaitCommand(p, 'delete-competition', () => card.getByRole('button', { name: 'Borrar competición completa', exact: true }).click());
        await expect(p.locator('.competition-card')).toHaveCount(count - 1);
    });
    expect((await w.snapshot()).plans.some(x => x.data.planId === id)).toBe(false); expect((await w.snapshot('B')).plans.some(x => x.data.planId === id)).toBe(false);
    await r.json('deleted', { id, remaining: w.state.planIds.filter(x => x !== id) }); r.finish('APROBADO', 'Cancelar conserva; confirmación muestra espera, error permite reintento; borrado retira catálogo/asignaciones/planes de ambos alumnos.');
});
caseTest('COM 14', async ({}, r) => {
    await w.login('C'); await w.contexts.C.setOffline(true);
    const id = await createCompetition(w, { end: datePlus(61), roles: ['C', 'B'] });
    await r.step('Desasignar antes de abrir plan y comprobar un perfil limpio', async () => {
        await assign(id, ['B']); await w.contexts.C.setOffline(false); const page = w.pages.C; await page.reload();
        expect((await w.snapshot('C')).plans.some(x => x.data.planId === id)).toBe(false);
        w.users.C2 = w.users.C; w.persist(); await w.login('C2', 'C');
        expect((await w.snapshot('C2')).plans.some(x => x.data.planId === id)).toBe(false); await r.json('no-resurrection', (await w.snapshot('C')).index);
    });
    r.finish('APROBADO', 'C estaba desconectado antes del alta y retirada. Ni el perfil antiguo C ni el perfil nuevo C2 resucitan el plan eliminado; B conserva el suyo.', 'Se usa C nuevo como alumno del caso para garantizar ausencia de primera descarga.');
});
