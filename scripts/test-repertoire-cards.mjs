import {files, api, server, origin} from './qa-recovery-fixture.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const mail = 'cards-pupil@example.com', password = 'synthetic-cards-password';
const request = new Request(origin + '/api/app/register', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({mail, password, confirm: password, nombre: 'Alumno', apellidos: 'Fixture'})
});
assert.equal((await api.handle(request, new URL(request.url))).status, 201);
const source = files.get(`PGT/users_data/${mail}/tecnics.json`);
source.data.positions = source.data.positions.slice(0, 4);
for (const [i, p] of source.data.positions.entries()) {
    p.posicion = ['Guardia cerrada (guardiero)', 'Media guardia (guardiero)', 'Guardia araña (pasador)', 'Nueva posición'][i];
    p.tecnicas = p.tecnicas.slice(0, [3, 2, 1, 0][i]);
    p.tecnicas.forEach((t, j) => {
        t.tipo = ['Sumisión', 'Raspada', 'Transición'][j];
        t.descripcion_del_alumno = i === 1 || i === 0 && j === 0 ? 'Control del agarre y posición de la cadera. https://video.example/tecnica' : '';
    });
}
const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PGT_TEST_CHROMIUM_PATH || undefined,
    args: JSON.parse(process.env.PGT_TEST_CHROMIUM_ARGS || '[]')
});
const context = await browser.newContext({viewport: {width: 1440, height: 1000}}), page = await context.newPage();
page.setDefaultTimeout(20000);
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const positions = page.locator('details.repertoire-position'), first = positions.first();
try {
    await page.goto(origin);
    await page.getByLabel('Correo', {exact: true}).fill(mail);
    await page.getByLabel('Contraseña', {exact: true}).fill(password);
    await page.getByRole('button', {name: 'Entrar', exact: true}).click();
    await page.getByRole('heading', {name: 'Tu repertorio'}).waitFor();
    assert.equal(await positions.count(), 4);
    assert.equal(await first.locator('summary .pill').count(), 0);
    assert.equal(await first.locator('summary .priority-caption').innerText(), 'Prioridad 1');
    assert.equal(await page.locator('.repertoire-position[open]').count(), 0);
    assert.equal(await first.getByLabel('Descripción de técnica o enlace de vídeo').first().isVisible(), false);
    assert.match(await first.locator('summary').innerText(), /3 técnicas/);
    assert.match(await first.locator('summary').innerText(), /2 sin descripción/);
    assert.equal(await first.getByRole('progressbar').getAttribute('aria-valuenow'), '1');
    assert.equal(await positions.nth(1).getAttribute('class'), 'position repertoire-position is-complete');
    assert.match(await positions.last().locator('summary').innerText(), /Sin técnicas/);
    assert.equal(await first.locator('.technique-marks .is-described').count(), 1);
    assert.equal(await first.locator('.technique-marks .is-missing').count(), 2);
    await fs.mkdir('.browser-artifacts/repertoire', {recursive: true});
    for (const width of [1440, 768, 390, 360]) {
        await page.setViewportSize({width, height: 1000});
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({path: `.browser-artifacts/repertoire/compact-${width}.png`, fullPage: true});
    }
    await page.setViewportSize({width: 1440, height: 1000});
    await first.locator('summary').focus();
    await page.keyboard.press('Enter');
    await first.getByLabel('Descripción de técnica o enlace de vídeo').first().waitFor();
    assert.equal(await first.getAttribute('open'), '');
    await context.setOffline(true);
    await first.getByLabel('Descripción de técnica o enlace de vídeo').nth(1).fill('Raspada con control de manga');
    await first.getByLabel('Descripción de técnica o enlace de vídeo').nth(2).fill('Transición hacia montada');
    await page.waitForFunction(() => document.querySelector('.repertoire-position').classList.contains('is-complete'));
    assert.equal(await first.getByRole('progressbar').getAttribute('aria-valuenow'), '3');
    assert.equal(await first.locator('.technique-ready').count(), 3);
    for (const width of [1440, 390, 360]) {
        await page.setViewportSize({width, height: 1000});
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({path: `.browser-artifacts/repertoire/expanded-${width}.png`, fullPage: true});
    }
    await first.getByLabel('Descripción de técnica o enlace de vídeo').nth(2).fill('   ');
    await page.waitForFunction(() => document.querySelector('.repertoire-position').classList.contains('is-incomplete'));
    assert.equal(await first.locator('.technique-pending').count(), 1);
    await first.locator('summary').click();
    assert.equal(await first.getByLabel('Descripción de técnica o enlace de vídeo').first().isVisible(), false);
    await first.locator('summary').click();
    assert.equal(await first.getByLabel('Descripción de técnica o enlace de vídeo').nth(1).inputValue(), 'Raspada con control de manga');
    await page.getByLabel('Buscar posiciones').fill('Media guardia');
    assert.equal(await positions.count(), 1);
    await page.getByLabel('Buscar posiciones').fill('');
    await page.getByRole('status').filter({hasText: /Cambios guardados/}).waitFor();
    await page.reload();
    await page.getByRole('heading', {name: 'Tu repertorio'}).waitFor();
    assert.equal(await page.locator('.repertoire-position[open]').count(), 0);
    assert.equal(await first.getByRole('progressbar').getAttribute('aria-valuenow'), '2');
    await first.locator('summary').click();
    assert.equal(await first.getByLabel('Descripción de técnica o enlace de vídeo').nth(1).inputValue(), 'Raspada con control de manga');
    assert.deepEqual(errors, []);
    console.log('Repertoire cards Chromium: collapsed summary, per-technique statuses, trim-aware live completion, keyboard expansion, retained drafts, filtering, offline reload, empty position and 360/390/768/1440px PASS.');
} finally {
    await browser.close();
    server.close();
}
