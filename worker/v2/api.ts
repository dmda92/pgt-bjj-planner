import { MAX_APP_BODY_BYTES } from '../../src/domain/json-limits.ts';
import { ApiError, fingerprint, jsonBody } from '../security.ts';
import { V2ReadApi, type SessionLookup } from './read-api.ts';
import type { QueryCoordinator, QuerySession } from './query-coordinator.ts';
import { TextCommands, type TextCommand } from './text-commands.ts';
import { UserService, type SessionStorage } from './users.ts';
import { BusinessCommands } from './business.ts';

/** Controlled DEV API mounted by runtime.ts, which supplies origin/rate controls
 * and the academy's sole serialized coordinator.
 */
export class V2Api {
    private readonly reads: V2ReadApi;
    private readonly sessions: SessionLookup;
    private readonly texts: TextCommands;
    private readonly users?: UserService;
    private readonly business: BusinessCommands;
    private readonly coordinator: QueryCoordinator;
    constructor(sessions: SessionLookup, coordinator: QueryCoordinator, texts = new TextCommands(coordinator)) {
        this.sessions = sessions; this.reads = new V2ReadApi(sessions, coordinator); this.texts = texts;
        this.coordinator = coordinator; this.business = new BusinessCommands(coordinator, coordinator.planViews);
        if ('put' in sessions) this.users = new UserService(coordinator, sessions as SessionStorage);
    }
    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const route = url.pathname.match(/^\/api\/v2\/(auth\/(login|register|logout)|commands\/(text|profile|password|role|repertoire|comments|competition|assignment|delete-competition|prepare))$/);
        if (!route) return this.reads.fetch(request);
        const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
        if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } });
        let sessionKey: string | undefined;
        try {
            if (url.search) throw new ApiError(400, 'QUERY_INVALID');
            if (route[2] === 'login' || route[2] === 'register') {
                if (!this.users) throw new ApiError(503, 'SESSION_STORAGE_REQUIRED');
                const input = await jsonBody(request, MAX_APP_BODY_BYTES);
                return reply(await this.users[route[2]](input), route[2] === 'register' ? 201 : 200);
            }
            const token = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
            if (!token) throw new ApiError(401, 'SESSION_REQUIRED');
            sessionKey = 'pgt-v2-session:' + await fingerprint(token);
            const session = await this.sessions.get<QuerySession>(sessionKey);
            if (!session) throw new ApiError(401, 'SESSION_REVOKED');
            if (route[2] === 'logout') { await this.sessions.delete(sessionKey); return reply({ status: 'LOGGED_OUT' }); }
            const input = await jsonBody(request, MAX_APP_BODY_BYTES);
            if (['repertoire', 'comments', 'competition', 'assignment', 'delete-competition', 'prepare'].includes(route[3])) {
                const kind = route[3];
                const result = kind === 'repertoire' ? await this.business.repertoire(session, input) : kind === 'comments' ? await this.business.comments(session, input) :
                    await this.business.competition(session, kind as 'competition' | 'assignment' | 'delete-competition' | 'prepare', input);
                if (kind === 'repertoire' || kind === 'comments') {
                    const value = await this.coordinator.user(session, { kind: kind === 'repertoire' ? 'repertoire' : 'comments', owner: String(input.owner || session.mail) });
                    return reply({ ...result, data: value?.data, sha: value?.version });
                }
                return reply(result);
            }
            if (route[3] !== 'text') {
                if (!this.users) throw new ApiError(503, 'SESSION_STORAGE_REQUIRED');
                return reply(await this.users.change(session, route[3] as 'profile' | 'password' | 'role', input));
            }
            return reply(await this.texts.execute(session, input as TextCommand));
        } catch (error) {
            if (error instanceof ApiError) {
                if (error.status === 401 && sessionKey) await this.sessions.delete(sessionKey);
                return reply({ error: error.message, ...(error.size ? { size: error.size } : {}) }, error.status);
            }
            return reply({ error: 'INTERNAL_ERROR' }, 500);
        }
    }
}
