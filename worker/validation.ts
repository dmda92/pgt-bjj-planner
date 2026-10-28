import { ApiError, fingerprint } from './security.ts';
import { resolveFirestoreTarget } from './firestore-target.ts';
import type { PreflightEnv } from './firestore-preflight.ts';
import type { Transport } from './firestore-auth.ts';
import { NativeFirestore } from './structured/firestore.ts';
import { NativeAggregates } from './v2/aggregates.ts';
import { PlanRepository } from './v2/plans.ts';
import { PlanViews } from './v2/plan-views.ts';
import { QueryCoordinator, type QuerySession } from './v2/query-coordinator.ts';
import { V2ReadApi } from './v2/read-api.ts';
import { sessionEpoch, type SessionProfile } from './v2/session-identity.ts';

export interface ValidationEnv extends PreflightEnv {
    VALIDATION_ORIGIN?: string; VALIDATION_ACCESS_ISSUER?: string; VALIDATION_ACCESS_AUD?: string;
    VALIDATION_ALLOWED_EMAILS?: string; VALIDATION_ACTOR_EMAIL?: string;
    VALIDATION_NAMESPACE?: string; VALIDATION_SOURCE_COMMIT?: string; VALIDATION_BUNDLE_CHECKSUM?: string;
}
const fail = (code: string, status = 503): never => { throw new ApiError(status, code); };
export function validationConfig(env: ValidationEnv) {
    const target = resolveFirestoreTarget(env);
    if (target.environment !== 'pro' || target.serviceAccountEmail !== 'pgt-validator-pro@pgt-bjj-pro.iam.gserviceaccount.com') fail('VALIDATION_READONLY_PRINCIPAL_REQUIRED');
    if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.VALIDATION_ACCESS_ISSUER || '') ||
        !/^[a-f0-9]{64}$/.test(env.VALIDATION_ACCESS_AUD || '') ||
        !/^https:\/\/[a-z0-9.-]+$/.test(env.VALIDATION_ORIGIN || '') ||
        !/^pgt_v2\/import-[a-f0-9]{24}$/.test(env.VALIDATION_NAMESPACE || '') ||
        !/^[a-f0-9]{40}$/.test(env.VALIDATION_SOURCE_COMMIT || '') || !/^[a-f0-9]{64}$/.test(env.VALIDATION_BUNDLE_CHECKSUM || '') || env.VALIDATION_NAMESPACE !== 'pgt_v2/import-' + env.VALIDATION_BUNDLE_CHECKSUM?.slice(0, 24)) fail('VALIDATION_CONFIGURATION_REQUIRED');
    const emails = (env.VALIDATION_ALLOWED_EMAILS || '').split(',').map(v => v.trim().toLowerCase());
    const mail = env.VALIDATION_ACTOR_EMAIL || '';
    if (!emails.length || emails.some(v => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail) || mail !== mail.toLowerCase()) fail('VALIDATION_IDENTITY_REQUIRED');
    return { target, emails, mail, namespace: env.VALIDATION_NAMESPACE!, commit: env.VALIDATION_SOURCE_COMMIT! };
}
const decode = (value: string) => {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) return fail('ACCESS_JWT_INVALID', 403);
    try { return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0)); }
    catch { return fail('ACCESS_JWT_INVALID', 403); }
};
/** Header presence alone is never authentication. Verify Access signature, issuer,
 * audience, time and explicit owner allowlist on EVERY request, including HTML. */
export async function authorizeValidation(request: Request, env: ValidationEnv, transport: Transport = fetch, now = Date.now()) {
    const config = validationConfig(env), token = request.headers.get('Cf-Access-Jwt-Assertion') || '';
    if (token.length > 16384 || token.split('.').length !== 3) fail('ACCESS_REQUIRED', 403);
    try {
        const [h, p, s] = token.split('.'), header = JSON.parse(new TextDecoder().decode(decode(h))), payload = JSON.parse(new TextDecoder().decode(decode(p)));
        const seconds = Math.floor(now / 1000);
        if (header.alg !== 'RS256' || typeof header.kid !== 'string' || payload.iss !== env.VALIDATION_ACCESS_ISSUER ||
            !Array.isArray(payload.aud) || !payload.aud.includes(env.VALIDATION_ACCESS_AUD) ||
            !Number.isInteger(payload.exp) || payload.exp <= seconds || payload.exp > seconds + 86400 ||
            !Number.isInteger(payload.iat) || payload.iat > seconds + 30 ||
            payload.nbf !== undefined && (!Number.isInteger(payload.nbf) || payload.nbf > seconds) ||
            typeof payload.sub !== 'string' || !payload.sub || typeof payload.email !== 'string' || !config.emails.includes(payload.email.toLowerCase())) fail('ACCESS_FORBIDDEN', 403);
        const keys = await transport(env.VALIDATION_ACCESS_ISSUER + '/cdn-cgi/access/certs', { redirect: 'manual', signal: AbortSignal.timeout(10000) });
        if (!keys.ok) fail('ACCESS_KEYS_UNAVAILABLE');
        const body = await keys.json() as { keys?: (JsonWebKey & { kid?: string })[] };
        const jwk = body.keys?.find(k => k.kid === header.kid && k.kty === 'RSA' && (!k.alg || k.alg === 'RS256') && (!k.use || k.use === 'sig'));
        if (!jwk) throw new ApiError(403, 'ACCESS_FORBIDDEN');
        const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
        if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(s), new TextEncoder().encode(h + '.' + p))) fail('ACCESS_FORBIDDEN', 403);
    } catch (error) { if (error instanceof ApiError) throw error; fail('ACCESS_JWT_INVALID', 403); }
    return config;
}
/** Defense in depth, independent from Firestore IAM. No commit, transactions,
 * queries, initialization, repairs, housekeeping or redirects can cross this gate. */
export function readOnlyValidationTransport(env: ValidationEnv, transport: Transport = fetch): Transport {
    const { target, namespace } = validationConfig(env), prefix = 'https://firestore.googleapis.com/v1/' + target.databaseName + '/documents/';
    const allowed = (name: string) => (name === 'pgt_v2/control' || name === namespace || name.startsWith(namespace + '/')) && /^[A-Za-z0-9@._+/-]+$/.test(name) && name.split('/').every(v => v && v !== '.' && v !== '..');
    return async (input, init = {}) => {
        const method = (init.method || 'GET').toUpperCase();
        if (input === 'https://oauth2.googleapis.com/token' && method === 'POST') return transport(input, { ...init, redirect: 'manual' });
        if (input.startsWith(prefix) && method === 'GET' && !input.includes('?') && allowed(input.slice(prefix.length))) return transport(input, { ...init, redirect: 'manual' });
        if (input === prefix.slice(0, -1) + ':batchGet' && method === 'POST') {
            let body: { documents?: unknown[] };
            try { body = JSON.parse(String(init.body)); } catch { return fail('VALIDATION_TRANSPORT_FORBIDDEN', 403); }
            const names = body.documents;
            if (names?.length && names.length <= 100 && Object.keys(body).every(k => k === 'documents') && names.every(n => typeof n === 'string' && n.startsWith(target.databaseName + '/documents/') && allowed(n.slice((target.databaseName + '/documents/').length)))) return transport(input, { ...init, redirect: 'manual' });
        }
        return fail('VALIDATION_TRANSPORT_FORBIDDEN', 403);
    };
}
export async function validationReadApi(env: ValidationEnv, transport: Transport = fetch) {
    const config = validationConfig(env), db = new NativeFirestore(env, readOnlyValidationTransport(env, transport));
    const control = await db.get('pgt_v2/control'), verified = await db.get(config.namespace);
    if (control?.data.phase !== 'active' || control.data.project !== config.target.project || control.data.database !== config.target.database || control.data.bundleChecksum !== env.VALIDATION_BUNDLE_CHECKSUM || control.data.namespace !== config.namespace || control.data.sourceCommit !== config.commit ||
        verified?.data.phase !== 'verified' || verified.data.target !== config.target.project || verified.data.bundleChecksum !== env.VALIDATION_BUNDLE_CHECKSUM || verified.data.active !== true || verified.data.sourceCommit !== config.commit) fail('VALIDATION_DATASET_NOT_PINNED');
    const store = new NativeAggregates(db, config.namespace), profile = await store.read<SessionProfile>({ kind: 'profile', id: config.mail });
    if (!profile || profile.data.perfil !== 'entrenador' || profile.data.mail !== config.mail || !profile.data.pwd) throw new ApiError(503, 'VALIDATION_TRAINER_REQUIRED');
    const session: QuerySession = { mail: config.mail, role: 'entrenador', pwdFingerprint: await fingerprint(profile.data.pwd), sessionEpoch: sessionEpoch(profile.data) };
    const queries = new QueryCoordinator(store, new PlanViews(new PlanRepository(db, config.namespace), store));
    // Ephemeral trusted actor, neither browser token nor durable session. Delete is
    // intentionally a no-op; auth failure has no persistence side effects.
    return new V2ReadApi({ get: async <T>() => session as T, delete: async () => false }, queries);
}
const securityHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" };
export function createValidationWorker(transport: Transport = fetch, reader = validationReadApi) {
    return { async fetch(request: Request, env: ValidationEnv): Promise<Response> {
        try {
            await authorizeValidation(request, env, transport);
            const url = new URL(request.url);
            if (url.origin !== env.VALIDATION_ORIGIN || request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) fail('VALIDATION_ORIGIN_FORBIDDEN', 403);
            if (request.method !== 'GET' || request.headers.has('Upgrade')) fail('VALIDATION_READ_ONLY', 405);
            if (url.pathname === '/') return new Response(html, { headers: { ...securityHeaders, 'Content-Type': 'text/html; charset=utf-8' } });
            if (url.pathname === '/validation.js') return new Response(script, { headers: { ...securityHeaders, 'Content-Type': 'text/javascript; charset=utf-8' } });
            if (url.pathname === '/validation.css') return new Response(css, { headers: { ...securityHeaders, 'Content-Type': 'text/css; charset=utf-8' } });
            // Closed route allowlist BEFORE constructing any Firestore client.
            if (!/^\/api\/v2\/(?:catalog|roster|training-day|agenda\/\d{4}-\d{2}|users\/[^/]+\/(?:profile|repertoire|comments|assignment|snapshot|plans\/[a-f0-9-]{36}))$/.test(url.pathname)) fail('VALIDATION_ROUTE_FORBIDDEN', 404);
            const api = await reader(env, transport), headers = new Headers(request.headers);
            headers.set('Authorization', 'Bearer ' + 'V'.repeat(43));
            const result = await api.fetch(new Request(request, { headers }));
            const output = new Response(result.body, result); Object.entries(securityHeaders).forEach(([k, v]) => output.headers.set(k, v)); return output;
        } catch (error) {
            return Response.json({ error: error instanceof ApiError ? error.message : 'VALIDATION_UNAVAILABLE' }, { status: error instanceof ApiError ? error.status : 503, headers: securityHeaders });
        }
    } };
}
export default createValidationWorker();
const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/validation.css"><title>PGT \u00b7 Validaci\u00f3n de migraci\u00f3n</title><main><h1>Validaci\u00f3n de datos migrados</h1><p>Inspector temporal de solo lectura. Acceso verificado por Cloudflare Access. No permite editar, reparar ni sincronizar.</p><nav><button data-path="roster">Usuarios</button><button data-path="catalog">Competiciones</button><button data-path="training-day">Entrenamiento</button></nav><label>Correo del alumno o entrenador<input id="owner" type="email" autocomplete="off"></label><nav><button data-owner="profile">Perfil</button><button data-owner="repertoire">T\u00e9cnicas</button><button data-owner="comments">Comentarios</button><button data-owner="assignment">Asignaciones</button><button data-owner="snapshot">Planes e hist\u00f3rico</button></nav><p id="status" role="status"></p><pre id="result" tabindex="0"></pre></main><script src="/validation.js"></script></html>`;
const script = `const status=document.querySelector('#status'),result=document.querySelector('#result');async function load(path){status.textContent='Cargando\u2026';result.textContent='';try{const r=await fetch('/api/v2/'+path,{cache:'no-store'}),data=await r.json();status.textContent=r.ok?'Consulta completada':'No se pudo consultar';result.textContent=JSON.stringify(data,null,2)}catch{status.textContent='Error de conexi\u00f3n'}}document.querySelectorAll('[data-path]').forEach(b=>b.onclick=()=>load(b.dataset.path));document.querySelectorAll('[data-owner]').forEach(b=>b.onclick=()=>{const i=document.querySelector('#owner');if(i.reportValidity()&&i.value)load('users/'+encodeURIComponent(i.value.trim().toLowerCase())+'/'+b.dataset.owner)});`;
const css = `body{margin:0;background:#f6f7f9;color:#20313f;font:16px system-ui,sans-serif}main{max-width:1100px;margin:32px auto;padding:24px;background:white}h1{color:#202f3b}nav{display:flex;flex-wrap:wrap;gap:12px;margin:20px 0}button,input{min-height:44px;padding:8px 16px;font:inherit}button{background:#365e7d;color:white;border:0;border-radius:6px;cursor:pointer}input{display:block;margin-top:8px;width:min(450px,85%)}:focus-visible{outline:3px solid #365e7d;outline-offset:4px}pre{max-height:70vh;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #cbdce9;padding:16px;font-size:14px}`;
