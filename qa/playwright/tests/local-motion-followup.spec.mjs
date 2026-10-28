import { caseTest, expect } from '../helpers/case-test.mjs';
import { createLocalAcademy } from '../helpers/local-academy.mjs';
import { datePlus } from '../helpers/remote-actions.mjs';

caseTest('PWA 04', {
  environment: 'Chromium escritorio con reducedMotion; PWA/Worker local real y transporte Firestore sintético',
  users: ['entrenador local', 'alumno local'],
  adaptation: 'Estados actuales de operaciones online; no se utiliza el mecanismo antiguo de sincronización manual.'
}, async ({ browser }, r) => {
  r.includePrevious();
  const academy = await createLocalAcademy();
  const pupil = await academy.register('motion-spinners');
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  const releases = [];
  const checks = [];
  async function hold(path) {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    releases.push(release);
    await page.route(`**${path}`, async route => { await gate; await route.continue(); }, { times: 1 });
    return release;
  }
  async function inspect(status, label, control) {
    await expect(status).toBeVisible();
    await expect(status).toContainText(label);
    const spinner = status.locator('.loading-spinner');
    await expect(spinner).toHaveAttribute('aria-hidden', 'true');
    const computed = await spinner.evaluate(element => ({
      mediaMatches: matchMedia('(prefers-reduced-motion: reduce)').matches,
      duration: getComputedStyle(element).animationDuration,
      iterationCount: getComputedStyle(element).animationIterationCount,
      parentRole: element.closest('[role]')?.getAttribute('role')
    }));
    expect(computed.mediaMatches).toBe(true);
    expect(parseFloat(computed.duration)).toBeLessThan(0.1);
    expect(computed.parentRole).toBe('status');
    if (control) await expect(control).toBeDisabled();
    checks.push({ state: label, accessibleText: await status.innerText(), ...computed });
    await r.capture(page, label.split(' ')[0].toLowerCase());
  }
  try {
    await academy.login(page, academy.trainer.profile.mail);
    await page.getByRole('button', { name: 'Entrenador', exact: true }).click();
    await r.step('Retener carga de alumno con estado textual y sin placeholder inicial', async () => {
      const release = await hold('/api/v2/users/' + encodeURIComponent(pupil.profile.mail) + '/profile');
      await page.locator('.student-card').filter({ hasText: pupil.profile.nombre }).click();
      const status = page.getByRole('status', { name: 'Cargando alumno', exact: true });
      await inspect(status, 'Cargando alumno');
      await expect(page.locator('.student-workspace .student-placeholder:not(.student-loading)')).toHaveCount(0);
      release();
      await expect(page.locator('.student-detail')).toContainText(pupil.profile.mail);
    });
    await page.getByRole('button', { name: 'Competiciones', exact: true }).click();
    await page.getByRole('button', { name: 'Nueva competición', exact: true }).click();
    const form = page.locator('.competition-create');
    await form.getByLabel('Fecha inicial', { exact: true }).fill(datePlus(1));
    await form.getByLabel('Fecha del torneo', { exact: true }).fill(datePlus(8));
    await form.locator(`[name=student][value="${pupil.profile.mail}"]`).check();
    await r.step('Retener alta y comprobar spinner textual y botón bloqueado bajo movimiento reducido', async () => {
      const release = await hold('/api/v2/commands/competition');
      const response = page.waitForResponse(x => x.url().endsWith('/api/v2/commands/competition'));
      const control = form.getByRole('button', { name: 'Crear competición', exact: true });
      await control.click();
      await inspect(page.getByRole('status', { name: 'Creando competición', exact: true }), 'Creando competición', control);
      release();
      expect((await response).status()).toBe(200);
      await expect(form).toHaveCount(0);
    });
    const card = page.locator('.competition-card');
    await expect(card).toHaveCount(1);
    await card.locator(`[name=student][value="${academy.trainer.profile.mail}"]`).check();
    await r.step('Retener guardado de participantes y comprobar estado accesible y bloqueo', async () => {
      const release = await hold('/api/v2/commands/assignment');
      const response = page.waitForResponse(x => x.url().endsWith('/api/v2/commands/assignment'));
      const control = card.getByRole('button', { name: 'Guardar datos', exact: true });
      await control.click();
      await inspect(card.locator('[role=status]').filter({ hasText: 'Guardando participantes' }), 'Guardando participantes', control);
      release();
      expect((await response).status()).toBe(200);
      await expect(card.locator('[role=status]')).toHaveCount(0);
    });
    await r.step('Retener borrado y comprobar estado textual, movimiento reducido y retirada final', async () => {
      const release = await hold('/api/v2/commands/delete-competition');
      const response = page.waitForResponse(x => x.url().endsWith('/api/v2/commands/delete-competition'));
      page.once('dialog', dialog => dialog.accept());
      const control = card.getByRole('button', { name: 'Borrar competición completa', exact: true });
      await control.click();
      await inspect(page.getByRole('status', { name: 'Borrando competición', exact: true }), 'Borrando competición', control);
      release();
      expect((await response).status()).toBe(200);
      await expect(card).toHaveCount(0);
    });
    await r.json('all-motion-states', checks);
    r.finish('APROBADO', 'Carga, creación, guardado y borrado retenidos tienen estado textual accesible; todos los spinners respetan reducedMotion. El placeholder inicial no reaparece al seleccionar y los controles impiden doble envío.',
      'Variante Chromium de escritorio y persistencia sintética local. No acredita ajustes de accesibilidad de Android/iOS físicos.');
  } finally {
    for (const release of releases) release();
    await context.close();
    await academy.close();
  }
});
