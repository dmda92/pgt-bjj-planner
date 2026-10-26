import {build} from 'esbuild';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {cloneTemplate, initialVersion} from '../src/domain/models.ts';
import {template} from '../tests/template-fixture.ts';
import {generatePlan} from '../src/domain/planner.ts';
import {mkdir, writeFile} from 'node:fs/promises';

const bundle = await build({
    stdin: {
        contents: 'export {Client} from "./src/application/client.ts";export {db} from "./src/infrastructure/local.ts";',
        resolveDir: process.cwd()
    }, bundle: true, write: false, format: 'esm', platform: 'browser', define: {'import.meta.env': '{}'}
});
const t = cloneTemplate(template);
for (const p of t.positions) for (const tech of p.tecnicas) tech.descripcion_del_alumno = 'Descripción larga, ángulo y enlace https://example.com/video '.repeat(200);
const profile = mail => ({
    ...initialVersion(),
    mail,
    nombre: mail,
    apellidos: '',
    fecha_nacimiento: null,
    peso: null,
    cinturon: 'Negro',
    perfil: 'entrenador'
});
const record = data => ({data, sha: 'a'.repeat(40)});
const notes = {...initialVersion(), comments: []};
const fixture = {t, notes};
let calls = 0;
const server = createServer(async (req, res) => {
    if (req.url === '/') {
        res.setHeader('Content-Type', 'text/html');
        res.end('<html><body>Cache QA</body></html>');
        return;
    }
    if (req.url === '/test.js') {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(bundle.outputFiles[0].text);
        return;
    }
    if (req.url === '/fixture') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(fixture));
        return;
    }
    if (req.url.startsWith('/api/app/')) {
        calls++;
        await new Promise(r => setTimeout(r, 100));
        const url = new URL(req.url, 'http://fixture');
        const mail = decodeURIComponent(url.pathname.split('/')[4]);
        if (mail.startsWith('revoked-late') && req.headers.authorization === 'Bearer ' + 'A'.repeat(43)) {
            res.statusCode = 401;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({error: 'SESSION_REVOKED'}));
            return;
        }
        if (mail.startsWith('denied')) {
            res.statusCode = 403;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({error: 'TRAINER_REQUIRED'}));
            return;
        }
        const section = url.searchParams.get('section'), known = JSON.parse(url.searchParams.get('known') || '{}');
        const r = (key, data) => known[key] === 'a'.repeat(40) ? {unchanged: true, sha: 'a'.repeat(40)} : record(data);
        const value = {profile: r('profile', profile(mail))};
        if (section === 'techniques') {
            value.techniques = r('techniques', t);
            value.comments = r('comments', notes);
        }
        if (section === 'plans') {
            value.planSummaries = [];
            value.plans = [];
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(value));
        return;
    }
    res.statusCode = 404;
    res.end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({headless: true, ...(process.env.PGT_TEST_CHROMIUM_PATH ? {executablePath: process.env.PGT_TEST_CHROMIUM_PATH} : {})});
const context = await browser.newContext();
const page = await context.newPage();
try {
    await page.goto(origin);
    const metrics = await page.evaluate(async () => {
        const {Client, db} = await import('/test.js');
        const {t, notes} = await (await fetch('/fixture')).json();
        const assert = (condition, message) => {
            if (!condition) throw Error(message);
        };
        const owner = 'coach@example.com', p = {
            schemaVersion: 1,
            revision: 1,
            updatedAt: new Date().toISOString(),
            mail: owner,
            nombre: 'Coach',
            apellidos: '',
            fecha_nacimiento: null,
            peso: null,
            cinturon: 'Negro',
            perfil: 'entrenador'
        };
        const client = new Client();
        client.identity = {mail: owner, token: 'A'.repeat(43), profile: p};
        localStorage.setItem('pgt-session', JSON.stringify(client.identity));
        await db.meta.put({key: 'owner', value: owner});
        // A role changed by a subsequent sync takes precedence over the initial login profile.
        await db.entries.put({
            key: 'profile',
            mail: owner,
            data: p,
            base: p,
            sha: 'a'.repeat(40),
            dirty: false,
            conflicts: [],
            endpoint: '/unused'
        });
        client.identity = {...client.identity, profile: {...p, perfil: 'alumno'}};
        localStorage.setItem('pgt-session', JSON.stringify(client.identity));
        const metrics = {};
        let start = performance.now();
        assert(!await client.cachedTrainer('a@example.com', 'techniques'), 'unexpected initial cache');
        metrics.indexedDbColdMs = performance.now() - start;
        start = performance.now();
        const first = await client.trainerView('a@example.com', 'techniques');
        metrics.firstWorkerAndJsonAndSaveMs = performance.now() - start;
        assert(first.techniques.data.positions[0].tecnicas[0].descripcion_del_alumno === t.positions[0].tecnicas[0].descripcion_del_alumno, 'long text damaged');
        start = performance.now();
        assert((await client.cachedTrainer('a@example.com', 'techniques')).profile.data.mail === 'a@example.com', 'wrong cached pupil');
        metrics.indexedDbWarmMs = performance.now() - start;
        start = performance.now();
        await Promise.all([client.trainerView('a@example.com', 'techniques'), client.trainerView('a@example.com', 'techniques')]);
        metrics.unchangedRefreshMs = performance.now() - start;
        const other = await client.trainerView('b@example.com', 'techniques');
        assert(other.profile.data.mail === 'b@example.com', 'pupil isolation failed');
        // A trainer's own pending catalogue never belongs to or is overwritten by the read-only cache.
        const draft = structuredClone(t);
        draft.positions[0].tecnicas[0].descripcion_del_alumno = 'LOCAL PENDING';
        await db.entries.put({
            key: 'techniques',
            mail: owner,
            data: draft,
            base: t,
            sha: 'a'.repeat(40),
            dirty: true,
            conflicts: [],
            endpoint: '/unused'
        });
        const ownLoad = client.trainerView(owner, 'techniques');
        await new Promise(r => setTimeout(r, 20));
        // Commit a newer local edit and synchronization baseline while the stale remote view is in flight.
        await db.transaction('rw', db.entries, async () => {
            const entry = await db.entries.get('techniques');
            entry.data.positions[0].tecnicas[0].descripcion_del_alumno = 'LOCAL MORE RECENT';
            entry.data.revision = 3;
            entry.base = {...t, revision: 2};
            entry.sha = 'b'.repeat(40);
            await db.entries.put(entry);
        });
        const own = await ownLoad;
        assert(own.techniques.data.positions[0].tecnicas[0].descripcion_del_alumno === 'LOCAL MORE RECENT', 'pending draft overwritten');
        const saved = await db.entries.get('techniques');
        assert(saved.dirty && saved.base.revision === 2 && saved.sha === 'b'.repeat(40) && saved.data.revision === 3, 'concurrent synchronization baseline or queue lost');
        // A response arriving after identity switch is rejected before it can persist.
        const old = client.trainerView('late@example.com', 'techniques');
        await new Promise(r => setTimeout(r, 20));
        client.identity = {
            mail: 'other-coach@example.com',
            token: 'B'.repeat(43),
            profile: {...p, mail: 'other-coach@example.com'}
        };
        localStorage.setItem('pgt-session', JSON.stringify(client.identity));
        let rejected = false;
        try {
            await old;
        } catch {
            rejected = true;
        }
        assert(rejected, 'late response accepted');
        assert(!await client.cachedTrainer('a@example.com', 'techniques'), 'cache crossed trainer identities');
        client.identity = {mail: owner, token: 'A'.repeat(43), profile: p};
        localStorage.setItem('pgt-session', JSON.stringify(client.identity));
        const revoked = client.trainerView('revoked-late@example.com', 'techniques');
        await new Promise(r => setTimeout(r, 20));
        client.identity = {mail: owner, token: 'C'.repeat(43), profile: p};
        localStorage.setItem('pgt-session', JSON.stringify(client.identity));
        const fresh = client.trainerView('revoked-late@example.com', 'techniques');
        try {
            await revoked;
        } catch {
        }
        assert((await fresh).profile.data.mail === 'revoked-late@example.com', 'New-session request reused stale in-flight request');
        assert(!client.locked, 'Old-session 401 locked new session');
        assert(await client.cachedTrainer('a@example.com', 'techniques'), 'Old-session 401 removed new-session cache');
        window.cacheQa = {client, db};
        return metrics;
    });
    if (calls !== 7) throw Error(`Expected seven deduplicated requests, got ${calls}`);
    const countBefore = calls;
    await context.setOffline(true);
    await page.evaluate(async () => {
        const {client, db} = window.cacheQa;
        const start = performance.now();
        const data = await client.trainerView('a@example.com', 'techniques');
        if (data.profile.data.mail !== 'a@example.com') throw Error('Offline restore failed');
        window.offlineMs = performance.now() - start;
    });
    if (calls !== countBefore) throw Error('Offline cache requested network');
    metrics.offlineMs = await page.evaluate(() => window.offlineMs);
    await context.setOffline(false);
    await page.evaluate(async () => {
        const {client, db} = window.cacheQa;
        let rejected = false;
        try {
            await client.trainerView('denied@example.com', 'techniques');
        } catch {
            rejected = true;
        }
        if (!rejected) throw Error('Role revocation accepted');
        if (await db.trainerViews.count()) throw Error('Role revocation retained cache');
        await client.logout(true);
        if (await db.trainerViews.count()) throw Error('Logout retained trainer cache');
        if (!(await db.entries.get('techniques')).dirty) throw Error('Logout removed pending own data');
    });
    await mkdir('.performance-artifacts', {recursive: true});
    await writeFile('.performance-artifacts/client.json', JSON.stringify(metrics, null, 2));
    console.log('Trainer cache Chromium: ' + JSON.stringify(metrics) + '; deduplicación, UUID/textos largos, varios alumnos/entrenadores, offline, cambio de sesión y pendientes OK.');
} finally {
    await context.close();
    await browser.close();
    await new Promise(r => server.close(r));
}
