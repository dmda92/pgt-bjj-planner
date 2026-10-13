import {fail} from './security.ts';
export class Graph {
  constructor(private token: string, private transport: typeof fetch = fetch) {}
  private url(path: string, suffix = ''): string {
    if ((path !== 'PGT' && !path.startsWith('PGT/')) || path.split('/').some(p => !p || p === '.' || p === '..' || /[\\%?#]/.test(p))) return fail(400, 'Ruta no autorizada');
    return `https://graph.microsoft.com/v1.0/me/drive/root:/${path.split('/').map(encodeURIComponent).join('/')}${suffix}`;
  }
  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.token}`);
    const response = await this.transport(url, {...init, headers});
    if (response.status === 401) fail(503, 'MICROSOFT_REAUTH_REQUIRED');
    if (response.status === 412 || response.status === 409) fail(response.status, 'Conflicto de versión');
    if (!response.ok && response.status !== 404) fail(502, `GRAPH_${response.status}`);
    return response;
  }
  async owner(): Promise<string> {
    const response = await this.request('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName');
    const profile = await response.json() as {mail?: string; userPrincipalName?: string};
    return (profile.mail || profile.userPrincipalName || '').toLowerCase();
  }
  async read(path: string): Promise<{data: Record<string, unknown>; etag: string} | null> {
    const metadata = await this.request(this.url(path));
    if (metadata.status === 404) return null;
    const item = await metadata.json() as {id: string; eTag: string; size: number};
    if (item.size > 65536) fail(413, 'JSON demasiado grande para la prueba');
    const response = await this.request(this.url(path, ':/content'));
    if (response.status === 404) return null;
    // Verify the metadata version after downloading to avoid pairing stale eTags with newer content.
    const data = await response.json() as Record<string, unknown>;
    const verified = await this.request(this.url(path));
    if (verified.status === 404) fail(409, 'El archivo cambió durante la lectura');
    const current = await verified.json() as {eTag: string};
    if (current.eTag !== item.eTag) fail(409, 'El archivo cambió durante la lectura');
    return {data, etag: item.eTag};
  }
  async update(path: string, data: unknown, etag: string): Promise<string> {
    if (!etag || etag === '*') return fail(428, 'Se requiere versión exacta');
    const response = await this.request(this.url(path, ':/content'), {method: 'PUT', headers: {'Content-Type': 'application/json', 'If-Match': etag}, body: JSON.stringify(data)});
    if (response.status === 404) fail(409, 'El archivo ya no existe');
    return (await response.json() as {eTag: string}).eTag;
  }
  async create(parent: string, filename: string, data: unknown): Promise<void> {
    // conflictBehavior=fail avoids overwriting an existing user's data at registration.
    const response = await this.request(this.url(`${parent}/${filename}`, ':/content?%40microsoft.graph.conflictBehavior=fail'), {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)});
    if (response.status === 404) fail(409, 'Falta la carpeta padre');
  }
  async folder(parent: string, name: string): Promise<void> {
    if (!/^[a-zA-Z0-9@._+-]+$/.test(name) || name === '.' || name === '..') fail(400, 'Carpeta inválida');
    const existing = await this.request(this.url(`${parent}/${name}`));
    if (existing.status !== 404) return;
    const response = await this.request(this.url(parent, ':/children'), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail'})});
    if (response.status === 404) fail(409, 'Cree primero la carpeta PGT');
  }
}
