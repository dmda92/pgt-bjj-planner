import { test } from '@playwright/test';
import { caseTest, expect, campaign } from '../helpers/case-test.mjs';
import { getWorld } from '../helpers/remote-world.mjs';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
let w;
test.afterAll(async () => { await w?.close(); });
caseTest('PRE 01', async ({ browser }, r) => {
    const response = await r.step('Consultar versión DEV real y comprobar el commit integrado', async () => {
        const context = await browser.newContext(); const page = await context.newPage();
        await page.goto('https://pgt-github-probe-dev.david-dzm5.workers.dev/api/dev/runtime');
        const value = JSON.parse(await page.locator('body').innerText()); await context.close();
        expect(value.project).toBe('pgt-bjj-dev');
        const commit = execFileSync('git', ['rev-parse', 'origin/develop'], { encoding: 'utf8' }).trim();
        expect(value.build).toBe(commit); expect(value.domainBuild).toBe(commit); return value;
    });
    await r.json('version', { ...response, os: process.platform, chromium: browser.version(), profiles: ['T', 'A', 'A2', 'B'], device: 'Ordenador Windows; Chromium headless; no Android/iOS físico' });
    writeFileSync(resolve(campaign, 'build.json'), JSON.stringify(response, null, 2));
    r.finish('APROBADO', 'URL DEV, Worker y coordinador sirven el commit de origin/develop. Chromium local identificado y perfiles independientes previstos; no se declara cobertura de móviles físicos.');
});
caseTest('PRE 02', async ({}, r) => {
    w = await getWorld();
    await r.step('Entrar como entrenador QA autorizado en perfil T', () => w.login('T'));
    await r.step('Registrar alumno A nuevo desde formulario', () => w.register('A'));
    await r.step('Registrar alumno B nuevo desde formulario', () => w.register('B'));
    await r.step('Registrar alumno C de restauración desde formulario', () => w.register('C'));
    await r.step('Abrir A en segundo perfil independiente A2', async () => { w.users.A2 = w.users.A; w.persist(); await w.login('A2', 'A'); });
    for (const role of ['A', 'B', 'C']) expect((await w.snapshot(role)).profile.data.perfil).toBe('alumno');
    expect((await w.snapshot('T')).profile.data.perfil).toBe('entrenador');
    r.result.users = ['T', 'A', 'A2', 'B', 'C']; await r.json('users', JSON.parse(readFileSync(resolve(campaign, 'users.json'), 'utf8')));
    await r.capture(w.pages.A, 'alumno-a');
    r.finish('APROBADO', 'T autenticado; A/B/C registrados mediante UI con identidad única de campaña y rol alumno confirmado por backend; A2 mantiene almacenamiento independiente.');
});
caseTest('PRE 03', async ({}, r) => {
    w ||= await getWorld();
    const snapshots = {};
    for (const role of ['A', 'B', 'T']) {
        await w.login(role); snapshots[role] = await r.step('Inventario de fuentes, versiones y planes ' + role, () => w.snapshot(role));
    }
    await r.json('initial-snapshots', snapshots);
    writeFileSync(resolve(campaign, 'initial-snapshots.json'), JSON.stringify(snapshots, null, 2));
    r.finish('APROBADO', 'Inventario inicial separado de A/B/T con fuentes, índices, planes y versiones opacas obtenidas de endpoints autorizados.', 'Verificación mediada por el backend y su caché; no equivale a lectura independiente directa de Firestore.');
});
caseTest('PRE 04', async ({}, r) => {
    w ||= await getWorld(); await w.login('A'); w.users.A2 ||= w.users.A; await w.login('A2', 'A');
    await r.step('Comprobar IndexedDB/localStorage de perfiles independientes', async () => {
        await w.pages.A.evaluate(() => localStorage.setItem('qa-independence', 'A'));
        expect(await w.pages.A2.evaluate(() => localStorage.getItem('qa-independence'))).toBeNull();
        expect(await w.pages.A.evaluate(async () => (await indexedDB.databases()).length)).toBeGreaterThan(0);
    });
    await r.step('Corte real de transporte Chromium y restauración', async () => {
        await w.contexts.A2.setOffline(true);
        expect(await w.pages.A2.evaluate(async () => { try { await fetch('/api/dev/runtime?qa=offline'); return false; } catch { return true; } })).toBe(true);
        await w.contexts.A2.setOffline(false);
    });
    await r.json('network', { separateProfiles: true, chromiumNetworkOffline: true, physicalWifiAndMobileData: false });
    r.finish('PARCIAL', 'Almacenes independientes y corte de transporte Chromium comprobados.', 'No hay dos Android físicos ni acceso a sus radios WiFi/datos móviles/modo avión.');
});
