import {Fault, fail, mail, random, digest, hashPassword, verifyPassword, constantEqual, seal, unseal, requireOwnMail} from './security.ts';
import {Graph} from './graph.ts';
import {clientHtml} from './ui.ts';

interface Env {
  CONTROL: DurableObjectNamespace;
  MS_CLIENT_ID: string; MS_CLIENT_SECRET: string; TOKEN_ENCRYPTION_KEY: string;
  ADMIN_SETUP_KEY: string; PUBLIC_BASE_URL: string; ALLOWED_ORIGIN: string; OWNER_MAIL: string;
}
interface Tokens {access_token: string; refresh_token: string; expiresAt: number}
interface Session {mail: string; expiresAt: number}
const json = (data: unknown, status = 200): Response => Response.json(data, {status, headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname === '/' && request.method === 'GET') {
      return new Response(clientHtml, {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'", 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'}});
    }
    return env.CONTROL.get(env.CONTROL.idFromName('pgt-control-v1')).fetch(request);
  }
};

export class PgtControl {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private state: DurableObjectState, private env: Env) {}
  fetch(request: Request): Promise<Response> {
    // Serialize complete operations, including OAuth rotation and Graph writes across awaited I/O.
    const result = this.queue.then(() => this.handle(request));
    this.queue = result.catch(() => undefined);
    return result;
  }
  private async body(request: Request): Promise<Record<string, unknown>> {
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) return fail(415, 'JSON requerido');
    if (Number(request.headers.get('Content-Length') || 0) > 65536) fail(413, 'Petición demasiado grande');
    const reader = request.body?.getReader();
    if (!reader) return fail(400, 'Falta cuerpo');
    let text = ''; let count = 0; const decoder = new TextDecoder();
    for (;;) { const {done, value} = await reader.read(); if (done) break; count += value.length; if (count > 65536) {await reader.cancel(); fail(413, 'Petición demasiado grande');} text += decoder.decode(value, {stream: true}); }
    text += decoder.decode();
    try {const value: unknown = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Objeto JSON requerido'); return value as Record<string, unknown>;} catch {return fail(400, 'JSON inválido');}
  }
  private admin(request: Request): void {
    if (!this.env.ADMIN_SETUP_KEY || !constantEqual(request.headers.get('Authorization') || '', `Bearer ${this.env.ADMIN_SETUP_KEY}`)) fail(403, 'Administración no autorizada');
  }
  private async limit(request: Request, sensitive: boolean): Promise<void> {
    const minute = Math.floor(Date.now() / 60000);
    const key = `rate:${minute}:${await digest(request.headers.get('CF-Connecting-IP') || 'local')}`;
    const count = (await this.state.storage.get<number>(key) || 0) + (sensitive ? 10 : 1);
    await this.state.storage.put(key, count);
    if (count > 120) fail(429, 'Demasiadas peticiones; espere un minuto');
    // Remove stale auth/session/rate records on requests; no business data stored here.
    const records = await this.state.storage.list<{expiresAt?: number} | number>();
    for (const [name, value] of records) {
      if ((name.startsWith('rate:') && Number(name.split(':')[1]) < minute - 1)
        || (typeof value === 'object' && value.expiresAt && value.expiresAt < Date.now())) await this.state.storage.delete(name);
    }
  }
  private async exchange(parameters: Record<string, string>, previous?: Tokens): Promise<Tokens> {
    const response = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({client_id: this.env.MS_CLIENT_ID, client_secret: this.env.MS_CLIENT_SECRET, ...parameters})});
    if (!response.ok) {
      if (response.status === 400) {
        const error = await response.json() as {error?: string};
        if (error.error === 'invalid_grant' || error.error === 'interaction_required') {await this.state.storage.delete('tokens'); fail(503, 'MICROSOFT_REAUTH_REQUIRED');}
      }
      fail(503, 'MICROSOFT_OAUTH_FAILED');
    }
    const value = await response.json() as {access_token: string; refresh_token?: string; expires_in: number};
    if (!value.access_token || !value.expires_in || !(value.refresh_token || previous?.refresh_token)) fail(503, 'MICROSOFT_OAUTH_INVALID_RESPONSE');
    return {access_token: value.access_token, refresh_token: value.refresh_token || previous!.refresh_token, expiresAt: Date.now() + value.expires_in * 1000};
  }
  private async graph(force = false): Promise<Graph> {
    const saved = await this.state.storage.get<string>('tokens');
    if (!saved) return fail(503, 'MICROSOFT_REAUTH_REQUIRED');
    let tokens = await unseal<Tokens>(saved, this.env.TOKEN_ENCRYPTION_KEY);
    if (force || tokens.expiresAt < Date.now() + 120000) {
      tokens = await this.exchange({grant_type: 'refresh_token', refresh_token: tokens.refresh_token}, tokens);
      // Persist rotating refresh token before releasing serialized request.
      await this.state.storage.put('tokens', await seal(tokens, this.env.TOKEN_ENCRYPTION_KEY));
    }
    return new Graph(tokens.access_token);
  }
  private async session(request: Request): Promise<Session> {
    const bearer = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (!bearer) return fail(401, 'Sesión requerida');
    const session = await this.state.storage.get<Session>(`session:${await digest(bearer)}`);
    if (!session || session.expiresAt < Date.now()) return fail(401, 'Sesión caducada o revocada');
    return session;
  }
  private async handle(request: Request): Promise<Response> {
    let response: Response;
    const origin = request.headers.get('Origin');
    try {
      const url = new URL(request.url);
      if (origin && origin !== this.env.ALLOWED_ORIGIN) fail(403, 'Origen no permitido');
      if (request.method === 'OPTIONS') response = new Response(null, {status: 204});
      else {
        await this.limit(request, url.pathname.includes('/auth/') || url.pathname.includes('/admin/'));
        response = await this.route(request, url);
      }
    } catch (error) { response = json({error: error instanceof Fault ? error.message : 'Error interno; no se han publicado detalles privados'}, error instanceof Fault ? error.status : 500); }
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    if (origin === this.env.ALLOWED_ORIGIN) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Vary', 'Origin');
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
      response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, If-Match');
      response.headers.set('Access-Control-Expose-Headers', 'ETag');
    }
    return response;
  }
  private async route(request: Request, url: URL): Promise<Response> {
    const route = `${request.method} ${url.pathname}`;
    if (route === 'POST /admin/oauth/start') {
      this.admin(request);
      const state = random(); const verifier = random();
      await this.state.storage.put(`oauth:${await digest(state)}`, {verifier, expiresAt: Date.now() + 600000});
      const challenge = (await digest(verifier)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
      const params = new URLSearchParams({client_id: this.env.MS_CLIENT_ID, response_type: 'code', redirect_uri: `${this.env.PUBLIC_BASE_URL}/oauth/callback`, response_mode: 'query', scope: 'offline_access User.Read Files.ReadWrite', state, code_challenge: challenge, code_challenge_method: 'S256', login_hint: this.env.OWNER_MAIL, prompt: 'consent'});
      return json({url: `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?${params}`});
    }
    if (route === 'GET /oauth/callback') {
      const key = `oauth:${await digest(url.searchParams.get('state') || '')}`;
      const state = await this.state.storage.get<{verifier: string; expiresAt: number}>(key);
      await this.state.storage.delete(key);
      if (!state || state.expiresAt < Date.now()) return fail(403, 'Estado OAuth inválido, caducado o ya usado');
      if (url.searchParams.has('error')) fail(400, 'Autorización Microsoft cancelada');
      const code = url.searchParams.get('code'); if (!code) return fail(400, 'Falta código OAuth');
      const tokens = await this.exchange({grant_type: 'authorization_code', code, code_verifier: state.verifier, redirect_uri: `${this.env.PUBLIC_BASE_URL}/oauth/callback`});
      if (await new Graph(tokens.access_token).owner() !== this.env.OWNER_MAIL.toLowerCase()) fail(403, 'La cuenta autorizada no es la del propietario');
      await this.state.storage.put('tokens', await seal(tokens, this.env.TOKEN_ENCRYPTION_KEY));
      return json({status: 'Autorización guardada. Vuelva a la página principal; nunca copie la URL de callback.'});
    }
    if (route === 'POST /admin/refresh') {this.admin(request); await (await this.graph(true)).owner(); return json({status: 'Renovación persistida y Graph accesible'});}
    if (route === 'POST /admin/disconnect') {this.admin(request); await this.state.storage.delete('tokens'); return json({status: 'Tokens eliminados localmente; esto no revoca el consentimiento Microsoft'});}
    if (route === 'POST /admin/test-user') {
      this.admin(request);
      const data = await this.body(request); const email = mail(data.mail); const pwd = await hashPassword(data.password);
      const graph = await this.graph(); const folder = `PGT/users_data/${email}`;
      if (await graph.read(`${folder}/user_data.json`)) fail(409, 'El usuario existe; no se modifica');
      await graph.folder('PGT', 'users_data');
      await graph.folder('PGT/users_data', email);
      await graph.create(folder, 'user_data.json', {schemaVersion: 1, mail: email, nombre: '', apellidos: '', fecha_nacimiento: null, peso: null, cinturon: 'Blanco', perfil: 'alumno', pwd, revision: 1, updatedAt: new Date().toISOString(), pocOnly: true});
      return json({status: 'Perfil de prueba creado; no es un alta de la aplicación definitiva'}, 201);
    }
    if (route === 'POST /auth/login') {
      const data = await this.body(request); const email = mail(data.mail);
      const profile = await (await this.graph()).read(`PGT/users_data/${email}/user_data.json`);
      const pwd = profile?.data.pwd;
      // Equal password-hash work for unknown users to reduce account enumeration.
      const verified = await verifyPassword(data.password, typeof pwd === 'string' ? pwd : 'pbkdf2-sha256$600000$unknown$unknown');
      if (!profile || profile.data.pocOnly !== true || !verified) fail(401, 'Credenciales inválidas');
      const token = random(); const expiresAt = Date.now() + 12 * 3600000;
      await this.state.storage.put(`session:${await digest(token)}`, {mail: email, expiresAt});
      return json({token, mail: email, expiresAt});
    }
    if (route === 'POST /auth/logout') {
      await this.session(request);
      await this.state.storage.delete(`session:${await digest(request.headers.get('Authorization')!.slice(7))}`);
      return json({status: 'Sesión revocada'});
    }
    const match = url.pathname.match(/^\/poc\/users\/([^/]+)\/json$/);
    if (match && (request.method === 'GET' || request.method === 'PUT')) {
      const session = await this.session(request); const requested = mail(decodeURIComponent(match[1]));
      requireOwnMail(session.mail, requested);
      const graph = await this.graph(); const folder = `PGT/users_data/${session.mail}`; const path = `${folder}/viability.json`;
      if (request.method === 'GET') {const current = await graph.read(path); return current ? json(current) : json({error: 'Archivo aún no creado'}, 404);}
      const body = await this.body(request);
      if (Object.keys(body).some(key => !['value', 'revision'].includes(key)) || typeof body.value !== 'string' || body.value.length > 2000 || !Number.isInteger(body.revision) || Number(body.revision) < 1) fail(400, 'JSON de prueba inválido');
      const current = await graph.read(path);
      const data = {...body, schemaVersion: 1, mail: session.mail, updatedAt: new Date().toISOString()};
      if (current) {
        const etag = request.headers.get('If-Match');
        if (!etag || etag === '*') fail(428, 'Falta If-Match exacto');
        if (etag !== current.etag) fail(412, 'Conflicto de versión');
        if (body.revision !== Number(current.data.revision) + 1) fail(400, 'Revisión debe aumentar exactamente uno');
        await graph.update(path, data, etag!);
      } else {
        if (request.headers.has('If-Match') || body.revision !== 1) fail(412, 'Creación requiere revisión 1 y ningún If-Match');
        await graph.create(folder, 'viability.json', data);
      }
      return json({status: 'Escritura confirmada en Graph; vuelva a leer la versión remota'});
    }
    return fail(404, 'Operación no disponible en la prueba de concepto');
  }
}
