import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { v2DevFixture } from '../tests/v2-dev-fixture.mjs';
// Only the test subclass injects a one-shot delivery failure. Persistence,
// commands, alarm and SQLite outbox are the actual DEV implementation.
const compiled = await build({ stdin: { contents: `
import { ProbeSecurity as Base, default as entry, DomainIO } from './worker/dev.ts';
export default entry;
export { DomainIO };
export class ProbeSecurity extends Base {
    fetch(request) {
        if(new URL(request.url).pathname==='/api/__qa/outbox') return this.ctx.storage.list({prefix:'v2-pending:',limit:20}).then(items=>Response.json({pending:items.size}));
        return super.fetch(request);
    }
    constructor(...args) {
        super(...args);
        const deliver = this.broadcast.bind(this);
        let fail = true;
        this.broadcast = async (...input) => {
            if (fail) { fail = false; throw Error('SYNTHETIC_DELIVERY_FAILURE'); }
            return deliver(...input);
        };
    }
}`, resolveDir: process.cwd(), sourcefile: 'synthetic-recovery-entry.mjs', loader: 'js' },
    bundle: true, write: false, format: 'esm', target: 'es2022', external: ['cloudflare:workers'] });
const { f, password, mail } = await v2DevFixture(), origin = 'https://synthetic.test';
const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: compiled.outputFiles[0].text, compatibilityDate: '2026-10-13',
    durableObjects: { SECURITY: { className: 'ProbeSecurity', useSQLite: true }, DOMAIN_IO: { className: 'DomainIO', useSQLite: true } },
    bindings: { ...f.env, ALLOWED_ORIGINS: origin }, outboundService: async request => f.transport(request.url, { method: request.method, headers: request.headers,
        ...(!['GET', 'HEAD'].includes(request.method) ? { body: await request.text() } : {}) }) }));
let ws;
try {
    const api = async (path, body, token) => {
        const response = await runtime.dispatchFetch('https://local/api/v2/' + path, { method: body === undefined ? 'GET' : 'POST',
            headers: { Connection: 'close', Origin: origin, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {}) });
        const result = await response.json(); assert.ok(response.ok, JSON.stringify(result)); return result;
    };
    const actor = await api('auth/login', { mail, password });
    const ticket = await api('realtime-ticket', {}, actor.token);
    const upgraded = await runtime.dispatchFetch('https://local/api/v2/realtime?ticket=' + ticket.ticket, { headers: { Origin: origin, Upgrade: 'websocket' } });
    assert.equal(upgraded.status, 101); ws = upgraded.webSocket; const events = [];
    ws.addEventListener('message', event => events.push(JSON.parse(event.data))); ws.accept();
    const closed = new Promise(resolve => ws.addEventListener('close', resolve, {once:true}));
    const comments = await api('users/' + mail + '/comments', undefined, actor.token);
    const operationId = crypto.randomUUID();
    await api('commands/profile', { data: { ...actor.profile, nombre: 'Recovered' }, expected: '1', operationId }, actor.token);
    let pending = 1;
    for (let i = 0; i < 60 && pending; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        pending = (await (await runtime.dispatchFetch('https://local/api/__qa/outbox')).json()).pending;
    }
    assert.equal(pending,0,'The atomic receipt must still recover the failed outbox');
    const profile = await api('users/' + mail + '/profile', undefined, actor.token);
    assert.equal(profile.data.nombre, 'Recovered'); assert.equal(profile.version, '2');
    assert.ok(comments.data);
    const before = f.metrics(); await new Promise(resolve => setTimeout(resolve, 1300));
    assert.equal(f.metrics().estimatedReads, before.estimatedReads);
    ws.close();
    assert.equal((await closed).code,1012,'Partial delivery forces reauthentication instead of retaining potentially stale authorization');
    console.log('Actual V2 SQLite outbox recovers the failed delivery receipt and closes sockets for reauthentication; no repeated mutation or idle polling PASS.');
} finally { if (ws) try { ws.close(); } catch {} await runtime.dispose(); }
