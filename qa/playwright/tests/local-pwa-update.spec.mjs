import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { caseTest, expect } from '../helpers/case-test.mjs';
import { createLocalAcademy } from '../helpers/local-academy.mjs';

async function activateNewWorker(academy, page) {
    const source = readFileSync('dist/sw.js', 'utf8');
    const version = 'pgt-app-qa-' + Date.now();
    academy.overrideAsset('/sw.js', source.replace(/const CACHE = [^;]+;/, `const CACHE = "${version}";`) + '\n// QA isolated version ' + version);
    await page.evaluate(async () => { const registration = await navigator.serviceWorker.getRegistration(); await registration.update(); });
    await page.getByRole('button', { name: 'Actualizar aplicación', exact: true }).waitFor({ timeout: 60000 });
    return version;
}
caseTest('PWA 04', { environment: 'PWA/Worker local; Firestore sintético; prefers-reduced-motion', users: ['T local', 'alumno local'] }, async ({ browser }, r) => {
    const a = await createLocalAcademy(), pupil = await a.register('reduced-motion'), context = await browser.newContext({ reducedMotion: 'reduce' }), p = await context.newPage();
    let release; const gate = new Promise(resolve => { release = resolve; });
    try {
        await a.login(p, a.trainer.profile.mail); await p.getByRole('button', { name: 'Entrenador', exact: true }).click();
        await p.route('**/api/v2/users/' + encodeURIComponent(pupil.profile.mail) + '/profile', async route => { await gate; await route.continue(); }, { times: 1 });
        await r.step('Retener ficha, comprobar estado accesible y reducción de movimiento', async () => {
            await p.locator('.student-card').filter({ hasText: pupil.profile.nombre }).click(); await expect(p.getByRole('status', { name: 'Cargando alumno', exact: true })).toBeVisible();
            const css = await p.locator('.student-loading .loading-spinner').evaluate(e => ({ reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, duration: getComputedStyle(e).animationDuration }));
            expect(css.reduced).toBe(true); expect(parseFloat(css.duration)).toBeLessThan(0.1); await r.json('reduced-motion', css); await r.capture(p, 'loading-accessible'); release();
            await expect(p.locator('.student-detail')).toContainText(pupil.profile.mail);
        });
        r.finish('PARCIAL', 'Carga retenida anuncia alumno y respeta movimiento reducido sin volver al placeholder inicial.', 'Creación/guardado/borrado retenidos se comprueban en COM/ENT; falta una comprobación de todos sus spinners bajo la misma preferencia de movimiento.');
    } finally { release(); await context.close(); await a.close(); }
});
caseTest('PWA 05', { environment: 'PWA/Worker local; actualización de service worker aislada', users: ['alumno local'] }, async ({ browser }, r) => {
    const a = await createLocalAcademy(), user = await a.register('update-clean'), context = await browser.newContext(), p = await context.newPage();
    const trace = resolve(r.dir, 'pwa-update-trace.zip');
    try {
        await a.login(p, user.profile.mail); await p.evaluate(() => navigator.serviceWorker.ready); await p.reload(); await p.locator('.sync-success').waitFor();
        await context.tracing.start({ screenshots: true, snapshots: true });
        const before = await a.call('users/' + encodeURIComponent(user.profile.mail) + '/snapshot', undefined, user.token);
        await r.step('Publicar SW nuevo solo en fixture local y actualizar desde UI', async () => {
            const version = await activateNewWorker(a, p);
            await Promise.all([p.waitForEvent('load'), p.getByRole('button', { name: 'Actualizar aplicación', exact: true }).click()]);
            await p.getByRole('heading', { name: 'Tu repertorio' }).waitFor(); await p.locator('.sync-success').waitFor();
            const caches = await p.evaluate(() => window.caches.keys()); expect(caches).toContain(version); expect(caches.filter(k => k.startsWith('pgt-app-'))).toHaveLength(1);
            const after = await a.call('users/' + encodeURIComponent(user.profile.mail) + '/snapshot', undefined, user.token); expect(after).toEqual(before);
            await r.json('update-integrity', { version, caches, before, after }); await r.capture(p, 'updated-pwa');
        });
        r.finish('APROBADO', 'La UI detecta SW nuevo, activa/recarga una sola vez, conserva sesión y negocio íntegro y retira caché estática anterior.', 'Actualización controlada solo en servidor local sintético; no se despliega aplicación ni recursos DEV/PRO.');
    } finally { await context.tracing.stop({ path: trace }).then(() => r.result.evidence.push(trace)).catch(() => {}); await context.close(); await a.close(); }
});
caseTest('PWA 06', { environment: 'PWA/Worker local; HTTP500 y SW nuevo controlados', users: ['alumno local'] }, async ({ browser }, r) => {
    const a = await createLocalAcademy(), user = await a.register('update-draft'), context = await browser.newContext(), p = await context.newPage();
    try {
        await a.login(p, user.profile.mail); await p.evaluate(() => navigator.serviceWorker.ready); await p.reload(); await p.locator('.sync-success').waitFor();
        await p.locator('details.repertoire-position > summary').first().click();
        await p.route('**/api/v2/commands/repertoire', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"QA_UNCONFIRMED_SAVE"}' }));
        await r.step('Conservar texto cuyo autoguardado falla y preparar actualización', async () => {
            await p.getByLabel('Descripción de técnica o enlace de vídeo').first().fill('BORRADOR QUE DEBE SOBREVIVIR A ACTUALIZAR');
            await p.getByRole('button', { name: 'Reintentar guardado', exact: true }).waitFor(); await r.capture(p, 'pending-before-update');
            await activateNewWorker(a, p); await p.unroute('**/api/v2/commands/repertoire');
        });
        await r.step('Intentar actualizar con borrador pendiente y comprobar recuperación', async () => {
            const loaded = p.waitForEvent('load', { timeout: 15000 }).then(() => true).catch(() => false);
            await p.getByRole('button', { name: 'Actualizar aplicación', exact: true }).click(); const reloaded = await loaded;
            if (reloaded) { await p.getByRole('heading', { name: 'Tu repertorio' }).waitFor(); await p.locator('details.repertoire-position > summary').first().click(); }
            const text = await p.getByLabel('Descripción de técnica o enlace de vídeo').first().inputValue(); await r.capture(p, 'after-update-attempt');
            await r.json('draft-update', { reloaded, textRetained: text.includes('BORRADOR QUE DEBE'), retryVisible: !!await p.getByRole('button', { name: 'Reintentar guardado', exact: true }).count() });
            if (!text.includes('BORRADOR QUE DEBE')) { r.result.incident = 'PWA-06-FAILED-DRAFT-LOST-UPDATE'; r.result.severity = 'ALTA'; r.finish('FALLIDO', 'Actualizar aplicación permite recargar con autoguardado fallido y se pierde el texto pendiente.', 'Se adapta el antiguo pendiente offline a borrador online cuyo guardado falla, funcionalmente equivalente para proteger cambios.'); }
            else r.finish('APROBADO', 'Actualizar no pierde el borrador fallido y ofrece recuperación explícita.');
        });
    } finally { await context.close(); await a.close(); }
});
caseTest('PRE 07', { environment: 'Chromium + interceptación controlada; sin escrituras de negocio', users: ['anónimo'] }, async ({ browser }, r) => {
    const context = await browser.newContext(), p = await context.newPage(), checks = []; await p.goto('https://pgt-github-probe-dev.david-dzm5.workers.dev');
    const trace = resolve(r.dir, 'controlled-faults-trace.zip');
    try {
        await context.tracing.start({ screenshots: true, snapshots: true });
        await r.step('Preparar HTTP409/422/429/500 y fallo de transporte', async () => {
            for (const status of [409, 422, 429, 500]) {
                await p.route('**/qa-controlled-fault', route => route.fulfill({ status, contentType: 'application/json', headers: status === 429 ? { 'Retry-After': '1' } : {}, body: '{"error":"QA_CONTROLLED"}' }), { times: 1 });
                const received = await p.evaluate(async () => { const response = await fetch('/qa-controlled-fault'); return response.status; }); expect(received).toBe(status); checks.push({ injected: status, received });
            }
            await p.route('**/qa-controlled-fault', route => route.abort('timedout'), { times: 1 });
            expect(await p.evaluate(async () => { try { await fetch('/qa-controlled-fault'); return false; } catch { return true; } })).toBe(true); checks.push({ transportTimeout: true });
        });
        await r.json('controlled-faults', checks); await r.capture(p, 'public-profile');
        r.finish('PARCIAL', 'Infraestructura de fallos HTTP y timeout comprobada sin mutaciones remotas.', 'Respuesta perdida tras commit se ensaya en COM12/SYN; este registro prepara los transportes y no acredita por sí solo recuperación de negocio.');
    } finally { await context.tracing.stop({ path: trace }).then(() => r.result.evidence.push(trace)).catch(() => {}); await context.close(); }
});
