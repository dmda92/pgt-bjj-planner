import { DurableObject } from 'cloudflare:workers';
import { allowedOrigins } from '../origins.ts';
import { ApiError, fingerprint, opaqueToken } from '../security.ts';
import { CachedFirestore } from './cached-firestore.ts';
import { NativeAggregates, migrationNamespace, type AggregateChange } from './aggregates.ts';
import { PlanRepository } from './plans.ts';
import { PlanViews } from './plan-views.ts';
import { QueryCoordinator, type QuerySession, type PlanChange } from './query-coordinator.ts';
import { V2Api } from './api.ts';
import type { PreflightEnv } from '../firestore-preflight.ts';
import { requireDev } from '../firestore-preflight.ts';
import type { Profile } from '../../src/domain/models.ts';
import { DEV_DATABASE_NAME } from '../firestore-auth.ts';
export interface V2Env extends PreflightEnv {
    SECURITY: DurableObjectNamespace; DOMAIN_IO: DurableObjectNamespace; ASSETS: Fetcher; ALLOWED_ORIGINS: string; DEV_BUILD_SHA?: string;
}
type Attachment = QuerySession & { sessionKey: string; connection: string; sequence: number; epoch: string };
export default {
    fetch(request: Request, env: V2Env) {
        if (!new URL(request.url).pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
        return env.SECURITY.get(env.SECURITY.idFromName('firestore-v2-academy')).fetch(request);
    }
};
/** Sole DEV business writer, volatile business cache, SQLite coordination only. */
export class ProbeSecurity extends DurableObject<V2Env> {
    private api?: V2Api;
    private activationError?: ApiError;
    private queries?: QueryCoordinator;
    private epoch = crypto.randomUUID();
    private queue: Promise<unknown> = Promise.resolve();
    private originConnection = '';
    private originSession = '';
    private async initialize() {
        if (this.api) return;
        // Activation explicitly requires a coordinator restart. Remember this
        // configuration gate so reconnecting old clients cannot poll Firestore
        // while the new dataset has not been activated. Transport errors retry.
        if (this.activationError) throw this.activationError;
        const db = new CachedFirestore(this.env, (url, init) => url.startsWith('https://firestore.googleapis.com/') ?
            this.env.DOMAIN_IO.get(this.env.DOMAIN_IO.idFromName('v2-native-transport')).fetch(url, init) : fetch(url, init)), control = await db.get('pgt_v2/control');
        if (!control || control.data.phase !== 'active' || control.data.project !== 'pgt-bjj-dev' ||
            !/^[0-9a-f]{40}$/.test(control.data.sourceCommit || '')) throw (this.activationError = new ApiError(503, 'V2_MIGRATION_NOT_ACTIVATED'));
        const namespace = migrationNamespace(control.data.namespace);
        if (!namespace.startsWith('pgt_v2/import-')) throw (this.activationError = new ApiError(503, 'V2_MIGRATION_NOT_ACTIVATED'));
        const verified = await db.get(namespace);
        if (!verified || verified.data.phase !== 'verified' || verified.data.active !== true || verified.data.sourceCommit !== control.data.sourceCommit)
            throw (this.activationError = new ApiError(503, 'V2_IMPORT_NOT_VERIFIED'));
        const store = new NativeAggregates(db, namespace), queries = new QueryCoordinator(store, new PlanViews(new PlanRepository(db, namespace), store), 32 * 1024 * 1024);
        const trackBlocks = async (target: string) => {
            await this.ctx.storage.put('v2-gc:' + await fingerprint(target), { target, token: '', attempts: 0 });
            if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(Date.now() + 1000);
        };
        store.onBlocksStaged = trackBlocks;
        queries.planViews.plans.onBlocksStaged = trackBlocks;
        queries.beforePublish = async operationId => {
            await this.ctx.storage.put('v2-pending:' + operationId.toLowerCase(), { attempts: 0 });
            if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(Date.now() + 1000);
        };
        queries.onPublish = async (changes, plans, operationId) => {
            try {
                await this.broadcast(changes, plans, operationId);
                await this.ctx.storage.delete('v2-pending:' + operationId.toLowerCase());
            } catch { /* Atomic receipt + pending coordination metadata recover delivery. */ }
        };
        this.queries = queries; this.api = new V2Api(this.ctx.storage, queries);
    }
    fetch(request: Request): Promise<Response> {
        const result = this.queue.then(() => this.handle(request)); this.queue = result.catch(() => undefined); return result;
    }
    private async limit(key: string, count: number, duration: number) {
        const now = Date.now(), stored = await this.ctx.storage.get<{ start: number; count: number }>(key);
        const value = stored && stored.start + duration > now ? stored : { start: now, count: 0 };
        if (value.count >= count) throw new ApiError(429, 'RATE_LIMIT', Math.max(1, Math.ceil((value.start + duration - now) / 1000)));
        value.count++; await this.ctx.storage.put(key, value);
    }
    private async session(request: Request) {
        const token = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
        if (!token) throw new ApiError(401, 'SESSION_REQUIRED');
        const key = 'pgt-v2-session:' + await fingerprint(token), session = await this.ctx.storage.get<QuerySession>(key);
        if (!session) throw new ApiError(401, 'SESSION_REVOKED');
        await this.queries!.user(session, { kind: 'profile', owner: session.mail });
        return { key, session };
    }
    private async handle(request: Request): Promise<Response> {
        const origin = request.headers.get('Origin'), origins = allowedOrigins(this.env), url = new URL(request.url);
        const headers = new Headers({ 'Cache-Control': 'no-store', 'Vary': 'Origin' });
        headers.set('X-PGT-Worker-Build', this.env.DEV_BUILD_SHA || 'local');
        if (origin && origins.has(origin)) headers.set('Access-Control-Allow-Origin', origin);
        try {
            if (origin && !origins.has(origin) || !origin && !['GET', 'HEAD'].includes(request.method)) throw new ApiError(403, 'ORIGIN_FORBIDDEN');
            if (request.method === 'OPTIONS') {
                headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
                headers.set('Access-Control-Allow-Headers', 'Authorization,Content-Type,X-PGT-Connection');
                return new Response(null, { status: 204, headers });
            }
            requireDev(this.env);
            if (request.method === 'GET' && url.pathname === '/api/dev/runtime') return Response.json({
                build: this.env.DEV_BUILD_SHA || 'local', domainBuild: this.env.DEV_BUILD_SHA || 'local',
                revision: 'firestore-v2-20261026', project: 'pgt-bjj-dev'
            }, { headers });
            if (/^\/api\/v2\/auth\/(login|register)$/.test(url.pathname)) {
                const ip = await fingerprint(request.headers.get('CF-Connecting-IP') || 'local');
                await this.limit('v2-rate:login:' + ip, 6, 60000);
            }
            await this.initialize();
            if (url.pathname === '/api/v2/realtime-ticket' && request.method === 'POST') {
                const { key, session } = await this.session(request), ticket = opaqueToken();
                await this.limit('v2-rate:ticket:' + key, 10, 60000);
                for (const [oldKey, old] of await this.ctx.storage.list<{ expires: number }>({ prefix: 'v2-ticket:', limit: 1000 }))
                    if (old.expires < Date.now()) await this.ctx.storage.delete(oldKey);
                await this.ctx.storage.put('v2-ticket:' + await fingerprint(ticket), { key, expires: Date.now() + 30000 });
                return Response.json({ ticket }, { headers });
            }
            if (url.pathname === '/api/v2/realtime') return this.open(request, url);
            this.originConnection = request.headers.get('X-PGT-Connection') || ''; this.originSession = '';
            if (request.method === 'POST' && url.pathname.startsWith('/api/v2/commands/')) {
                const { key } = await this.session(request); this.originSession = key;
                // Autosave is an ordinary write, not one explicit form submission.
                // A 1.2s editor debounce can make up to 50 saves/minute. Keep a
                // finite sustained ceiling without rejecting normal editing.
                await this.limit('v2-rate:write-minute:' + key, 60, 60000);
                await this.limit('v2-rate:write-hour:' + key, 600, 3600000);
            }
            const response = await this.api!.fetch(request), result = new Response(response.body, response);
            if (response.ok && url.pathname === '/api/v2/auth/logout') {
                const token = request.headers.get('Authorization')?.slice(7);
                if (token) {
                    const key = 'pgt-v2-session:' + await fingerprint(token);
                    for (const ws of this.ctx.getWebSockets()) if (ws.deserializeAttachment()?.sessionKey === key) ws.close(4401, 'SESSION_REVOKED');
                }
            }
            headers.forEach((value, key) => result.headers.set(key, value));
            return result;
        } catch (error) {
            const known = error instanceof ApiError;
            if (known && error.retryAfter) headers.set('Retry-After', String(error.retryAfter));
            return Response.json({ error: known ? error.message : 'INTERNAL_ERROR' }, { status: known ? error.status : 500, headers });
        } finally { this.originConnection = ''; this.originSession = ''; }
    }
    private async open(request: Request, url: URL) {
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket' || !request.headers.get('Origin')) throw new ApiError(403, 'REALTIME_UPGRADE_REQUIRED');
        const ticket = url.searchParams.get('ticket') || '';
        if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw new ApiError(401, 'REALTIME_TICKET_REQUIRED');
        const ticketKey = 'v2-ticket:' + await fingerprint(ticket), saved = await this.ctx.storage.get<{ key: string; expires: number }>(ticketKey);
        await this.ctx.storage.delete(ticketKey);
        if (!saved || saved.expires < Date.now()) throw new ApiError(401, 'REALTIME_TICKET_EXPIRED');
        const actor = await this.ctx.storage.get<QuerySession>(saved.key);
        if (!actor) throw new ApiError(401, 'SESSION_REVOKED');
        await this.queries!.user(actor, { kind: 'profile', owner: actor.mail });
        const sockets = this.ctx.getWebSockets();
        if (sockets.length >= 100 || sockets.filter(ws => ws.deserializeAttachment()?.sessionKey === saved.key).length >= 4) throw new ApiError(429, 'REALTIME_CONNECTION_LIMIT');
        const pair = new WebSocketPair(), [client, server] = Object.values(pair);
        this.ctx.acceptWebSocket(server);
        const attachment: Attachment = { ...actor, sessionKey: saved.key, connection: crypto.randomUUID(), epoch: this.epoch, sequence: 0 };
        server.serializeAttachment(attachment);
        server.send(JSON.stringify({ type: 'ready', epoch: this.epoch, connection: attachment.connection, sequence: 0 }));
        return new Response(null, { status: 101, webSocket: client });
    }
    private async broadcast(changes: AggregateChange[], plans: PlanChange[], operationId: string) {
        const profiles = new Map(await Promise.all(changes.filter(c => c.ref.kind === 'profile').map(async c => [c.ref.id,
            { role: (c.data as Profile).perfil, fingerprint: await fingerprint((c.data as Profile).pwd || '') }] as const)));
        const resources = changes.filter(c => c.ref.kind !== 'maintenance' && c.ref.kind !== 'template').map(c => {
            const ref = c.ref;
            if (ref.kind === 'plan-text') return { kind: 'plan', owner: ref.id.slice(38), id: ref.id.slice(0, 36) };
            if (['profile', 'repertoire', 'comments', 'assignment'].includes(ref.kind)) return { kind: ref.kind, owner: ref.id, id: '' };
            return { kind: ref.kind, owner: '', id: ref.id };
        });
        resources.push(...plans.map(p => ({ kind: 'plan', owner: p.owner, id: p.planId })));
        for (const ws of this.ctx.getWebSockets()) {
            const a = ws.deserializeAttachment() as Attachment, changed = profiles.get(a.mail);
            if (changed && (changed.role !== a.role || changed.fingerprint !== a.pwdFingerprint)) { ws.close(4401, 'SESSION_REVOKED'); continue; }
            if (a.connection === this.originConnection && a.sessionKey === this.originSession) continue;
            const relevant = resources.filter(r => r.owner === a.mail || a.role === 'entrenador' || r.kind === 'catalog');
            if (!relevant.length) continue;
            try {
                if (a.epoch !== this.epoch) { a.epoch = this.epoch; a.sequence = 0; ws.send(JSON.stringify({ type: 'reset', epoch: this.epoch, sequence: 0 })); }
                a.sequence++; ws.serializeAttachment(a);
                ws.send(JSON.stringify({ type: 'changed', epoch: a.epoch, sequence: a.sequence, operationId,
                    resources: [...new Map(relevant.map(r => [JSON.stringify(r), r])).values()] }));
            } catch { ws.close(1011, 'RECONNECT'); }
        }
    }
    alarm() {
        const result = this.queue.then(async () => {
            const pending = await this.ctx.storage.list<{ attempts: number }>({ prefix: 'v2-pending:', limit: 20 });
            const garbage = await this.ctx.storage.list<{ target: string; token: string; attempts: number }>({ prefix: 'v2-gc:', limit: 20 });
            if (!pending.size && !garbage.size) return;
            for (const [key, item] of pending) await this.ctx.storage.put(key, { attempts: item.attempts + 1 });
            const batch = [...garbage].filter(([, item]) => item.attempts < 3).slice(0, 2);
            for (const [key, item] of batch) await this.ctx.storage.put(key, { ...item, attempts: item.attempts + 1 });
            try {
                await this.initialize();
                for (const [key, item] of pending) {
                    if (item.attempts >= 3) continue;
                    if (!await this.queries!.deliverOperation(key.slice('v2-pending:'.length))) await this.ctx.storage.delete(key);
                }
                for (const [key, item] of batch) {
                    try {
                        const result = await this.queries!.collectBlocks(item.target, item.token);
                        if (result.token) await this.ctx.storage.put(key, { ...item, token: result.token, attempts: 0 });
                        else await this.ctx.storage.delete(key);
                    } catch { /* Retain checkpoint; stop after three failed attempts. */ }
                }
            } catch { /* Bounded recovery only; no periodic database polling. */ }
            const left = await this.ctx.storage.list<{ attempts: number }>({ prefix: 'v2-pending:', limit: 20 });
            if ([...left.values()].some(p => p.attempts >= 3)) {
                // A version handshake on reconnect is the final bounded fallback.
                for (const ws of this.ctx.getWebSockets()) try { ws.close(1012, 'REVALIDATE_VERSIONS'); } catch {}
                for (const [key, item] of left) if (item.attempts >= 3) await this.ctx.storage.delete(key);
            }
            const remaining = await this.ctx.storage.list<{ attempts: number }>({ prefix: 'v2-gc:', limit: 20 });
            for (const [key, item] of remaining) if (item.attempts >= 3) {
                await this.ctx.storage.put(key.replace('v2-gc:', 'v2-gc-failed:'), item);
                await this.ctx.storage.delete(key);
            }
            if ([...left.values(), ...remaining.values()].some(p => p.attempts < 3)) await this.ctx.storage.setAlarm(Date.now() + 60000);
        });
        this.queue = result.catch(() => undefined); return result;
    }
    webSocketMessage(ws: WebSocket) { ws.close(1008, 'INVALID_MESSAGE'); }
    webSocketClose(ws: WebSocket, code: number) { ws.close(code === 1006 ? 1000 : code); }
    webSocketError(ws: WebSocket) { ws.close(1011, 'RECONNECT'); }
}
/** Private fixed-destination transport. Each invocation performs one Google call,
 * keeping external subrequests below Free limits during large academy commands.
 * No public route, arbitrary URL, credentials in SQLite or business persistence. */
export class DomainIO extends DurableObject<V2Env> {
    async fetch(request: Request) {
        requireDev(this.env);
        const url = new URL(request.url), base = '/v1/' + DEV_DATABASE_NAME + '/documents';
        if (url.origin !== 'https://firestore.googleapis.com' || url.hash ||
            !/^Bearer [^\s]+$/.test(request.headers.get('Authorization') || '')) return new Response(null, { status: 403 });
        const allowedName = (name: unknown) => typeof name === 'string' &&
            name.startsWith(DEV_DATABASE_NAME + '/documents/pgt_v2/') && /^[A-Za-z0-9@._+()/\-]+$/.test(name) && !name.split('/').some(p => p === '..' || p === '.');
        if (request.method === 'GET') {
            if (!url.pathname.startsWith(base + '/pgt_v2/') || !allowedName(url.pathname.slice(4))) return new Response(null, { status: 403 });
        } else if (request.method === 'POST' && !url.search && [base + ':commit', base + ':batchGet'].includes(url.pathname)) {
            const value = await request.clone().json() as { writes?: { update?: { name: string }; delete?: string }[]; documents?: string[] };
            if (url.pathname.endsWith(':commit') ? !Array.isArray(value.writes) || !value.writes.length || value.writes.some(w => !allowedName(w.update?.name ?? w.delete)) :
                !Array.isArray(value.documents) || !value.documents.length || value.documents.some(name => !allowedName(name))) return new Response(null, { status: 403 });
        } else return new Response(null, { status: 404 });
        return fetch(request, { redirect: 'manual' });
    }
}
