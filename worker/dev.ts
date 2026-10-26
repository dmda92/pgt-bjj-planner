import {runMinimalSmoke} from './structured/minimal-smoke.ts';
import {checkSmokeGate} from './structured/smoke-gate.ts';
import {
    ExecutionBudget,
    budgetedFirestoreRequest,
    type BudgetSetup,
    type BudgetPhase
} from './structured/execution-budget.ts';
import {DurableObject} from 'cloudflare:workers';
import {SessionReplica, sessionKey, type SessionChange} from './structured/session-store.ts';
import {
    privateTransport,
    privateExecutor,
    budgetExecutor,
    type GlobalBudgetContext,
    type PrivateIOBinding,
    type RealtimeSession,
    type RealtimeChange
} from './structured/private-io.ts';
import {ApiError, fingerprint, opaqueToken, jsonBody, onlyFields} from './security.ts';
import {DomainRepositories} from './structured/repositories.ts';
import {DevMaintenance} from './structured/maintenance.ts';
import {initializeReference} from './structured/reference-catalog.ts';
import {seedStructuredQA, cleanStructuredQA, checkStructuredQA} from './structured/qa.ts';
import {StructuredAppApi} from './structured/application.ts';
import type {Profile} from '../src/domain/models.ts';
import {
    authorizePreflight,
    firestorePreflight,
    requireDev,
    PreflightFailure,
    type PreflightEnv
} from './firestore-preflight.ts';

const RUNTIME_REVISION = "structured-credentials-check-20261021-v1";

export interface DevEnv extends PreflightEnv {
    DEV_BUILD_SHA?: string;
    SECURITY: DurableObjectNamespace;
    DOMAIN_IO: PrivateIOBinding;
    ASSETS: Fetcher;
    GITHUB_DATA_TOKEN: string;
    ALLOWED_ORIGINS: string
}

const runtimeReason = (error: unknown) => {
    const message = error instanceof Error ? error.message : '';
    return /CPU|resource.*limit|exceed.*resource/i.test(message) ? 'RESOURCE_LIMIT' : /serial|clone|transfer/i.test(message) ? 'SERIALIZATION' : /disconnect|cancel/i.test(message) ? 'DISCONNECTED' : /different request|I\/O.*context|I\/O on behalf/i.test(message) ? 'IO_CONTEXT' : /loop limit|too many.*(worker|subrequest)/i.test(message) ? 'CALL_LIMIT' : /entrypoint|binding|not.*function/i.test(message) ? 'BINDING' : 'RUNTIME';
};
const wireHeaders = (headers: Headers) => {
    const result: [string, string][] = [];
    headers.forEach((value, key) => result.push([key, value]));
    return result;
};
const stamped = (response: Response, name: string, build: string) => {
    if (response.status === 101) return response;
    const copy = new Response(response.body, {status: response.status, headers: response.headers});
    copy.headers.set(name, build);
    return copy;
};
export default {
    async fetch(request: Request, env: DevEnv) {
        if (!new URL(request.url).pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
        const response = await env.SECURITY.get(env.SECURITY.idFromName('github-probe')).fetch(request);
        return stamped(response, 'X-PGT-Worker-Build', env.DEV_BUILD_SHA || 'local');
    }
};

/** Private domain DOs: fresh execution contexts without a business cache.
 * A dedicated test-meter instance stores only transactional budget metadata.
 * Password KDF retains the DO CPU allowance. RPC returns materialized bytes,
 * never a response stream whose owner has already been disposed. */
export class DomainIO extends DurableObject<DevEnv> {
    private cloud?: DomainRepositories;
    private cloudBudgetKey = '';

    private repositories(budget?: GlobalBudgetContext) {
        const key = budget ? budget.id + ':' + budget.phase : 'ordinary';
        if (key !== this.cloudBudgetKey) {
            this.cloud = undefined;
            this.cloudBudgetKey = key;
        }
        return this.cloud ||= new DomainRepositories(this.env, privateTransport(this.env.DOMAIN_IO, this.env.DEV_BUILD_SHA || 'local', budget));
    }

    private budget() {
        requireDev(this.env);
        return new ExecutionBudget({transaction: action => this.ctx.storage.transaction(tx => action(tx))});
    }

    budgetOpen(setup: BudgetSetup) {
        if (setup.build !== (this.env.DEV_BUILD_SHA || 'local')) throw new ApiError(409, 'FIRESTORE_TEST_BUILD_MISMATCH');
        return this.budget().open(setup);
    }

    async budgetPrepareSmoke(setup: BudgetSetup) {
        try {
            await this.budgetOpen(setup);
            return {ok: true};
        } catch (e) {
            return {
                ok: false,
                status: e instanceof ApiError ? e.status : 503,
                error: e instanceof ApiError ? e.message : 'SMOKE_PREPARATION_FAILED'
            };
        }
    }

    budgetReserve(phase: BudgetPhase, request: {
        reads?: number;
        writes?: number;
        deletes?: number;
        queryCeiling?: number
    }) {
        return this.budget().reserve(phase, request);
    }

    budgetSettle(id: string, actualReads?: number, uncertain = false) {
        return this.budget().settle(id, actualReads, uncertain);
    }

    budgetStatus() {
        return this.budget().status();
    }

    budgetClaimSmoke() {
        return this.budget().claimSmoke();
    }

    budgetClose() {
        return this.budget().close();
    }

    async smoke(budget: GlobalBudgetContext) {
        requireDev(this.env);
        if (budget.build !== (this.env.DEV_BUILD_SHA || 'local')) throw new ApiError(503, 'SMOKE_BUILD_MISMATCH');
        const meter = budgetExecutor(this.env.DOMAIN_IO, budget.id), {runId} = await meter.budgetClaimSmoke();
        const result = await runMinimalSmoke(phase => this.repositories({...budget, phase}), runId);
        let closed = false;
        try {
            await meter.budgetClose();
            closed = true;
        } catch {
        }
        return {
            ...result,
            budget: await meter.budgetStatus(),
            budgetClosed: closed,
            build: this.env.DEV_BUILD_SHA || 'local'
        };
    }

    async realtime(sessions: RealtimeSession[], recover = false, budget?: GlobalBudgetContext) {
        requireDev(this.env);
        const cloud = this.repositories(budget);
        cloud.beginOperation();
        try {
            if (recover) await cloud.collectRetired();
            const changes = await cloud.changes(), actors = [];
            for (const {sessionHash, session} of sessions) {
                if (!session) continue;
                const record = await cloud.read<Profile>({kind: 'user', mail: session.mail});
                if (record?.data.pwd && session.role === record.data.perfil && session.pwdFingerprint === await fingerprint(record.data.pwd)) actors.push({
                    sessionHash,
                    mail: session.mail,
                    role: record.data.perfil
                });
            }
            return {build: this.env.DEV_BUILD_SHA || 'local', changes, actors};
        } finally {
            cloud.endOperation();
        }
    }

    async acknowledge(changes: RealtimeChange[], budget?: GlobalBudgetContext) {
        requireDev(this.env);
        if (changes.some(c => !/^realtime_events\/[^/]+$/.test(c.name))) throw new ApiError(400, 'REALTIME_ACK_SCOPE_INVALID');
        const cloud = this.repositories(budget);
        cloud.beginOperation();
        try {
            await cloud.acknowledge(changes);
        } finally {
            cloud.endOperation();
        }
    }

    manifest() {
        requireDev(this.env);
        return {build: this.env.DEV_BUILD_SHA || 'local', revision: RUNTIME_REVISION};
    }

    async run(request: Request, entries: [string, unknown][], budget?: GlobalBudgetContext) {
        requireDev(this.env);
        const sessions = new SessionReplica(entries), cloud = this.repositories(budget);
        cloud.beginOperation();
        try {
            let response: Response, stage = 'DOMAIN_START';
            try {
                response = await new StructuredAppApi(sessions, cloud, undefined, value => stage = value).handle(request, new URL(request.url));
            } catch (error) {
                response = Response.json({error: error instanceof ApiError ? error.message : 'FIRESTORE_DOMAIN_' + stage + '_' + runtimeReason(error), ...(error instanceof ApiError && error.size ? {size: error.size} : {})}, {
                    status: error instanceof ApiError ? error.status : 503,
                    headers: {'Cache-Control': 'no-store'}
                });
            }
            return {
                body: await response.arrayBuffer(),
                status: response.status,
                headers: wireHeaders(response.headers),
                changes: sessions.changes(),
                build: this.env.DEV_BUILD_SHA || 'local'
            };
        } finally {
            cloud.endOperation();
        }
    }

    private outgoing = 0;

    async request(input: string, init: RequestInit = {}, budget?: GlobalBudgetContext) {
        requireDev(this.env);
        if (budget?.build && budget.build !== (this.env.DEV_BUILD_SHA || 'local')) throw new ApiError(503, 'PRIVATE_IO_BUILD_MISMATCH');
        // This capability is private and cannot act as a generic HTTP proxy.
        const url = new URL(input);
        if (!((url.origin === 'https://firestore.googleapis.com' && (url.pathname === '/v1/projects/pgt-bjj-dev/databases/(default)' || url.pathname.startsWith('/v1/projects/pgt-bjj-dev/databases/(default)/'))) || (url.origin === 'https://oauth2.googleapis.com' && url.pathname === '/token'))) throw new ApiError(403, 'PRIVATE_IO_TARGET_FORBIDDEN');
        if (++this.outgoing > 32) throw new ApiError(503, 'PRIVATE_IO_BUDGET_EXCEEDED');
        const send = (url: string, options: RequestInit) => fetch(url, {
            ...options,
            redirect: 'manual',
            signal: AbortSignal.timeout(20000)
        });
        const response = budget && url.origin === 'https://firestore.googleapis.com'
            ? await budgetedFirestoreRequest(budgetExecutor(this.env.DOMAIN_IO, budget.id), budget.phase, input, init, send)
            : await send(input, init);
        return {
            body: await response.arrayBuffer(),
            status: response.status,
            headers: wireHeaders(response.headers),
            build: this.env.DEV_BUILD_SHA || 'local'
        };
    }
}

// Same local class name/binding as the existing DEV SQLite namespace. PRO keeps
// worker/index.ts as entrypoint and does not import this DEV-only implementation.
export class ProbeSecurity {
    private devEnv: DevEnv;
    private preflight: Promise<Response> | undefined;
    private devState: DurableObjectState;
    private cloud: () => DomainRepositories;

    constructor(state: DurableObjectState, env: DevEnv) {
        let cloud: DomainRepositories | undefined;
        const provider = () => cloud || (cloud = new DomainRepositories(env, privateTransport(env.DOMAIN_IO, env.DEV_BUILD_SHA || 'local')));
        this.devEnv = env;
        this.devState = state;
        this.cloud = provider;
    }

    async fetch(request: Request): Promise<Response> {
        const path = new URL(request.url).pathname;
        if (path === '/api/dev/runtime' && request.method === 'GET') {
            requireDev(this.devEnv);
            const domain = await privateExecutor(this.devEnv.DOMAIN_IO).manifest();
            return Response.json({
                project: 'pgt-bjj-dev',
                worker: 'pgt-github-probe-dev',
                build: this.devEnv.DEV_BUILD_SHA || 'local',
                domainBuild: domain.build,
                revision: RUNTIME_REVISION
            }, {headers: {'Cache-Control': 'no-store'}});
        }
        const response = path === '/api/dev/budget-smoke' ? await this.smoke(request) : path === '/api/dev/firestore-preflight' ? await this.check(request) : await this.serial(() => path.startsWith('/api/dev/') ? this.fixture(request) : this.online(request));
        return stamped(response, 'X-PGT-Coordinator-Build', this.devEnv.DEV_BUILD_SHA || 'local');
    }

    private serial<T>(action: () => Promise<T>): Promise<T> {
        // Gate incoming events rather than carrying their I/O across a shared
        // promise chain. Memoized reads exist only for this single event.
        return this.devState.blockConcurrencyWhile(async () => {
            const store = this.cloud();
            store.beginOperation();
            try {
                return await action();
            } finally {
                store.endOperation();
            }
        });
    }

    private async online(request: Request): Promise<Response> {
        const url = new URL(request.url), path = url.pathname;
        let operationStage = 'GUARD';
        try {
            requireDev(this.devEnv);
            const origin = request.headers.get('Origin');
            if (origin !== null && origin !== 'https://pgt-github-probe-dev.david-dzm5.workers.dev') throw new ApiError(403, 'ORIGIN_FORBIDDEN');
            if (!path.startsWith('/api/app/')) throw new ApiError(404, 'ENDPOINT_NOT_FOUND');
            if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.get('X-PGT-Client') !== 'firestore-dev-structured-v2') throw new ApiError(426, 'CLIENT_UPDATE_REQUIRED');
            if (await this.devState.storage.get('structured-maintenance-active')) throw new ApiError(503, 'DEV_MAINTENANCE_IN_PROGRESS');
            if (!(await this.cloud().db.get('settings/schema'))?.data.model) throw new ApiError(503, 'ORIGINAL_CATALOG_INITIALIZATION_REQUIRED');
            await this.limit(request, path);
            if (path === '/api/app/realtime' && request.method === 'GET') return await this.open(request, url);
            if (path === '/api/app/realtime-ticket' && request.method === 'POST') {
                if (origin !== 'https://pgt-github-probe-dev.david-dzm5.workers.dev') throw new ApiError(403, 'ORIGIN_FORBIDDEN');
                const body = await jsonBody(request);
                onlyFields(body, []);
                const auth = await this.authorize(request);
                const key = 'ws-rate:' + auth.sessionHash,
                    previous = await this.devState.storage.get<{ time: number; count: number }>(key);
                const rate = previous && Date.now() - previous.time < 60000 ? previous : {time: Date.now(), count: 0};
                if (++rate.count > 12) throw new ApiError(429, 'REALTIME_RATE_LIMIT');
                await this.devState.storage.put(key, rate);
                await this.devState.storage.setAlarm(Date.now() + 30000);
                const ticket = opaqueToken();
                await this.devState.storage.put('ws-ticket:' + await fingerprint(ticket), {
                    ...auth,
                    expires: Date.now() + 30000
                });
                return Response.json({ticket}, {headers: {'Cache-Control': 'no-store'}});
            }
            // Schedule before the first possible commit: the Firestore outbox remains
            // recoverable even if the isolate dies between commit and publication.
            await this.devState.storage.setAlarm(Date.now() + 15000);
            try {
                operationStage = 'QUERY_RUN';
                const entries: [string, unknown][] = [...await this.devState.storage.list({prefix: 'app-session:'}), ...await this.devState.storage.list({prefix: 'plan-update:'})];
                const result = await privateExecutor(this.devEnv.DOMAIN_IO).run(request, entries);
                operationStage = 'QUERY_RESULT';
                if (result.build !== (this.devEnv.DEV_BUILD_SHA || 'local')) throw new ApiError(503, 'DOMAIN_BUILD_MISMATCH');
                const changes = result.changes;
                if (changes.some(change => !sessionKey(change.key))) throw new ApiError(500, 'PRIVATE_SESSION_KEY_INVALID');
                if (changes.length) await this.devState.storage.transaction(async transaction => {
                    for (const change of changes) {
                        if (change.deleted) await transaction.delete(change.key); else await transaction.put(change.key, change.value);
                    }
                });
                operationStage = 'QUERY_RESPONSE';
                return new Response(result.body, {status: result.status, headers: result.headers});
            } finally {
                await this.flush(request.method !== 'GET').catch(error => console.warn('PGT_REALTIME_RETRY_SCHEDULED', error instanceof ApiError ? error.message : 'RUNTIME_ERROR'));
            }
        } catch (error) {
            const reason = runtimeReason(error);
            return Response.json({error: error instanceof ApiError ? error.message : 'FIRESTORE_DEV_UNAVAILABLE_' + operationStage + '_' + reason, ...(error instanceof ApiError && error.size ? {size: error.size} : {})}, {
                status: error instanceof ApiError ? error.status : 503,
                headers: {'Cache-Control': 'no-store'}
            });
        }
    }

    private async limit(request: Request, path: string) {
        const limits: [string, number][] = [['global', 600], ['ip:' + await fingerprint(request.headers.get('CF-Connecting-IP') || 'local'), 180]];
        if (request.method !== 'GET' && !['/api/app/login', '/api/app/logout', '/api/app/realtime-ticket'].includes(path)) limits.push(['writes', 30]);
        if (['/api/app/login', '/api/app/register'].includes(path)) limits.push(['login:' + await fingerprint(request.headers.get('CF-Connecting-IP') || 'local'), 6]);
        const time = Math.floor(Date.now() / 60000);
        for (const [name, max] of limits) {
            const key = 'dev-rate:' + name, old = await this.devState.storage.get<{ time: number; count: number }>(key),
                value = old?.time === time ? old : {time, count: 0};
            if (++value.count > max) throw new ApiError(429, 'PGT_RATE_LIMIT', 60);
            await this.devState.storage.put(key, value);
        }
    }

    private async authorize(request: Request) {
        const token = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
        if (!token) throw new ApiError(401, 'SESSION_REQUIRED');
        return this.authorizeHash(await fingerprint(token));
    }

    private async authorizeHash(sessionHash: string) {
        const session = await this.devState.storage.get<{
            mail: string;
            pwdFingerprint: string;
            role?: string
        }>('app-session:' + sessionHash);
        if (!session) throw new ApiError(401, 'SESSION_REVOKED');
        const record = await this.cloud().read<Profile>({kind: 'user', mail: session.mail});
        if (!record?.data.pwd || session.role !== record.data.perfil || session.pwdFingerprint !== await fingerprint(record.data.pwd)) throw new ApiError(401, 'SESSION_REVOKED');
        return {sessionHash, mail: session.mail, role: record.data.perfil};
    }

    private async open(request: Request, url: URL) {
        if (request.headers.get('Origin') !== 'https://pgt-github-probe-dev.david-dzm5.workers.dev' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') throw new ApiError(403, 'REALTIME_UPGRADE_REQUIRED');
        const ticket = url.searchParams.get('ticket') || '';
        if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw new ApiError(401, 'REALTIME_TICKET_REQUIRED');
        const key = 'ws-ticket:' + await fingerprint(ticket), saved = await this.devState.storage.get<{
            sessionHash: string;
            mail: string;
            role: string;
            expires: number
        }>(key);
        await this.devState.storage.delete(key);
        if (!saved || saved.expires < Date.now()) throw new ApiError(401, 'REALTIME_TICKET_EXPIRED');
        const current = await this.authorizeHash(saved.sessionHash);
        if (current.role !== saved.role) throw new ApiError(401, 'SESSION_REVOKED');
        const sockets = this.devState.getWebSockets();
        if (sockets.length >= 100 || sockets.filter(ws => ws.deserializeAttachment()?.sessionHash === current.sessionHash).length >= 4) throw new ApiError(429, 'REALTIME_CONNECTION_LIMIT');
        const pair = new WebSocketPair(), [client, server] = Object.values(pair);
        this.devState.acceptWebSocket(server);
        server.serializeAttachment(current);
        server.send(JSON.stringify({type: 'ready', id: crypto.randomUUID()}));
        await this.devState.storage.setAlarm(Date.now() + 15000);
        return new Response(null, {status: 101, webSocket: client});
    }

    private async flush(recover = false) {
        // Batch the cloud reads near Firestore. Only authorization/event metadata
        // crosses the coordinator RPC, and ACK still follows actual publication.
        const sockets = this.devState.getWebSockets(), sessions: RealtimeSession[] = [], seen = new Set<string>();
        for (const ws of sockets) {
            const hash = ws.deserializeAttachment()?.sessionHash;
            if (hash && !seen.has(hash)) {
                seen.add(hash);
                sessions.push({sessionHash: hash, session: await this.devState.storage.get('app-session:' + hash)});
            }
        }
        const io = privateExecutor(this.devEnv.DOMAIN_IO), snapshot = await io.realtime(sessions, recover);
        if (snapshot.build !== (this.devEnv.DEV_BUILD_SHA || 'local')) throw new ApiError(503, 'REALTIME_BUILD_MISMATCH');
        const changes = snapshot.changes, actors = new Map(snapshot.actors.map(actor => [actor.sessionHash, actor]));
        for (const ws of sockets) {
            const attached = ws.deserializeAttachment(), actor = actors.get(attached?.sessionHash);
            if (!actor || actor.role !== attached.role) {
                ws.close(4401, 'SESSION_REVOKED');
                continue;
            }
            const relevant = changes.some(c => !c.owner || actor.role === 'entrenador' || c.owner === actor.mail);
            if (relevant) try {
                ws.send(JSON.stringify({
                    type: 'changed',
                    id: changes.at(-1)!.version,
                    own: changes.some(c => !c.owner || c.owner === actor.mail)
                }));
            } catch {
                ws.close(1011, 'RECONNECT');
            }
        }
        if (changes.length) await io.acknowledge(changes);
        // Drain bounded pages and expire tickets without retaining business in SQLite.
        if (changes.length === 100) await this.devState.storage.setAlarm(Date.now() + 1000);
        else await this.devState.storage.deleteAlarm();
        for (const [key, value] of await this.devState.storage.list<{
            expires: number
        }>({prefix: 'ws-ticket:'})) if (value.expires < Date.now()) await this.devState.storage.delete(key);
    }

    async alarm() {
        return this.serial(async () => {
            try {
                await this.flush(true);
            } catch {
                await this.devState.storage.setAlarm(Date.now() + 60000);
            }
        });
    }

    webSocketMessage(ws: WebSocket, _message: string | ArrayBuffer) {
        // Server-only invalidations: no client messages can cause Firestore reads,
        // writes or an unbounded authentication loop while the socket is idle.
        ws.close(1008, 'INVALID_MESSAGE');
    }

    webSocketClose(ws: WebSocket, code: number) {
        ws.close(code === 1006 ? 1000 : code);
    }

    webSocketError(ws: WebSocket) {
        ws.close(1011, 'RECONNECT');
    }

    private async smoke(request: Request) {
        try {
            requireDev(this.devEnv);
            if (request.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED');
            if (request.headers.get('Origin') !== 'https://pgt-github-probe-dev.david-dzm5.workers.dev') throw new ApiError(403, 'ORIGIN_FORBIDDEN');
            await authorizePreflight(request, this.devEnv, (url, init) => fetch(url, init));
            const body = await jsonBody(request, 32768);
            onlyFields(body, ['quota', 'plan']);
            const build = this.devEnv.DEV_BUILD_SHA;
            const limits = checkSmokeGate(body.quota, body.plan, {build});
            const plan = body.plan as { users: number; total: { reads: number; writes: number; deletes: number } };
            if (plan.users !== 1 || plan.total.reads !== 200 || plan.total.writes !== 150 || plan.total.deletes !== 50) throw new ApiError(409, 'SMOKE_PLAN_NOT_MEASURED');
            if (!this.devEnv.DOMAIN_IO.idFromName) throw new ApiError(503, 'SMOKE_BINDING_UNAVAILABLE');
            // One deterministic durable ledger per deployed build, never reset by rerun.
            const id = this.devEnv.DOMAIN_IO.idFromName('controlled-smoke:' + build).toString(),
                meter = budgetExecutor(this.devEnv.DOMAIN_IO, id);
            const prepared = await meter.budgetPrepareSmoke({
                project: 'pgt-bjj-dev',
                build: build!,
                limits,
                cleanup: {reads: 55, writes: 0, deletes: 47},
                expiresAt: Date.now() + 5 * 60000,
                runId: crypto.randomUUID()
            });
            if (!prepared.ok) return Response.json({error: prepared.error}, {
                status: prepared.status || 503,
                headers: {'Cache-Control': 'no-store'}
            });
            const actor = privateExecutor(this.devEnv.DOMAIN_IO);
            if (!actor.smoke) throw new ApiError(503, 'SMOKE_BINDING_UNAVAILABLE');
            const result = await actor.smoke({id, phase: 'scenario', build});
            if (result.build !== build) throw new ApiError(503, 'SMOKE_BUILD_MISMATCH');
            return Response.json(result, {
                status: result.status === 'DEV_MINIMAL_SMOKE_VERIFIED' && result.cleanup.clean && result.budgetClosed ? 200 : 503,
                headers: {'Cache-Control': 'no-store'}
            });
        } catch (error) {
            return Response.json({error: error instanceof ApiError ? error.message : 'DEV_SMOKE_FAILED'}, {
                status: error instanceof ApiError ? error.status : 503,
                headers: {'Cache-Control': 'no-store'}
            });
        }
    }

    private async fixture(request: Request) {
        try {
            requireDev(this.devEnv);
            if (request.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED');
            if (request.headers.get('Origin') !== 'https://pgt-github-probe-dev.david-dzm5.workers.dev') throw new ApiError(403, 'ORIGIN_FORBIDDEN');
            await authorizePreflight(request, this.devEnv, (url, init) => fetch(url, init));
            const body = await jsonBody(request, 256 * 1024), path = new URL(request.url).pathname;
            if (path === '/api/dev/structured-maintenance') return Response.json(await new DevMaintenance(this.cloud().db, this.devState.storage).step(body));
            if (path === '/api/dev/structured-qa-runs') {
                onlyFields(body, []);
                return Response.json({
                    runs: (await this.cloud().db.list('qa_runs')).map(r => ({
                        id: r.id,
                        purpose: r.data.purpose
                    }))
                });
            }
            if (path === '/api/dev/structured-bootstrap') {
                onlyFields(body, []);
                const old = (await this.cloud().db.collectionIds()).filter(c => ['pgt_resources', 'pgt_changes', 'pgt_qa_runs'].includes(c));
                if (old.length) throw new ApiError(409, 'LEGACY_CLEANUP_REQUIRED');
                const report = await initializeReference(this.cloud(), this.devEnv.GITHUB_DATA_TOKEN);
                await new DevMaintenance(this.cloud().db, this.devState.storage).ready();
                return Response.json(report);
            }
            if (!['/api/dev/synthetic-fixture', '/api/dev/synthetic-fixture-cleanup', '/api/dev/synthetic-fixture-check'].includes(path)) throw new ApiError(404, 'ENDPOINT_NOT_FOUND');
            onlyFields(body, ['runId', 'password']);
            if (typeof body.runId !== 'string' || typeof body.password !== 'string') throw new ApiError(400, 'SYNTHETIC_FIXTURE_INVALID');
            await this.devState.storage.setAlarm(Date.now() + 15000);
            try {
                let result;
                if (path.endsWith('-check')) result = await checkStructuredQA(this.cloud(), body.runId, body.password);
                else if (new URL(request.url).pathname.endsWith('-cleanup')) {
                    result = await cleanStructuredQA(this.cloud(), body.runId);
                    const mails = ['trainer', 'student', 'other'].map(role => `pgt-dev-${body.runId}-${role}@example.test`);
                    for (const [key, session] of await this.devState.storage.list<{
                        mail: string
                    }>({prefix: 'app-session:'})) if (mails.includes(session.mail)) await this.devState.storage.delete(key);
                    for (const mail of mails) for (const key of (await this.devState.storage.list({prefix: 'plan-update:' + mail + ':'})).keys()) await this.devState.storage.delete(key);
                } else result = await seedStructuredQA(this.cloud(), body.runId, body.password);
                return Response.json(result, {headers: {'Cache-Control': 'no-store'}});
            } finally {
                await this.flush(true).catch(() => console.warn('PGT_REALTIME_RETRY_SCHEDULED'));
            }
        } catch (error) {
            return Response.json({error: error instanceof ApiError ? error.message : 'SYNTHETIC_FIXTURE_FAILED'}, {status: error instanceof ApiError ? error.status : 503});
        }
    }

    private async check(request: Request): Promise<Response> {
        try {
            requireDev(this.devEnv);
            if (request.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED');
            if (request.headers.get('Origin') !== 'https://pgt-github-probe-dev.david-dzm5.workers.dev') throw new ApiError(403, 'ORIGIN_FORBIDDEN');
            await authorizePreflight(request, this.devEnv, (input, init) => fetch(input, init));
            if (this.preflight) throw new ApiError(409, 'PREFLIGHT_IN_PROGRESS');
            this.preflight = firestorePreflight(this.devEnv).then(value => Response.json(value, {headers: {'Cache-Control': 'no-store'}}));
            try {
                return await this.preflight;
            } finally {
                this.preflight = undefined;
            }
        } catch (error) {
            return Response.json({error: error instanceof ApiError ? error.message : 'FIRESTORE_PREFLIGHT_FAILED', ...(error instanceof PreflightFailure ? {diagnostic: error.diagnostic} : {})}, {
                status: error instanceof ApiError ? error.status : 503,
                headers: {'Cache-Control': 'no-store'}
            });
        }
    }
}
