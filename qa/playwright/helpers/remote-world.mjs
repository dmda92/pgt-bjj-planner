import { chromium, expect } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { campaign } from './case-test.mjs';
let shared;
export async function getWorld() {
    if (shared) return shared;
    shared = await openWorld(); return shared;
}
async function openWorld() {
    const config = JSON.parse(readFileSync('.qa/credentials.local.json', 'utf8'));
    if (config.baseURL !== 'https://pgt-github-probe-dev.david-dzm5.workers.dev') throw Error('QA DEV URL required');
    mkdirSync(campaign, { recursive: true });
    const privatePath = resolve(campaign, 'users.private.json'), publicPath = resolve(campaign, 'users.json');
    const users = existsSync(privatePath) ? JSON.parse(readFileSync(privatePath, 'utf8')) : {
        T: { ...config.trainer, role: 'entrenador' },
        ...Object.fromEntries(['A', 'B', 'C'].map(role => [role, { mail: `qa-${Date.now()}-${role.toLowerCase()}@example.test`,
            password: 'QA-' + crypto.randomUUID(), nombre: `QA ${role}`, apellidos: 'Campaña 26 octubre', role: 'alumno' }]))
    };
    const statePath = resolve(campaign, 'world-state.json');
    const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { planIds: [], createdUsers: [], network: [], guards: [] };
    const contexts = {}, pages = {};
    const persist = () => {
        writeFileSync(privatePath, JSON.stringify(users, null, 2));
        writeFileSync(publicPath, JSON.stringify(Object.fromEntries(Object.entries(users).map(([k, v]) => [k, { mail: v.mail, role: v.role }])), null, 2));
        writeFileSync(statePath, JSON.stringify(state, null, 2));
    };
    persist();
    const world = { users, contexts, pages, state, persist, baseURL: config.baseURL,
        async api(role, path, body, method = body === undefined ? 'GET' : 'POST') {
            const page = pages[role];
            return page.evaluate(async ({ path, body, method }) => {
                const identity = JSON.parse(localStorage.getItem('pgt-session') || 'null');
                const response = await fetch('/api/v2/' + path, { method, headers: { 'Content-Type': 'application/json',
                    ...(identity?.token ? { Authorization: 'Bearer ' + identity.token } : {}) },
                    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
                return { status: response.status, data: await response.json() };
            }, { path, body, method });
        },
        async snapshot(role = 'A', owner = users[role]?.mail) {
            const value = await world.api(role, 'users/' + encodeURIComponent(owner) + '/snapshot?known=%7B%7D');
            expect(value.status).toBe(200); return value.data;
        },
        async page(role) {
            if (pages[role]) return pages[role];
            const context = await chromium.launchPersistentContext(resolve(campaign, 'profiles', role), { headless: true,
                viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
            contexts[role] = context;
            await context.route('**/api/v2/commands/**', async route => {
                const request = route.request(), kind = new URL(request.url()).pathname.split('/').at(-1);
                let body; try { body = request.postDataJSON(); } catch { body = {}; }
                const allowedMail = mail => Object.values(users).some(u => u.mail === mail);
                let safe = true;
                if (['assignment', 'delete-competition', 'prepare'].includes(kind)) safe = state.planIds.includes(body.planId);
                if (kind === 'competition') safe = body.competition?.alumnos?.every(allowedMail);
                if (kind === 'assignment') safe &&= body.alumnos?.every(allowedMail);
                if (['role', 'password', 'belt', 'comments'].includes(kind) && body.mail) safe &&= allowedMail(body.mail);
                if (!safe) { state.guards.push({ kind, time: new Date().toISOString() }); persist(); return route.fulfill({ status: 403,
                    contentType: 'application/json', body: JSON.stringify({ error: 'QA_FOREIGN_MUTATION_BLOCKED' }) }); }
                await route.continue();
            });
            const page = context.pages()[0] || await context.newPage(); pages[role] = page;
            page.on('response', async response => {
                const url = new URL(response.url());
                if (!url.pathname.startsWith('/api/')) return;
                state.network.push({ role, method: response.request().method(), path: url.pathname, status: response.status(), time: new Date().toISOString() });
                if (url.pathname.endsWith('/commands/competition') && response.ok()) {
                    try { const id = (await response.json()).metadata?.planId; if (id && !state.planIds.includes(id)) state.planIds.push(id); } catch {}
                }
                persist();
            });
            await page.goto(config.baseURL);
            return page;
        },
        async login(role, identityRole = role) {
            const page = await world.page(role), user = users[identityRole];
            await page.getByRole('button', { name: 'Salir', exact: true }).or(page.getByLabel('Correo', { exact: true })).first().waitFor({ timeout: 60000 });
            if (await page.getByRole('button', { name: 'Salir', exact: true }).count()) return page;
            await page.getByLabel('Correo', { exact: true }).fill(user.mail);
            await page.getByLabel('Contraseña', { exact: true }).fill(user.password);
            await page.getByRole('button', { name: 'Entrar', exact: true }).click();
            await expect(page.getByRole('heading', { name: 'Tu repertorio' })).toBeVisible({ timeout: 60000 });
            await expect(page.locator('.sync-success')).toBeVisible({ timeout: 60000 }); return page;
        },
        async register(role) {
            const page = await world.page(role), user = users[role];
            if (state.createdUsers.includes(user.mail)) return world.login(role);
            await page.getByRole('button', { name: 'Registrarme', exact: true }).click();
            await page.getByLabel('Correo', { exact: true }).fill(user.mail);
            await page.getByLabel('Nombre', { exact: true }).fill(user.nombre);
            await page.getByLabel('Apellidos', { exact: true }).fill(user.apellidos);
            await page.getByLabel('Contraseña', { exact: true }).fill(user.password);
            await page.getByLabel('Repetir contraseña', { exact: true }).fill(user.password);
            await page.getByRole('button', { name: 'Crear cuenta de alumno', exact: true }).click();
            await expect(page.getByRole('heading', { name: 'Tu repertorio' })).toBeVisible({ timeout: 60000 });
            await expect(page.locator('.sync-success')).toBeVisible({ timeout: 60000 });
            state.createdUsers.push(user.mail); persist(); return page;
        },
        async close() { for (const context of Object.values(contexts)) await context.close(); shared = undefined; }
    };
    globalThis.__qaWorld = world;
    return world;
}
