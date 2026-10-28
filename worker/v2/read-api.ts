import { ApiError, fingerprint } from '../security.ts';
import { QueryCoordinator, type QuerySession } from './query-coordinator.ts';

export interface SessionLookup {
    get<T>(key: string): Promise<T | undefined>;
    delete(key: string): Promise<boolean>;
}
const response = (data: unknown, status = 200) => Response.json(data, {
    status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
});

/** Controlled read contracts mounted by worker/dev.ts through runtime.ts.
 * CORS/rate limits belong to the entrypoint; reads never prepare projections.
 */
export class V2ReadApi {
    private readonly sessions: SessionLookup;
    private readonly queries: QueryCoordinator;
    constructor(sessions: SessionLookup, queries: QueryCoordinator) {
        this.sessions = sessions; this.queries = queries;
    }
    async fetch(request: Request): Promise<Response> {
        let sessionKey: string | undefined;
        try {
            const url = new URL(request.url), path = url.pathname;
            const user = path.match(/^\/api\/v2\/users\/([^/]+)\/(profile|repertoire|comments|assignment)$/);
            const plan = path.match(/^\/api\/v2\/users\/([^/]+)\/plans\/([^/]+)$/);
            const agenda = path.match(/^\/api\/v2\/agenda\/(\d{4}-\d{2})$/);
            const snapshot = path.match(/^\/api\/v2\/users\/([^/]+)\/snapshot$/);
            const day = path === '/api/v2/training-day';
            if (!user && !plan && !agenda && !snapshot && !day && !['/api/v2/catalog', '/api/v2/roster'].includes(path))
                throw new ApiError(404, 'ENDPOINT_NOT_FOUND');
            if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET', 'Cache-Control': 'no-store' } });
            for (const key of url.searchParams.keys())
                if (!((plan || day) && key === 'date' || snapshot && key === 'known')) throw new ApiError(400, 'QUERY_INVALID');
            if (url.searchParams.getAll('date').length > 1) throw new ApiError(400, 'QUERY_INVALID');
            const token = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
            if (!token) throw new ApiError(401, 'SESSION_REQUIRED');
            sessionKey = 'pgt-v2-session:' + await fingerprint(token);
            const session = await this.sessions.get<QuerySession>(sessionKey);
            if (!session) throw new ApiError(401, 'SESSION_REVOKED');
            if (snapshot) {
                const value = url.searchParams.get('known') || '{}';
                if (value.length > 65536) throw new ApiError(400, 'QUERY_INVALID');
                let known: Record<string, string>;
                try { known = JSON.parse(value); if (!known || Array.isArray(known) || typeof known !== 'object' || Object.values(known).some(v => typeof v !== 'string' || v.length > 100)) throw Error(); }
                catch { throw new ApiError(400, 'QUERY_INVALID'); }
                return response(await this.queries.snapshot(session, decodeURIComponent(snapshot[1]), known));
            }
            if (day) return response(await this.queries.trainingDay(session, url.searchParams.get('date') || ''));
            if (user) {
                const owner = decodeURIComponent(user[1]), kind = user[2] as 'profile' | 'repertoire' | 'comments' | 'assignment';
                return response(await this.queries.user(session, { owner, kind }));
            }
            if (plan) return response(await this.queries.plan(session, decodeURIComponent(plan[1]), plan[2], url.searchParams.get('date') ?? undefined));
            if (agenda) return response(await this.queries.shared(session, { kind: 'agenda', month: agenda[1] }));
            return response(await this.queries.shared(session, { kind: path.endsWith('/catalog') ? 'catalog' : 'roster' }));
        } catch (error) {
            if (error instanceof URIError) return response({ error: 'QUERY_INVALID' }, 400);
            if (error instanceof ApiError) {
                if (error.status === 401 && sessionKey) await this.sessions.delete(sessionKey);
                return response({ error: error.message }, error.status);
            }
            return response({ error: 'INTERNAL_ERROR' }, 500);
        }
    }
}
