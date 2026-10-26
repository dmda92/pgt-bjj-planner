import {FirestoreUsage} from './usage.ts';
import {ApiError} from '../security.ts';
import {FirestoreIdentity, DEV_DATABASE_NAME, type Transport} from '../firestore-auth.ts';
import {requireDev, type PreflightEnv} from '../firestore-preflight.ts';

export type NativeDocument = {
    name: string;
    fields: Record<string, any>;
    updateTime: string;
    createTime?: string;
};
export type NativeRow = {
    id: string;
    path: string;
    data: any;
    updateTime: string;
    exists: boolean;
};
export const revisionOf = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), v => v.toString(16).padStart(2, '0')).join('').slice(0, 40);
const REFERENCE = Symbol('native Firestore reference');
export const reference = (path: string) => ({[REFERENCE]: DEV_DATABASE_NAME + '/documents/' + path});

export function field(value: any, key = ''): any {
    if (value && typeof value === 'object' && typeof value[REFERENCE] === 'string')
        return {referenceValue: value[REFERENCE]};
    if (value === null)
        return {nullValue: null};
    if (typeof value === 'string')
        return /^(updatedAt|generatedAt|createdAt|publishedAt|initializedAt)$/.test(key) && Number.isFinite(Date.parse(value)) ? {timestampValue: value} : {stringValue: value};
    if (typeof value === 'boolean')
        return {booleanValue: value};
    if (typeof value === 'number' && Number.isFinite(value))
        return Number.isSafeInteger(value) ? {integerValue: String(value)} : {doubleValue: value};
    if (Array.isArray(value)) {
        if (value.some(Array.isArray))
            throw new ApiError(500, 'NATIVE_NESTED_ARRAY_REQUIRES_MODEL');
        return {arrayValue: {values: value.map(v => field(v))}};
    }
    if (value && typeof value === 'object')
        return {mapValue: {fields: fields(value)}};
    throw new ApiError(500, 'NATIVE_FIELD_INVALID');
}

export const fields = (value: Record<string, any>) => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, field(v, k)]));

export function unfield(v: any): any {
    if ('nullValue' in v)
        return null;
    if ('stringValue' in v)
        return v.stringValue;
    if ('timestampValue' in v)
        return new Date(v.timestampValue).toISOString();
    if ('referenceValue' in v)
        return v.referenceValue;
    if ('integerValue' in v)
        return Number(v.integerValue);
    if ('doubleValue' in v)
        return v.doubleValue;
    if ('booleanValue' in v)
        return v.booleanValue;
    if (v.arrayValue)
        return (v.arrayValue.values || []).map(unfield);
    if (v.mapValue)
        return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, v]) => [k, unfield(v)]));
    throw new ApiError(502, 'NATIVE_FIELD_INVALID');
}

// Firestore storage-size rules: names/strings are UTF-8 + 1, maps add 32,
// numeric/timestamp values use 8 bytes. Measure native documents, not JSON wire size.
const utf8 = (value: string) => new TextEncoder().encode(value).length + 1;
const nameSize = (name: string) => name.split('/documents/').at(-1)!.split('/').reduce((n, s) => n + utf8(s), 16);
const valueSize = (v: any): number => v.stringValue !== undefined ? utf8(v.stringValue) : v.referenceValue ? nameSize(v.referenceValue) : v.mapValue ? 32 + Object.entries(v.mapValue.fields || {}).reduce((n, [key, v]) => n + utf8(key) + valueSize(v), 0) : v.arrayValue ? (v.arrayValue.values || []).reduce((n: number, v: any) => n + valueSize(v), 0) : v.booleanValue !== undefined || 'nullValue' in v ? 1 : 8;
export const nativeDocumentBytes = (doc: {
    name: string;
    fields: Record<string, any>
}) => nameSize(doc.name) + 32 + Object.entries(doc.fields).reduce((n, [key, v]) => n + utf8(key) + valueSize(v), 0);
const prefix = DEV_DATABASE_NAME + '/documents/';

export class NativeFirestore {
    private identity: FirestoreIdentity;
    private reads?: Map<string, NativeRow | null>;
    private queries?: Map<string, NativeRow[]>;
    private receipts = new Map<string, NativeRow>();

    committed(path: string) {
        return this.receipts.get(path);
    }

    beginOperation() {
        this.reads = new Map();
        this.queries = new Map();
    }

    endOperation() {
        this.reads = undefined;
        this.queries = undefined;
    }

    invalidate(paths?: string[]) {
        if (!paths) {
            this.reads?.clear();
            this.queries?.clear();
            return;
        }
        for (const key of this.reads?.keys() || []) if (paths.some(path => key === path || key.startsWith(path + '/'))) this.reads?.delete(key);
        for (const key of this.queries?.keys() || []) if (paths.some(path => key.startsWith(path + '|') || key.startsWith(path + '/'))) this.queries?.delete(key);
    }

    private transport: Transport;
    readonly usage: FirestoreUsage;

    constructor(env: PreflightEnv, transport: Transport = (url, init) => fetch(url, init), usage = new FirestoreUsage()) {
        this.usage = usage;
        this.transport = transport;
        requireDev(env);
        this.identity = new FirestoreIdentity(env.FIRESTORE_SERVICE_ACCOUNT_JSON || '', transport);
    }

    async request(path: string, init: RequestInit = {}, readOnly = false) {
        const token = await this.identity.token();
        for (let n = 0; ; n++) {
            try {
                this.usage.totals.httpRequests++;
                const r = await this.transport('https://firestore.googleapis.com/v1/' + DEV_DATABASE_NAME + path, {
                    ...init,
                    headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'},
                    redirect: 'manual',
                    signal: AbortSignal.timeout(readOnly ? 10000 : 20000)
                });
                const copy = new Response(await r.arrayBuffer(), {status: r.status, headers: r.headers});
                if (readOnly && !n && [502, 503, 504].includes(copy.status))
                    continue;
                return copy;
            } catch (e) {
                if (e instanceof ApiError) throw e;
                if (e instanceof Error && /too many subrequests/i.test(e.message))
                    throw new ApiError(503, 'FIRESTORE_SUBREQUEST_LIMIT');
                if (readOnly && !n)
                    continue;
                throw new ApiError(503, 'FIRESTORE_NETWORK_RETRY');
            }
        }
    }

    async check(r: Response) {
        if (r.status === 429) {
            this.usage.totals.uncertainResponses++;
            // Never log Google's free-text message, document names, tokens or
            // consumer/project numbers. Only allowlisted quota classifications.
            let dailyRead = false, dailyWrite = false, dailyDelete = false;
            try {
                const body = await r.clone().json() as any;
                const text = JSON.stringify(body.error?.details || []) + ' ' + String(body.error?.message || '');
                dailyRead = /daily.*read|read.*per day/i.test(text);
                dailyWrite = /daily.*write|write.*per day/i.test(text);
                dailyDelete = /daily.*delet|delet.*per day/i.test(text);
            } catch {
            }
            const quota = dailyRead ? 'DAILY_READ' : dailyWrite ? 'DAILY_WRITE' : dailyDelete ? 'DAILY_DELETE' : 'UNCLASSIFIED';
            console.warn('PGT_FIRESTORE_429', quota);
            throw new ApiError(429, 'FIRESTORE_RATE_LIMIT' + (quota === 'UNCLASSIFIED' ? '' : '_' + quota), 60);
        }
        if (!r.ok) throw new ApiError(503, 'FIRESTORE_SERVICE_' + r.status);
    }

    private path(path: string) {
        if (!/^[A-Za-z0-9@._+\/-]+$/.test(path) || path.split('/').some(v => !v || v === '.' || v === '..'))
            throw new ApiError(400, 'ENTITY_REFERENCE_INVALID');
        return path;
    }

    row(d: NativeDocument): NativeRow {
        const path = d.name.slice(prefix.length);
        return {
            id: path.slice(path.lastIndexOf('/') + 1),
            path,
            data: Object.fromEntries(Object.entries(d.fields || {}).filter(([k]) => !path.startsWith('pgt_resources/') || !['inline', 'payload'].includes(k)).map(([k, v]) => [k, unfield(v)])),
            updateTime: d.updateTime,
            exists: Boolean(d.fields)
        };
    }

    async get(path: string, fresh = false) {
        if (!fresh && this.reads?.has(path))
            return structuredClone(this.reads.get(path)!);
        this.usage.read();
        const r = await this.request('/documents/' + this.path(path), {}, true);
        if (r.status === 404) {
            this.reads?.set(path, null);
            return null;
        }
        await this.check(r);
        const row = this.row(await r.json() as NativeDocument);
        this.reads?.set(path, row);
        return structuredClone(row);
    }

    async page(path: string, pageToken = '', showMissing = false) {
        const limit = this.usage.queryLimit();
        const q = new URLSearchParams({pageSize: String(Math.min(200, limit ?? 200)), ...(pageToken ? {pageToken} : {}), ...(showMissing ? {showMissing: 'true'} : {})});
        const r = await this.request('/documents/' + this.path(path) + '?' + q, {}, true);
        await this.check(r);
        const v = await r.json() as any;
        this.usage.query((v.documents || []).length, limit);
        return {
            rows: (v.documents || []).map((d: NativeDocument) => this.row(d)) as NativeRow[],
            nextPageToken: v.nextPageToken as string | undefined
        };
    }

    async list(path: string) {
        return this.query(path);
    }

    async query(path: string, key?: string, value?: unknown, maxRows?: number) {
        const cacheKey = path + '|' + JSON.stringify([key, value, maxRows]);
        if (this.queries?.has(cacheKey))
            return structuredClone(this.queries.get(cacheKey)!);
        const parts = this.path(path).split('/'), collection = parts.pop()!,
            parent = parts.length ? '/' + parts.join('/') : '';
        const budgetLimit = this.usage.queryLimit(),
            limit = budgetLimit === undefined ? maxRows : Math.min(maxRows ?? budgetLimit, budgetLimit);
        const r = await this.request('/documents' + parent + ':runQuery', {
            method: 'POST',
            body: JSON.stringify({
                structuredQuery: {
                    ...(limit !== undefined ? {limit} : {}),
                    from: [{collectionId: collection}], ...(key ? {
                        where: {
                            fieldFilter: {
                                field: {fieldPath: key},
                                op: 'EQUAL',
                                value: field(value)
                            }
                        }
                    } : {})
                }
            })
        }, true);
        await this.check(r);
        const rows = await r.json() as any[];
        const result = rows.flatMap(v => v.document ? [this.row(v.document)] : []);
        this.usage.query(result.length, budgetLimit !== undefined && (maxRows === undefined || budgetLimit <= maxRows) ? budgetLimit : undefined);
        this.queries?.set(cacheKey, result);
        for (const row of result)
            this.reads?.set(row.path, row);
        return structuredClone(result);
    }

    /** One query reads every native entity table immediately below a revision. */
    async children(path: string) {
        const cacheKey = path + '|*';
        if (this.queries?.has(cacheKey)) return structuredClone(this.queries.get(cacheKey)!);
        const limit = this.usage.queryLimit();
        const r = await this.request('/documents/' + this.path(path) + ':runQuery', {
            method: 'POST',
            body: JSON.stringify({
                structuredQuery: {
                    ...(limit !== undefined ? {limit} : {}),
                    from: [{allDescendants: false}]
                }
            })
        }, true);
        await this.check(r);
        const result = ((await r.json()) as any[]).flatMap(v => v.document ? [this.row(v.document)] : []);
        this.usage.query(result.length, limit);
        this.queries?.set(cacheKey, result);
        for (const row of result) this.reads?.set(row.path, row);
        return structuredClone(result);
    }

    update(path: string, data: unknown, previous?: NativeRow | null) {
        const update = {name: prefix + this.path(path), fields: fields(data as any)};
        if (nativeDocumentBytes(update) > 1024 * 1024) throw new ApiError(413, 'NATIVE_DOCUMENT_TOO_LARGE');
        return {update, ...(previous !== undefined ? {currentDocument: previous ? {updateTime: previous.updateTime} : {exists: false}} : {})};
    }

    deletion(row: NativeRow) {
        return {delete: prefix + this.path(row.path), ...(row.exists ? {currentDocument: {updateTime: row.updateTime}} : {})};
    }

    async commit(writes: any[]) {
        this.receipts.clear();
        if (!writes.length)
            return;
        for (const w of writes) {
            const path = (w.update?.name || w.delete).slice(prefix.length);
            this.reads?.delete(path);
            const collection = path.slice(0, path.lastIndexOf('/'));
            this.queries?.delete(collection.slice(0, collection.lastIndexOf('/')) + '|*');
            for (const key of this.queries?.keys() || [])
                if (key.startsWith(collection + '|'))
                    this.queries?.delete(key);
        }
        if (new TextEncoder().encode(JSON.stringify({writes})).length > 9 * 1024 * 1024)
            throw new ApiError(413, 'NATIVE_TRANSACTION_TOO_LARGE');
        this.usage.mutation(writes);
        const r = await this.request('/documents:commit', {method: 'POST', body: JSON.stringify({writes})});
        if ([409, 412].includes(r.status))
            throw new ApiError(409, 'VERSION_CONFLICT');
        if (r.status === 400) {
            const v = await r.json() as any;
            if (['FAILED_PRECONDITION', 'ALREADY_EXISTS', 'ABORTED'].includes(v.error?.status))
                throw new ApiError(409, 'VERSION_CONFLICT');
            throw new ApiError(503, 'NATIVE_COMMIT_REJECTED');
        }
        await this.check(r);
        this.usage.confirmed(writes);
        const receipt = await r.json() as any;
        for (let i = 0; i < writes.length; i++) {
            const w = writes[i], time = receipt.writeResults?.[i]?.updateTime;
            if (w.update && typeof time === 'string') {
                const row = this.row({...w.update, updateTime: time});
                this.receipts.set(row.path, row);
                this.reads?.set(row.path, row);
            }
        }
        return receipt;
    }

    async collectionIds(path = '') {
        const ids: string[] = [];
        let pageToken = '';
        do {
            this.usage.read();
            const r = await this.request('/documents' + (path ? '/' + this.path(path) : '') + ':listCollectionIds', {
                method: 'POST',
                body: JSON.stringify({pageSize: 1000, ...(pageToken ? {pageToken} : {})})
            }, true);
            await this.check(r);
            const page = await r.json() as any;
            ids.push(...(page.collectionIds || []));
            pageToken = page.nextPageToken || '';
        } while (pageToken);
        return ids;
    }

    async commitChunks(writes: any[]) {
        let batch: any[] = [], bytes = 0;
        for (const w of writes) {
            const length = new TextEncoder().encode(JSON.stringify(w)).length;
            if ((bytes + length > 8 * 1024 * 1024 || batch.length >= 450) && batch.length) {
                await this.commit(batch);
                batch = [];
                bytes = 0;
            }
            batch.push(w);
            bytes += length;
        }
        if (batch.length)
            await this.commit(batch);
    }

    async deleteRows(rows: NativeRow[]) {
        await this.commitChunks(rows.map(r => this.deletion(r)));
    }
}
