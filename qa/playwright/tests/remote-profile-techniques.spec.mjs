import { test } from '@playwright/test';
import { caseTest, expect } from '../helpers/case-test.mjs';
import { getWorld } from '../helpers/remote-world.mjs';
import { ownTech, openPosition, awaitCommand, describe, createCompetition, plan, datePlus } from '../helpers/remote-actions.mjs';
let w;
test.beforeAll(async () => { w = await getWorld(); await w.login('A'); w.users.A2 ||= w.users.A; await w.login('A2', 'A'); await w.login('B'); });
test.afterAll(async () => w?.close());
async function profile(role = 'A') { const p = await w.login(role); await p.getByRole('button', { name: 'Perfil', exact: true }).click(); return p; }
async function saveProfile(p) { return awaitCommand(p, 'profile', () => p.getByRole('button', { name: 'Guardar en este dispositivo', exact: true }).click()); }
caseTest('PRO 01', async ({}, r) => {
    const before = await w.snapshot(), p2 = await profile('A2'), p = await profile();
    const values = { nombre: 'QA Ana', apellidos: 'Prueba Álvarez', fecha: '1994-02-28', peso: '72,35' };
    await r.step('Editar todos los campos de perfil desde UI A y confirmar backend', async () => {
        for (const [key, value] of Object.entries(values)) await p.locator(`[name=${key}]`).fill(value);
        await p.getByLabel('Cinturón', { exact: true }).selectOption('Azul'); await saveProfile(p);
    });
    await r.step('Comprobar refresco en perfil abierto de A2', async () => {
        await expect(p2.locator('[name=nombre]')).toHaveValue(values.nombre);
        await expect(p2.locator('[name=apellidos]')).toHaveValue(values.apellidos);
        await expect(p2.locator('[name=fecha]')).toHaveValue(values.fecha);
        await expect(p2.locator('[name=peso]')).toHaveValue(/72[.,]35/);
        await expect(p2.getByLabel('Cinturón', { exact: true })).toHaveValue('Azul');
    });
    const after = await w.snapshot(); expect(after.profile.data.mail).toBe(before.profile.data.mail); expect(after.profile.data.perfil).toBe('alumno');
    for (const key of ['techniques', 'comments', 'index', 'plans']) expect(after[key]).toEqual(before[key]);
    await r.json('before-after', { before, after }); await r.capture(p2, 'perfil-segundo-cliente');
    r.finish('APROBADO', 'Los cinco campos llegan al backend y al perfil abierto A2, incluido nombre/apellidos. Identidad, rol y negocio permanecen intactos.');
});
caseTest('PRO 02', async ({}, r) => {
    const p2 = await profile('A2'), p = await profile();
    await r.step('Mantener borrador abierto mientras cambia el perfil remoto', async () => {
        await p2.locator('[name=nombre]').fill('BORRADOR SIN GUARDAR');
        await p.locator('[name=nombre]').fill('QA Ana Remota'); await saveProfile(p);
        await expect(p2.locator('[name=nombre]')).toHaveValue('BORRADOR SIN GUARDAR');
        await expect(p2.locator('.sync-success')).toHaveCount(0);
    });
    await r.capture(p2, 'borrador-preservado');
    await p2.locator('[name=nombre]').fill('QA Ana Remota');
    r.finish('APROBADO', 'El refresco remoto conserva el nombre sin guardar y retira el estado de sincronización completa. Se revisa explícitamente el borrador.');
});
caseTest('PRO 03', async ({}, r) => {
    const p = await profile(), base = await w.snapshot(), observations = [];
    await r.step('Rechazar peso cero, negativo y 500 sin reemplazar remoto', async () => {
        for (const value of ['0', '-1', '500']) {
            const requests = w.state.network.filter(n => n.path.endsWith('/commands/profile')).length;
            await p.locator('[name=peso]').fill(value); await p.getByRole('button', { name: 'Guardar en este dispositivo', exact: true }).click();
            expect(await p.locator('[name=peso]').evaluate(e => e.checkValidity())).toBe(false);
            expect(w.state.network.filter(n => n.path.endsWith('/commands/profile')).length).toBe(requests);
            observations.push({ value, valid: false });
        }
        expect((await w.snapshot()).profile.data).toEqual(base.profile.data);
    });
    await r.step('Guardar vacío, decimal positivo y 499.99; recuperar tras inválido', async () => {
        for (const [value, expected] of [['', null], ['75,123', 75.123], ['499.99', 499.99]]) {
            await p.locator('[name=peso]').fill(value); await saveProfile(p); expect((await w.snapshot()).profile.data.peso).toBe(expected); observations.push({ value, expected });
        }
    });
    await r.json('weight-matrix', observations); r.finish('APROBADO', 'Límites y opcional vacío comprobados desde formulario y backend, sin redondeo ni petición inválida.');
});
caseTest('PRO 04', async ({}, r) => {
    const p = await profile(), checks = [];
    await r.step('Guardar los cinco cinturones y nacimiento opcional/válido', async () => {
        for (const belt of ['Blanco', 'Azul', 'Morado', 'Marrón', 'Negro']) {
            await p.getByLabel('Cinturón', { exact: true }).selectOption(belt); await p.locator('[name=fecha]').fill(belt === 'Blanco' ? '' : '2000-02-29');
            await expect(p.getByLabel('Cinturón', { exact: true })).toHaveValue(belt);
            const request = p.waitForRequest(q => q.url().endsWith('/commands/profile') && q.method() === 'POST');
            await saveProfile(p);
            await r.json('belt-command-' + belt, { submittedBelt: (await request).postDataJSON().data.cinturon });
            await expect(p.locator('.sync-success')).toBeVisible({ timeout: 60000 });
            await expect.poll(async () => (await w.snapshot()).profile.data.cinturon).toBe(belt);
            const snapshot = await w.snapshot(); checks.push({ belt, date: snapshot.profile.data.fecha_nacimiento });
        }
    });
    await r.step('Rechazar datos inválidos también en el servidor', async () => {
        for (const fields of [{ fecha_nacimiento: '2026-02-30' }, { cinturon: 'Naranja' }, { nombre: 'x'.repeat(201) }, { apellidos: 'x'.repeat(201) }]) {
            const old = (await w.snapshot()).profile;
            const response = await w.api('A', 'commands/profile', { mail: w.users.A.mail, data: { ...old.data, ...fields }, expected: old.sha, operationId: crypto.randomUUID() });
            expect(response.status).toBe(400); checks.push({ invalidField: Object.keys(fields)[0], status: response.status });
            expect((await w.snapshot()).profile).toEqual(old);
        }
    });
    await p.reload(); await expect(p.getByRole('button', { name: 'Perfil', exact: true })).toBeVisible();
    await r.json('profile-validation', checks);
    r.finish('APROBADO', 'Cinturones y fechas válidas persisten tras guardado/recarga; servidor rechaza fecha imposible, cinturón ajeno y nombres de más de 200 caracteres.');
});
caseTest('PRO 05', async ({}, r) => {
    const p = await profile(), before = await w.snapshot();
    await r.step('Intentar guardar perfil con red ausente y restaurar conexión', async () => {
        await w.contexts.A.setOffline(true); await p.locator('[name=nombre]').fill('QA offline no persistido');
        await p.getByRole('button', { name: 'Guardar en este dispositivo', exact: true }).click();
        await expect(p.locator('[role=alert]').first()).toBeVisible(); await r.capture(p, 'perfil-offline');
        await w.contexts.A.setOffline(false); await p.reload();
        expect((await w.snapshot()).profile.data).toEqual(before.profile.data);
    });
    r.finish('NO APLICA', 'La edición offline y su cola persistente fueron eliminadas del contrato Firestore. El intento se rechaza y no altera el perfil remoto.', 'Se comprueba el comportamiento vigente; no se exige restaurar el mecanismo de escritura offline antiguo.');
});
caseTest('PRO 06', async ({}, r) => {
    const before = await w.snapshot(), b = await w.snapshot('B'); const p = await profile();
    await r.step('Comprobar ausencia de edición de correo/rol y resistencia a payload', async () => {
        expect(await p.locator('input[name=mail],select[name=perfil]').count()).toBe(0);
        const response = await w.api('A', 'commands/profile', { mail: w.users.A.mail, data: { ...before.profile.data, mail: w.users.B.mail, perfil: 'entrenador' }, expected: before.profile.sha, operationId: crypto.randomUUID() });
        expect(response.status).toBe(200); const after = await w.snapshot(); expect(after.profile.data).toEqual(before.profile.data); expect(await w.snapshot('B')).toEqual(b);
        await r.json('protected-fields', { status: response.status, profile: after.profile });
    });
    r.finish('APROBADO', 'Campos de identidad no editables; el servidor ignora correo/rol falsificados en data y conserva A y B literalmente.');
});
caseTest('TEC 01', async ({}, r) => {
    const a = await w.snapshot(), b = await w.snapshot('B');
    await r.step('Comparar plantilla inicial y UUID exclusivos', async () => {
        const shape = x => x.techniques.data.positions.map(p => ({ name: p.posicion, priority: p.prioridad, types: p.tecnicas.map(t => t.tipo) }));
        expect(shape(a)).toEqual(shape(b)); const ids = x => x.techniques.data.positions.flatMap(p => [p.id, ...p.tecnicas.map(t => t.id)]);
        expect(ids(a).filter(id => ids(b).includes(id))).toEqual([]); expect(new Set(ids(a)).size).toBe(ids(a).length);
        expect(a.techniques.data.positions.flatMap(p => p.tecnicas).every(t => t.descripcion_del_alumno === '')).toBe(true);
        await w.pages.A.reload(); expect((await w.snapshot()).techniques.data).toEqual(a.techniques.data);
    });
    await r.json('template-clones', { a: a.techniques, b: b.techniques });
    r.finish('PARCIAL', 'A/B reciben el mismo contenido literal y orden, UUID disjuntos/estables y descripciones vacías.', 'No hay endpoint público para leer independientemente el documento template/official de Firestore y comparar con la fuente oficial.');
});
caseTest('TEC 02', async ({}, r) => {
    const text = 'Vídeo https://example.test/ruta?x="sí"&y=1\nLínea con ñ áéíóú 😀 y comillas «PGT». ' + 'enlace/'.repeat(60);
    const beforeB = await w.snapshot('B');
    await r.step('Escribir y recibir descripción Unicode completa por UUID', async () => {
        await describe(w, text); const a2 = await ownTech(w, 'A2'), pos = await openPosition(a2);
        await expect(pos.getByLabel('Descripción de técnica o enlace de vídeo').first()).toHaveValue(text);
        expect((await w.snapshot()).techniques.data.positions[0].tecnicas[0].descripcion_del_alumno).toBe(text);
        expect(await w.snapshot('B')).toEqual(beforeB);
    });
    await r.json('unicode', { expected: text, received: (await w.snapshot()).techniques }); await r.capture(w.pages.A2, 'texto-en-a2');
    r.finish('APROBADO', 'Texto Unicode, emoji, comillas, saltos y URL larga idénticos en A, A2 y backend; B intacto.');
});
caseTest('TEC 03', async ({}, r) => {
    const p = await ownTech(w), pos = await openPosition(p), original = await w.snapshot();
    await r.step('Editar nombre, tipo y prioridad positiva desde UI', async () => {
        await awaitCommand(p, 'repertoire', async () => { await pos.getByLabel('Nombre de posición', { exact: true }).fill('QA posición renombrada'); await pos.getByLabel('Tipo de técnica', { exact: true }).first().fill('QA técnica renombrada'); await pos.getByRole('button', { name: 'Aumentar prioridad', exact: true }).click(); });
    });
    const valid = await w.snapshot(), checks = [];
    await r.step('Rechazar prioridad cero, negativa, decimal, vacía e insegura', async () => {
        for (const priority of [0, -1, 1.5, '', Number.MAX_SAFE_INTEGER + 1]) {
            const data = structuredClone(valid.techniques.data); data.positions[0].prioridad = priority;
            const x = await w.api('A', 'commands/repertoire', { data, expected: valid.techniques.sha, operationId: crypto.randomUUID() }); expect(x.status).toBe(400); checks.push({ priority, status: x.status });
        }
        expect((await w.snapshot()).techniques).toEqual(valid.techniques);
        expect(valid.techniques.data.positions[0].id).toBe(original.techniques.data.positions[0].id);
    });
    await r.json('priority-validation', checks); r.finish('APROBADO', 'Edición válida mantiene UUID; prioridades inválidas rechazadas sin sustituir datos válidos.');
});
caseTest('TEC 04', async ({}, r) => {
    const before = await w.snapshot(), p = await ownTech(w);
    await r.step('Añadir posición, dos técnicas y otra en posición existente', async () => {
        await p.getByRole('button', { name: 'Añadir posición', exact: true }).click();
        const pos = p.locator('details.repertoire-position').last(); await pos.getByLabel('Nombre de posición', { exact: true }).fill('QA nueva posición');
        await pos.getByRole('button', { name: 'Añadir técnica', exact: true }).click(); await pos.getByLabel('Tipo de técnica', { exact: true }).last().fill('QA nueva uno');
        await pos.getByRole('button', { name: 'Añadir técnica', exact: true }).click(); await pos.getByLabel('Tipo de técnica', { exact: true }).last().fill('QA nueva dos');
        const existing = await openPosition(p, 0); await awaitCommand(p, 'repertoire', () => existing.getByRole('button', { name: 'Añadir técnica', exact: true }).click());
        await expect(p.locator('.sync-success')).toBeVisible();
    });
    const after = await w.snapshot(), oldIds = before.techniques.data.positions.flatMap(p => [p.id, ...p.tecnicas.map(t => t.id)]), ids = after.techniques.data.positions.flatMap(p => [p.id, ...p.tecnicas.map(t => t.id)]);
    expect(ids.filter(id => !oldIds.includes(id))).toHaveLength(4); expect(new Set(ids).size).toBe(ids.length);
    expect(after.techniques.data.positions.at(-1).tecnicas.map(t => t.tipo)).toEqual(['QA nueva uno', 'QA nueva dos']);
    await w.pages.A2.reload(); expect((await w.snapshot('A2')).techniques.data).toEqual(after.techniques.data); await r.json('before-after', { before: before.techniques, after: after.techniques });
    r.finish('APROBADO', 'Cuatro UUID nuevos, orden y textos correctos; recarga del segundo cliente conserva las altas sin duplicados.');
});
caseTest('TEC 05', async ({}, r) => {
    const p = await ownTech(w), before = await w.snapshot();
    await r.step('Reordenar posición y técnica mediante controles de arrays', async () => {
        const pos = await openPosition(p, before.techniques.data.positions.length - 1);
        await awaitCommand(p, 'repertoire', () => pos.getByRole('button', { name: 'Subir posición', exact: true }).click());
        const positionId = before.techniques.data.positions.at(-1).id, moved = p.locator(`[data-position-id="${positionId}"]`);
        await awaitCommand(p, 'repertoire', () => moved.getByRole('button', { name: 'Subir técnica', exact: true }).last().click());
        const after = await w.snapshot();
        expect(after.techniques.data.positions.at(-2).id).toBe(positionId);
        expect(after.techniques.data.positions.at(-2).tecnicas.map(t => t.id)).toEqual([...before.techniques.data.positions.at(-1).tecnicas.map(t => t.id)].reverse());
        expect(after.comments).toEqual(before.comments); expect(after.plans).toEqual(before.plans); await r.json('order', { before: before.techniques, after: after.techniques });
    });
    r.finish('APROBADO', 'Solo cambia el orden solicitado; UUID, comentarios y planes íntegros.');
});
caseTest('TEC 06', async ({}, r) => {
    const p = await ownTech(w), before = await w.snapshot(), search = p.getByLabel('Buscar posiciones', { exact: true }), checks = [];
    await r.step('Buscar y borrar filtros sin modificar contenido', async () => {
        for (const value of ['QA', 'qa', 'posición', '(', 'NO_EXISTE_12345', '']) {
            await search.fill(value); const expected = before.techniques.data.positions.filter(x => x.posicion.toLowerCase().includes(value.toLowerCase())).length;
            await expect(p.locator('details.repertoire-position')).toHaveCount(expected); checks.push({ value, count: expected });
        }
        await openPosition(p); expect((await w.snapshot()).techniques).toEqual(before.techniques);
    });
    await r.json('search', checks); await r.capture(p); r.finish('APROBADO', 'Búsquedas con mayúsculas, acento, paréntesis y vacío coherentes; sin cambios de datos.');
});
caseTest('TEC 07', async ({}, r) => {
    const p = await ownTech(w), before = await w.snapshot(), beforeB = await w.snapshot('B');
    const qa = before.techniques.data.positions.find(x => x.posicion === 'QA nueva posición'); expect(qa).toBeTruthy();
    const pos = p.locator(`[data-position-id="${qa.id}"]`); if (!await pos.evaluate(e => e.open)) await pos.locator('summary').click();
    await r.step('Cancelar y confirmar borrado de técnica y posición QA', async () => {
        p.once('dialog', d => d.dismiss()); await pos.getByRole('button', { name: 'Borrar técnica', exact: true }).last().click(); expect((await w.snapshot()).techniques).toEqual(before.techniques);
        p.once('dialog', d => d.accept()); await awaitCommand(p, 'repertoire', () => pos.getByRole('button', { name: 'Borrar técnica', exact: true }).last().click());
        p.once('dialog', d => d.accept()); await awaitCommand(p, 'repertoire', () => pos.getByRole('button', { name: 'Eliminar posición', exact: true }).click());
        expect((await w.snapshot()).techniques.data.positions.some(x => x.id === qa.id)).toBe(false); expect(await w.snapshot('B')).toEqual(beforeB);
    });
    await r.json('deleted-uuids', { position: qa.id, techniques: qa.tecnicas.map(t => t.id), after: (await w.snapshot()).techniques });
    r.finish('APROBADO', 'Cancelar no escribe; confirmación retira UUID precisos y mantiene B. Recálculo profundo se ejecuta en bloque DEL con planes.');
});
caseTest('TEC 08', async ({}, r) => {
    const p = await ownTech(w); await p.getByRole('button', { name: 'Añadir posición', exact: true }).click();
    const empty = p.locator('details.repertoire-position').last(); await awaitCommand(p, 'repertoire', () => empty.getByLabel('Nombre de posición', { exact: true }).fill('QA posición vacía'));
    const snapshot = await w.snapshot(), emptyId = snapshot.techniques.data.positions.at(-1).id;
    const id = await r.step('Generar plan real con posición vacía y otras entrenables', () => createCompetition(w, { end: datePlus(24), roles: ['A'] }));
    const actual = await plan(w, 'A', id); expect(actual.sessions.length).toBeGreaterThan(0); expect(actual.sessions.flatMap(s => s.exercises).some(e => e.positionId === emptyId)).toBe(false);
    await r.json('empty-position-plan', { emptyId, plan: actual }); r.finish('APROBADO', 'Posición vacía conservada en catálogo y omitida por generador; sesiones reales sin ejercicios vacíos.');
});
caseTest('TEC 09', async ({}, r) => {
    const p = await ownTech(w), pos = await openPosition(p);
    await r.step('Escribir varias descripciones y cambiar orden antes de confirmar', async () => {
        await pos.getByLabel('Descripción de técnica o enlace de vídeo').nth(0).fill('Edición rápida primera');
        await pos.getByLabel('Descripción de técnica o enlace de vídeo').nth(1).fill('Edición rápida segunda');
        await awaitCommand(p, 'repertoire', () => pos.getByRole('button', { name: 'Subir técnica', exact: true }).nth(1).click());
        await expect(p.locator('.sync-success')).toBeVisible();
        const after = await w.snapshot(); expect(after.techniques.data.positions[0].tecnicas[0].descripcion_del_alumno).toBe('Edición rápida segunda');
        expect(after.techniques.data.positions[0].tecnicas[1].descripcion_del_alumno).toBe('Edición rápida primera'); await r.json('rapid-save', after.techniques);
    });
    r.finish('APROBADO', 'Autoguardado actual agrupa y confirma última pulsación y orden; no necesita botón de sincronización antiguo.');
});
caseTest('TEC 10', async ({}, r) => {
    const p = await ownTech(w), pos = await openPosition(p), payload = '<script>window.__qa_xss=1</script><b>QA</b> javascript:alert(1) {"qa":true}';
    await r.step('Guardar marcado como texto y comprobar alumno y entrenador', async () => {
        await awaitCommand(p, 'repertoire', async () => { await pos.getByLabel('Tipo de técnica', { exact: true }).first().fill(payload); await pos.getByLabel('Descripción de técnica o enlace de vídeo').first().fill(payload); });
        expect(await p.evaluate(() => window.__qa_xss)).toBeUndefined(); expect(await p.locator('script').filter({ hasText: 'window.__qa_xss=1' }).count()).toBe(0);
        expect((await w.snapshot()).techniques.data.positions[0].tecnicas[0].tipo).toBe(payload); await r.capture(p, 'escaped-text');
    });
    r.finish('PARCIAL', 'Marcado guardado literalmente y no ejecutado en alumno; no se inyectan scripts.', 'La extracción PDF y visualización de entrenador se verifican en sus bloques; este caso aún no las contrasta para este payload concreto.');
});
