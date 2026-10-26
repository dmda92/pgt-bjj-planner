import {ApiError, opaqueToken} from '../security.ts';
import {StructuredAppApi} from './application.ts';
import {DomainRepositories, type EntityRef} from './repositories.ts';
import {SessionReplica} from './session-store.ts';
import {revisionOf} from './firestore.ts';
import {referenceStructure} from './reference-catalog.ts';

export type SmokeOutcome = { status: string; checks: string[]; cleanup: { clean: boolean }; error?: string };
const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : v;
const verify = (value: unknown, code: string) => {
    if (!value) throw new ApiError(503, code);
};

/** One synthetic identity allocated by the private execution record. Physical
 * cleanup touches only that identity and its own events, never global indexes,
 * catalogues, competitions or another QA run. No token/password leaves the RPC. */
export async function cleanupMinimalSmoke(repo: DomainRepositories, runId: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(runId)) throw new ApiError(400, 'SMOKE_RUN_INVALID');
    const mail = `pgt-smoke-${runId}@example.test`;
    for (const kind of ['techniques', 'comments', 'assignment', 'user'] as const) {
        const ref: EntityRef = {kind, mail}, path = repo.path(ref), root = await repo.db.get(path, true);
        // Revisions are limited to this never-shared identity, including partial staging.
        if (kind === 'techniques' || kind === 'comments') for (const revision of await repo.db.list(path + '/revisions')) {
            const children = await repo.db.children(revision.path);
            await repo.db.deleteRows([...children, revision]);
        }
        const credentials = kind === 'user' ? await repo.db.get(path + '/private/credentials', true) : null;
        await repo.db.deleteRows([...(root ? [root] : []), ...(credentials ? [credentials] : [])]);
    }
    const events = await repo.db.query('realtime_events', 'owner', mail);
    await repo.db.deleteRows(events);
    for (const kind of ['techniques', 'comments', 'assignment', 'user'] as const) verify(!await repo.db.get(repo.path({
        kind,
        mail
    }), true), 'SMOKE_CLEANUP_INCOMPLETE');
    return {clean: true};
}

export async function runMinimalSmoke(factory: (phase: 'scenario' | 'cleanup') => DomainRepositories, runId: string): Promise<SmokeOutcome> {
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(runId)) throw new ApiError(400, 'SMOKE_RUN_INVALID');
    const repo = factory('scenario'), mail = `pgt-smoke-${runId}@example.test`, password = opaqueToken(),
        sessions = new SessionReplica([]), checks: string[] = [];
    let owned = false, error: string | undefined, clean = false, token = '';
    const call = async (path: string, method: string, body?: unknown, expected = 200) => {
        repo.beginOperation();
        try {
            const request = new Request('https://pgt-github-probe-dev.david-dzm5.workers.dev' + path, {
                method,
                headers: {'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {})}, ...(body ? {body: JSON.stringify(body)} : {})
            });
            const response = await new StructuredAppApi(sessions, repo).handle(request, new URL(request.url)),
                value = await response.json() as any;
            verify(response.status === expected, 'SMOKE_' + method + '_' + (typeof value.error === 'string' ? value.error : 'UNEXPECTED_STATUS'));
            return value;
        } finally {
            repo.endOperation();
        }
    };
    try {
        repo.beginOperation();
        try {
            verify(!await repo.db.get(repo.path({kind: 'user', mail}), true), 'SMOKE_IDENTITY_ALREADY_EXISTS');
        } finally {
            repo.endOperation();
        }
        owned = true; // Reserved random UUID was absent before any possible creation.
        const registered = await call('/api/app/register', 'POST', {
            mail,
            password,
            confirm: password,
            nombre: 'DEV smoke',
            apellidos: 'Sintético'
        }, 201);
        token = registered.token;
        checks.push('registration');
        const login = await call('/api/app/login', 'POST', {mail, password});
        token = login.token;
        verify(login.profile.perfil === 'alumno', 'SMOKE_ROLE_INVALID');
        checks.push('login');
        const snapshot = await call('/api/app/users/' + encodeURIComponent(mail) + '/snapshot', 'GET');
        repo.beginOperation();
        let schema;
        try {
            schema = await repo.db.get('settings/schema');
        } finally {
            repo.endOperation();
        }
        const checksum = await revisionOf(JSON.stringify(canonical(referenceStructure(snapshot.techniques.data.positions))));
        verify(checksum === schema?.data.structureChecksum, 'SMOKE_REFERENCE_CATALOG_MISMATCH');
        verify(snapshot.plans.length === 0, 'SMOKE_UNEXPECTED_ASSIGNMENT');
        checks.push('original_catalog_order');
        const next = {...snapshot.profile.data, nombre: 'DEV smoke persistido'};
        await call('/api/app/users/' + encodeURIComponent(mail) + '/profile', 'PUT', {
            data: next,
            sha: snapshot.profile.sha
        });
        checks.push('profile_write');
        await call('/api/app/logout', 'POST', {});
        const restored = await call('/api/app/login', 'POST', {mail, password});
        token = restored.token;
        verify(restored.profile.nombre === next.nombre, 'SMOKE_PROFILE_NOT_PERSISTED');
        await call('/api/app/logout', 'POST', {});
        checks.push('logout_login_persistence');
    } catch (e) {
        error = e instanceof ApiError ? e.message : 'SMOKE_RUNTIME_FAILED';
    } finally {
        if (owned) {
            const cleanup = factory('cleanup');
            cleanup.beginOperation();
            try {
                clean = (await cleanupMinimalSmoke(cleanup, runId)).clean;
            } catch (e) {
                error = (error ? error + ';' : '') + (e instanceof ApiError ? e.message : 'SMOKE_CLEANUP_FAILED');
            } finally {
                cleanup.endOperation();
            }
        }
    }
    return {
        status: !error && clean ? 'DEV_MINIMAL_SMOKE_VERIFIED' : 'DEV_MINIMAL_SMOKE_FAILED',
        checks,
        cleanup: {clean}, ...(error ? {error} : {})
    };
}
