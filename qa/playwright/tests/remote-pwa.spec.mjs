import { test, chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { caseTest, expect, campaign } from '../helpers/case-test.mjs';
const baseURL = 'https://pgt-github-probe-dev.david-dzm5.workers.dev';
let context, page;
test.beforeAll(async () => {
    const users = JSON.parse(readFileSync(resolve(campaign, 'users.private.json'), 'utf8'));
    context = await chromium.launchPersistentContext(resolve(campaign, 'profiles', 'C'), { headless: true, viewport: { width: 1440, height: 1000 } });
    await context.route('**/api/v2/commands/**', route => route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"QA_READONLY_PWA_CONTEXT"}' }));
    page = context.pages()[0] || await context.newPage(); await page.goto(baseURL);
    await page.getByRole('button', { name: 'Salir', exact: true }).or(page.getByLabel('Correo', { exact: true })).first().waitFor({ timeout: 60000 });
    if (await page.getByLabel('Correo', { exact: true }).count()) {
        await page.getByLabel('Correo', { exact: true }).fill(users.C.mail); await page.getByLabel('Contraseña', { exact: true }).fill(users.C.password);
        await page.getByRole('button', { name: 'Entrar', exact: true }).click(); await page.getByRole('heading', { name: 'Tu repertorio' }).waitFor({ timeout: 60000 });
    }
});
test.afterAll(async () => context?.close());
caseTest('PWA 01', { users: ['C'], environment: 'DEV real; Chromium Windows' }, async ({}, r) => {
    await r.step('Verificar manifest, service worker e intentar instalación en Chromium aislado', async () => {
        const manifest = await page.evaluate(async () => ({ manifest: await (await fetch(document.querySelector('link[rel=manifest]').href)).json(), sw: !!(await navigator.serviceWorker.ready).active }));
        expect(manifest.sw).toBe(true); expect(manifest.manifest.icons.some(i => i.sizes.includes('512'))).toBe(true);
        const cdp = await context.newCDPSession(page); let install;
        try { await cdp.send('PWA.install', { manifestId: baseURL + '/', installUrlOrBundleUrl: baseURL + '/' }); install = 'installed'; await cdp.send('PWA.uninstall', { manifestId: baseURL + '/' }); }
        catch (error) { install = String(error.message).slice(0, 500); }
        await r.json('installation', { ...manifest, chromiumInstallationAttempt: install }); await r.capture(page, 'desktop-pwa');
    });
    r.finish('PARCIAL', 'Manifest/iconos oficiales y service worker activos comprobados; intento de instalación registrado en perfil de QA.', 'No hay dos dispositivos Android físicos para instalar/abrir desde sus iconos ni volver de segundo plano.');
});
caseTest('PWA 02', { users: ['C'], environment: 'DEV real; Chromium con viewports' }, async ({}, r) => {
    const measurements = [];
    await r.step('Recorrer 360/390/768/1280px, paisaje y foco de teclado', async () => {
        for (const [width, height] of [[360, 800], [390, 844], [768, 1024], [1280, 900], [844, 390]]) {
            await page.setViewportSize({ width, height }); await page.getByRole('button', { name: 'Mis técnicas', exact: true }).click();
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth); expect(overflow).toBe(false);
            await r.capture(page, `viewport-${width}x${height}`); measurements.push({ width, height, overflow });
        }
        await page.getByRole('button', { name: 'Perfil', exact: true }).click(); await page.getByLabel('Nombre', { exact: true }).focus();
        expect(await page.getByLabel('Nombre', { exact: true }).evaluate(e => e === document.activeElement)).toBe(true);
    });
    await r.json('viewports', measurements); r.finish('PARCIAL', 'Pantallas estrechas y paisaje sin desbordamiento; foco de campos y legibilidad capturados.', 'Viewport no equivale a giro/teclado virtual Android físico. Temporizador min:seg se ejercita en COM02 con UI real.');
});
caseTest('PWA 03', { users: ['C'], environment: 'DEV real; teclado Chromium' }, async ({}, r) => {
    await r.step('Navegar con Tab, activar formulario y validar error asociado', async () => {
        await page.setViewportSize({ width: 1280, height: 900 }); await page.getByRole('button', { name: 'Perfil', exact: true }).click();
        await page.keyboard.press('Tab'); const focus = await page.evaluate(() => ({ tag: document.activeElement.tagName, outline: getComputedStyle(document.activeElement).outlineStyle }));
        expect(focus.tag).not.toBe('BODY');
        await page.locator('[name=peso]').fill('0'); await page.getByRole('button', { name: 'Guardar en este dispositivo', exact: true }).click();
        await expect(page.locator('[name=peso]')).toHaveAttribute('aria-invalid', 'true');
        const describedBy = await page.locator('[name=peso]').getAttribute('aria-describedby'); expect(describedBy).toBeTruthy(); await expect(page.locator('#' + describedBy)).toBeVisible();
        await r.json('keyboard-a11y', focus); await r.capture(page, 'field-error'); await page.locator('[name=peso]').fill('');
    });
    r.finish('PARCIAL', 'Teclado, foco y error de peso asociado verificados.', 'No se ha usado TalkBack físico; la matriz completa de nombres de ojos/spinners/casillas se reúne en ACC07, COM y ENT.');
});
caseTest('PWA 07', { users: ['C', 'anónimo'], environment: 'DEV real; perfiles independientes' }, async ({ browser }, r) => {
    await r.step('Inspeccionar caché del service worker sin respuestas privadas', async () => {
        await page.evaluate(() => navigator.serviceWorker.ready);
        const cache = await page.evaluate(async () => { const out = []; for (const key of await caches.keys()) for (const request of await (await caches.open(key)).keys()) out.push({ cache: key, path: new URL(request.url).pathname }); return out; });
        expect(cache.some(x => x.path.startsWith('/api/'))).toBe(false); await r.json('service-worker-cache', cache);
    });
    await r.step('Salir del usuario QA y comprobar login sin datos privados ni token',async()=>{
        await page.getByRole('button',{name:'Salir',exact:true}).click();await expect(page.getByLabel('Correo',{exact:true})).toBeVisible();
        expect(await page.evaluate(()=>localStorage.getItem('pgt-session'))).toBeNull();expect(await page.locator('details.repertoire-position').count()).toBe(0);
        const paths=await page.evaluate(async()=>{const all=[];for(const key of await caches.keys())for(const request of await(await caches.open(key)).keys())all.push(new URL(request.url).pathname);return all;});expect(paths.some(p=>p.startsWith('/api/'))).toBe(false);await r.json('after-logout-static-cache',{paths,sessionCleared:true});await r.capture(page,'logged-out');
    });
    await r.step('Primer uso offline en otro perfil no muestra datos privados', async () => {
        const clean = await browser.newContext({ offline: true }), p = await clean.newPage(); let failed = false;
        try { await p.goto(baseURL); } catch { failed = true; } expect(failed).toBe(true);
        expect(await p.locator('details.repertoire-position').count()).toBe(0); await clean.close();
    });
    r.finish('APROBADO', 'Caches públicas solo contienen assets; logout retira sesión y datos visibles. Un perfil independiente en primer uso offline no restaura datos privados ni finge acceso correcto.','Chromium Windows real; no se afirma instalación Android física.');
});
