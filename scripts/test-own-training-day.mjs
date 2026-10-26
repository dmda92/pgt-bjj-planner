import {files, api, server, origin} from './qa-recovery-fixture.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const password = 'synthetic-own-day-password';

async function call(path, method = 'GET', body, token = '') {
    const req = new Request(origin + path, {
        method,
        headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'},
        body: body ? JSON.stringify(body) : undefined
    });
    const response = await api.handle(req, new URL(req.url));
    assert.ok(response.ok, `${path}: ${response.status}`);
    return response.json();
}

async function register(mail) {
    return (await call('/api/app/register', 'POST', {
        mail,
        password,
        confirm: password,
        nombre: mail.split('@')[0],
        apellidos: 'Fixture'
    })).token;
}

const teacher = 'own-day-trainer@example.com', pupil = 'own-day-pupil@example.com', other = 'own-day-other@example.com';
const token = await register(teacher);
files.get(`PGT/users_data/${teacher}/user_data.json`).data.perfil = 'entrenador';
await register(pupil);
await register(other);
const competition = {
    fecha_comienzo: '2026-10-16',
    fecha_torneo: '2026-10-30',
    alumnos: [pupil],
    dias_de_entrenamiento: [1, 3],
    ejercicios_por_sesion: 2,
    tiempo_por_tecnica_segundos: 180,
    descanso_entre_ciclos_segundos: 10,
    descanso_entre_tecnicas_segundos: 20
};
await call('/api/app/competition', 'POST', {competition, sha: null}, token);
const cat = files.get('PGT/master_data/plans.json');
await call('/api/app/competition', 'POST', {
    competition: {
        ...competition,
        fecha_torneo: '2026-11-05',
        dias_de_entrenamiento: [1, 4],
        ejercicios_por_sesion: 3
    }, sha: cat.sha
}, token);
const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PGT_TEST_CHROMIUM_PATH || undefined,
    args: JSON.parse(process.env.PGT_TEST_CHROMIUM_ARGS || '[]')
});
const context = await browser.newContext({viewport: {width: 1440, height: 1000}, locale: 'es-ES'});
await context.addInitScript(() => {
    const NativeDate = Date;
    const fixed = '2026-10-16T10:00:00Z';
    globalThis.Date = class extends NativeDate {
        constructor(...args) {
            super(...(args.length ? args : [fixed]));
        }

        static now() {
            return new NativeDate(fixed).valueOf();
        }
    };
});
const page = await context.newPage();
page.setDefaultTimeout(20000);
const errors = [];
page.on('pageerror', e => errors.push(e.message));

async function login(mail) {
    await page.getByLabel('Correo', {exact: true}).fill(mail);
    await page.getByLabel('Contraseña', {exact: true}).fill(password);
    await page.getByRole('button', {name: 'Entrar', exact: true}).click();
    await page.getByRole('heading', {name: 'Tu repertorio'}).waitFor();
}

const day = page.getByRole('region', {name: 'Mis entrenamientos del día', exact: true}),
    complete = page.getByRole('region', {name: 'Planes completos', exact: true});
try {
    await page.goto(origin);
    await login(pupil);
    await page.getByRole('button', {name: /^Mis planes/}).click();
    assert.equal(await page.getByLabel('Fecha de mis entrenamientos').inputValue(), '2026-10-19');
    assert.equal(await day.locator('.own-session-card').count(), 2);
    assert.deepEqual(await day.locator('.own-session-card h3').allTextContents(), ['Torneo · 2026-10-30', 'Torneo · 2026-11-05']);
    assert.equal(await day.locator('.exercise').count(), 5);
    assert.equal(await day.locator('.priority-caption').count(), 5);
    assert.doesNotMatch(await day.innerText(), /\bP\d+\b/);
    assert.equal(await complete.locator('.plan-card').count(), 0);
    const boxes = await Promise.all([day.boundingBox(), complete.boundingBox()]);
    assert.ok(boxes[0].y < boxes[1].y);
    await page.getByLabel('Mi plan', {exact: true}).selectOption({index: 1});
    assert.equal(await complete.locator('.plan-card').count(), 1);
    assert.ok(await complete.locator('.session').count() > 1);
    assert.equal(await day.locator('.own-session-card').count(), 2);
    await page.getByLabel('Fecha de mis entrenamientos').fill('2026-10-21');
    assert.equal(await day.locator('.own-session-card').count(), 1);
    assert.equal(await page.getByLabel('Mi plan', {exact: true}).inputValue() !== '', true);
    await page.getByLabel('Fecha de mis entrenamientos').fill('2026-10-24');
    await day.getByText('No tienes sesiones para esta fecha.').waitFor();
    await page.getByLabel('Fecha de mis entrenamientos').fill('2026-10-19');
    await fs.mkdir('.browser-artifacts/own-day', {recursive: true});
    for (const width of [1440, 390]) {
        await page.setViewportSize({width, height: 1000});
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({path: `.browser-artifacts/own-day/day-${width}.png`, fullPage: true});
    }
    await context.setOffline(true);
    await page.reload();
    await page.getByRole('button', {name: /^Mis planes/}).click();
    assert.equal(await page.getByLabel('Fecha de mis entrenamientos').inputValue(), '2026-10-19');
    assert.equal(await day.locator('.own-session-card').count(), 2);
    await page.getByLabel('Fecha de mis entrenamientos').fill('2026-10-21');
    assert.equal(await day.locator('.own-session-card').count(), 1);
    await context.setOffline(false);
    await page.getByRole('button', {name: 'Salir', exact: true}).click();
    await login(other);
    await page.getByRole('button', {name: /^Mis planes/}).click();
    assert.equal(await day.locator('.own-session-card').count(), 0);
    assert.equal(await page.getByLabel('Fecha de mis entrenamientos').inputValue(), '');
    await day.getByText(/No tienes próximos entrenamientos/).waitFor();
    assert.deepEqual(errors, []);
    console.log('Own training day Chromium: future default, multiple plans/day, date changes/empty date, complete plan independence, offline reload, account isolation and desktop/mobile PASS.');
} finally {
    await browser.close();
    server.close();
}
