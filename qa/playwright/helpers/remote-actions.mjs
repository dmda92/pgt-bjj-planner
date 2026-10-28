import { expect } from '@playwright/test';
export const madridToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export function datePlus(n, base = madridToday()) { const d = new Date(base + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export async function ownTech(w, role = 'A') {
    const p = await w.login(role); await p.getByRole('button', { name: 'Mis técnicas', exact: true }).click(); return p;
}
export async function openPosition(page, index = 0) {
    const position = page.locator('details.repertoire-position').nth(index);
    if (!await position.evaluate(e => e.open)) await position.locator('summary').click(); return position;
}
export async function awaitCommand(page, kind, action) {
    const response = page.waitForResponse(r => r.url().endsWith('/api/v2/commands/' + kind) && r.request().method() === 'POST', { timeout: 60000 });
    response.catch(() => {}); // Preserve the action's original error if it fails before a response.
    await action(); const saved = await response;
    expect(saved.status(), `command ${kind}`).toBe(200);
    const body = await saved.json();
    if (kind === 'competition') await expect(page.locator('.competition-create')).toHaveCount(0, { timeout: 60000 });
    return body;
}
export async function describe(w, text, role = 'A', index = 0) {
    const page = await ownTech(w, role), position = await openPosition(page, index);
    const field=position.getByLabel('Descripción de técnica o enlace de vídeo').first();
    if(await field.inputValue()!==text) await awaitCommand(page, 'repertoire', () => field.fill(text));
    await expect(page.locator('.sync-success')).toBeVisible({ timeout: 60000 }); return page;
}
export async function trainer(w, section = 'Equipo') {
    const p = await w.login('T'); await expect(p.getByText('Procesando solicitud…', { exact: true })).toHaveCount(0, { timeout: 60000 });
    await p.getByRole('button', { name: 'Entrenador', exact: true }).click();
    await p.getByRole('button', { name: section, exact: true }).click(); return p;
}
export async function selectStudent(w, role = 'A', section = 'Técnicas') {
    const p = await trainer(w);
    const roster = await w.api('T', 'roster'); expect(roster.status).toBe(200);
    const person = roster.data.data.users.find(user => user.mail === w.users[role].mail); expect(person).toBeTruthy();
    await p.getByLabel('Buscar alumnos', { exact: false }).fill(person.mail);
    await p.locator('.student-card').filter({ has: p.locator('.student-info strong').getByText([person.nombre, person.apellidos].filter(Boolean).join(' '), { exact: true }) }).click();
    await expect(p.locator('.student-detail')).toContainText(w.users[role].mail, { timeout: 60000 });
    if (section !== 'Técnicas') await p.getByRole('button', { name: section, exact: true }).click();
    return p;
}
export async function competitionForm(w) {
    const p = await trainer(w, 'Competiciones');const create=p.getByRole('button',{name:'Nueva competición',exact:true});await expect(create).toBeVisible({timeout:60000});await create.click();
    await expect(p.locator('.competition-create')).toBeVisible(); return p;
}
export async function fillCompetition(w, opts = {}) {
    const p = await competitionForm(w), form = p.locator('.competition-create');
    await form.getByLabel('Fecha inicial', { exact: true }).fill(opts.start || datePlus(-2));
    await form.getByLabel('Fecha del torneo', { exact: true }).fill(opts.end || datePlus(10));
    if (opts.N) await form.locator('[name=sets]').fill(String(opts.N));
    if (opts.work) await form.locator('[name=work]').fill(opts.work);
    for (const value of [1, 2, 3, 4, 5, 6, 7]) await form.locator(`[name=day][value="${value}"]`).setChecked((opts.days || [2, 4]).includes(value));
    for (const role of opts.roles || ['A', 'B']) await form.locator(`[name=student][value="${w.users[role].mail}"]`).check();
    return { p, form };
}
export async function createCompetition(w, opts = {}) {
    const { p, form } = await fillCompetition(w, opts);
    const saved = await awaitCommand(p, 'competition', () => form.getByRole('button', { name: 'Crear competición', exact: true }).click());
    const id = saved.metadata.planId; if (!w.state.planIds.includes(id)) { w.state.planIds.push(id); w.persist(); }
    await expect(p.locator('.competition-create')).toHaveCount(0, { timeout: 60000 }); return id;
}
export async function competitionCard(w, id) {
    const p = await trainer(w, 'Competiciones'); await p.getByRole('button', { name: 'Listado', exact: true }).click();
    await p.getByLabel('Incluir competiciones pasadas', { exact: false }).check();
    const catalog = await w.api('T', 'catalog'); expect(catalog.status).toBe(200);
    // Cards do not expose planId. Relate them to the exact ordered catalog snapshot,
    // including historical competitions, rather than matching a non-unique date.
    const plans = [...catalog.data.data.plans].sort((a, b) => a.fecha_torneo.localeCompare(b.fecha_torneo) || a.planId.localeCompare(b.planId));
    const cards = p.locator('.competition-card'); await expect(cards).toHaveCount(plans.length);
    const headings = await cards.locator('h3').allTextContents();
    const target = plans.find(c => c.planId === id); expect(target).toBeTruthy();
    const idx = plans.findIndex(c => c.planId === id); expect(idx).toBeGreaterThanOrEqual(0);
    expect(headings[idx]).toContain(target.fecha_torneo);
    return { p, card: cards.nth(idx), competition: target };
}
export async function plan(w, role, id) { const x = await w.api(role, 'users/' + encodeURIComponent(w.users[role].mail) + '/plans/' + id); expect(x.status).toBe(200); return x.data.data; }
export async function ensurePlan(w) {
    if (w.state.primaryPlan && (await w.api('T', 'catalog')).data.data.plans.some(c => c.planId === w.state.primaryPlan)) return w.state.primaryPlan;
    const id = await createCompetition(w, { start: datePlus(-2), end: datePlus(13), days: [1, 2, 3, 4, 5, 6, 7] });
    w.state.primaryPlan = id; w.persist(); return id;
}
