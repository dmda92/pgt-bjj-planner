import { db, repository, type LocalEntry } from '../infrastructure/local.ts';
import { receiveComments } from './comment-notifications.ts';
import { trainerCache, trainerKey, validateTrainerView, type TrainerSection, type TrainerView } from './trainer-cache.ts';
import { validateProfile, validateTechniques, validatePlan, validateVersion, type Profile, type Comments, type Techniques, type TrainingPlan, type RemoteRecord, type Document } from '../domain/models.ts';
import { sizeMessage } from '../domain/json-limits.ts';
import { planIssueMessage, type PlanIssue } from '../domain/plan-issues.ts';
import { madridDate } from '../domain/plan-text-updates.ts';
import { SaveThrottled } from './save-throttled.ts';
import { draftJournal } from './draft-journal.ts';
export interface Identity { mail: string; token: string; profile: Profile }
export interface Snapshot {
    profile: RemoteRecord<Profile>; techniques: RemoteRecord; comments: RemoteRecord; index: RemoteRecord;
    plans: RemoteRecord<TrainingPlan>[]; deletedPlanIds: string[]; planIssues?: PlanIssue[]; pendingPlanIds?: string[];
}
export type LiveResource = { kind: string; owner: string; id: string };
export class ApiFailure extends Error {
    readonly status: number;
    constructor(status: number, message: string) { super(message); this.status = status; }
}
const API = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const record = (value: any) => value && 'version' in value ? { data: value.data, sha: value.version } : value;
/** Firestore is the only remote source; IndexedDB contains read-only derived copies.
 * Unconfirmed drafts use a separate local recovery journal until a server ACK.
 * No offline upload or automatic merge queue exists. */
export class FirestoreClient {
    identity: Identity | null = null;
    locked = false;
    retryGeneration = 0;
    status = 'Sin sesión';
    lastConfirmedRevision = new Map<string, string>();
    onChange: () => void = () => {};
    private channel = new BroadcastChannel('pgt-session');
    private refresh?: Promise<void>;
    private refreshAgain = false;
    private writes: Promise<unknown> = Promise.resolve();
    private socket?: WebSocket;
    private connection = '';
    private socketEpoch = 0;
    private serverEpoch = '';
    private sequence = 0;
    private retry?: ReturnType<typeof setTimeout>;
    private retryDelay = 500;
    private opening = false;
    private trainerLoads = new Map<string, Promise<TrainerView>>();
    private dayLoads = new Map<string, Promise<any>>();
    private cacheEpoch = 0;
    private cacheClears: Promise<void> = Promise.resolve();
    private lastPrivateDenial = '';
    private seenOperations = new Set<string>();
    constructor() {
        try { this.identity = JSON.parse(localStorage.getItem('pgt-session') || 'null'); } catch { localStorage.removeItem('pgt-session'); }
        this.channel.onmessage = () => { if (this.identity) void this.invalidateTrainerCache(this.identity.mail).catch(() => {}); this.stop(); this.identity = null; this.locked = true; this.status = 'La sesión cambió en otra pestaña. Recarga para continuar.'; this.onChange(); };
        window.addEventListener('storage', event => {
            if (this.identity && event.key === this.cacheFenceKey(this.identity.mail)) {
                try {
                    const value = JSON.parse(event.newValue || 'null');
                    if (value?.denied === true && typeof value.stamp === 'string') this.privateAccessDenied(this.identity.mail, value.stamp);
                } catch {}
                this.cacheEpoch++; this.trainerLoads.clear(); this.dayLoads.clear(); return;
            }
            if (event.key !== 'pgt-session') return;
            let other: Identity | null = null; try { other = JSON.parse(event.newValue || 'null'); } catch {}
            if (other?.token !== this.identity?.token || other?.mail !== this.identity?.mail) {
                if (this.identity) void this.invalidateTrainerCache(this.identity.mail).catch(() => {});
                this.stop(); this.locked = true; this.identity = null; this.status = 'La sesión cambió en otra pestaña. Recarga para continuar.'; this.onChange();
            }
        });
        window.addEventListener('offline', () => { this.retryGeneration++; this.stop(); this.status = 'Sin conexión · copia local de consulta'; this.onChange(); });
        window.addEventListener('online', () => { if (this.identity && !this.locked) void this.sync().catch(() => {}); });
    }
    private current() {
        const i = this.identity;
        let stored: Identity | null = null; try { stored = JSON.parse(localStorage.getItem('pgt-session') || 'null'); } catch {}
        if (!i || this.locked || stored?.token !== i.token || stored.mail !== i.mail) throw Error('Sesión cerrada o cambiada');
        return i;
    }
    /** Revoke in-flight cache rights synchronously, before asynchronous deletion.
     * Reads/writes wait for the clear; a failed deletion never re-enables a copy.
     * Editor drafts live in separate tables and are intentionally preserved. */
    private invalidateTrainerCache(mail: string, denied = false) {
        this.cacheEpoch++; this.trainerLoads.clear(); this.dayLoads.clear();
        const stamp = crypto.randomUUID(), key = this.cacheFenceKey(mail);
        // Shared by tabs and reloads. Pending stays durable if IndexedDB deletion
        // fails, so a new client cannot reopen a previously denied cached copy.
        if (denied) this.privateAccessDenied(mail, stamp);
        try { localStorage.setItem(key, JSON.stringify({ stamp, pending: true, denied })); }
        catch (error) {
            this.stop(); this.locked = true; localStorage.removeItem('pgt-session'); this.channel.postMessage('session-changed');
            return Promise.reject(error);
        }
        const clear = this.cacheClears.catch(() => {}).then(async () => {
            await trainerCache.clear(mail);
            if (this.cacheFence(mail).stamp === stamp) localStorage.setItem(key, JSON.stringify({ stamp, pending: false, denied }));
        });
        this.cacheClears = clear; return clear;
    }
    private cacheFenceKey(mail: string) { return 'pgt-trainer-cache-fence:' + mail; }
    private privateAccessDenied(mail: string, stamp: string) {
        if (this.lastPrivateDenial === stamp) return;
        this.lastPrivateDenial = stamp;
        window.dispatchEvent(new CustomEvent('pgt-private-access-denied', { detail: { mail } }));
    }
    private cacheFence(mail: string): { stamp: string; pending: boolean } {
        const stored = localStorage.getItem(this.cacheFenceKey(mail));
        if (!stored) return { stamp: '', pending: false };
        try { const value = JSON.parse(stored); if (typeof value.stamp === 'string' && typeof value.pending === 'boolean') return value; } catch {}
        return { stamp: '', pending: true };
    }
    private assertCacheIdentity(identity: Identity, epoch: number, stamp: string) {
        const fence = this.cacheFence(identity.mail);
        if (this.current().token !== identity.token || epoch !== this.cacheEpoch || fence.pending || fence.stamp !== stamp) throw Error('La autorización de la consulta ha cambiado');
    }
    private async cacheResult(identity: Identity, epoch: number, stamp: string, write: () => Promise<unknown>) {
        await this.cacheClears;
        await db.transaction('rw', db.trainerViews, db.trainerDays, async () => {
            this.assertCacheIdentity(identity, epoch, stamp);
            await write();
            // Abort this transaction if revocation started while IndexedDB was
            // committing; a later clear is serialized after this transaction.
            this.assertCacheIdentity(identity, epoch, stamp);
        });
    }
    private async raw<T = any>(path: string, method = 'GET', body?: unknown, credential?: string): Promise<T> {
        if (method !== 'GET' && !navigator.onLine) throw Error('Sin conexión. No se ha guardado ningún cambio.');
        const token = credential === undefined ? this.current().token : credential;
        const init: RequestInit = { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}),
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(this.connection ? { 'X-PGT-Connection': this.connection } : {}) },
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}) };
        let response: Response;
        try { response = await fetch(API + path, init); }
        catch (error) {
            // A lost command ACK gets one retry with the EXACT operationId/body.
            // Never queue/replay after reconnect, logout or an account change.
            if (method !== 'POST' || !path.startsWith('/api/v2/commands/') ||
                !body || typeof body !== 'object' || !('operationId' in body) || !navigator.onLine ||
                this.locked || this.current().token !== token) throw error;
            response = await fetch(API + path, init);
        }
        const value: any = await response.json();
        if (!response.ok) {
            if ((response.status === 401 || response.status === 403) && this.identity?.token === token) {
                const invalidated = this.invalidateTrainerCache(this.identity.mail, true);
                if (response.status === 401) { this.stop(); this.locked = true; }
                await invalidated; this.onChange();
            }
            const retryAfter = response.headers.get('Retry-After');
            if (path.startsWith('/api/v2/commands/') && response.status === 429 && value.error === 'RATE_LIMIT' && retryAfter && /^\d+$/.test(retryAfter) &&
                Number(retryAfter) >= 1 && Number(retryAfter) <= 3600) throw new SaveThrottled(Number(retryAfter) * 1000);
            throw new ApiFailure(response.status, value.size ? sizeMessage(value.size) : value.error || 'Error de API');
        }
        return value as T;
    }
    /** Existing UI action names map directly to specific Firestore commands. */
    async request<T = any>(path: string, method = 'GET', body?: any, credential?: string): Promise<T> {
        if (path.startsWith('/api/v2/')) return this.raw(path, method, body, credential);
        if (path === '/api/app/students') {
            const value = await this.raw('/api/v2/roster');
            return { users: value.data.users.map((profile: Profile) => ({ profile })) } as T;
        }
        if (path === '/api/app/catalog') return record(await this.raw('/api/v2/catalog')) as T;
        const command = path.match(/^\/api\/app\/(password|role|belt|competition|assignment|delete-competition)$/);
        if (command && method === 'POST') {
            const actor = this.current();
            const { sha, ...input } = body, operationId = crypto.randomUUID();
            const result = await this.raw('/api/v2/commands/' + command[1], 'POST', { ...input, expected: sha, operationId });
            await this.invalidateTrainerCache(actor.mail);
            if (['competition', 'assignment', 'delete-competition'].includes(command[1])) await this.sync();
            return result as T;
        }
        const source = path.match(/^\/api\/app\/users\/([^/]+)\/(profile|techniques|comments)$/);
        if (source && method === 'PUT') {
            const kind = source[2] === 'techniques' ? 'repertoire' : source[2], owner = decodeURIComponent(source[1]);
            if (kind !== 'comments' && owner !== this.current().mail) throw Error('Solo puedes editar tus propios datos');
            const saved = await this.raw('/api/v2/commands/' + kind, 'POST', { data: body.data, expected: body.sha,
                operationId: crypto.randomUUID(), ...(kind === 'comments' ? { owner } : {}) });
            await this.invalidateTrainerCache(this.current().mail);
            return record(saved) as T;
        }
        throw Error('Operación no disponible');
    }
    private async archive(mail: string, entries: LocalEntry[]) {
        const dirty = entries.filter(e => e.dirty); if (!dirty.length) return;
        const key = 'legacy-drafts:' + mail, stored = await db.meta.get(key), value = { schemaVersion: 1, mail, entries: dirty.map(e => ({ key: e.key, data: e.data })) };
        if (!stored) await db.meta.put({ key, value: JSON.stringify(value) });
        else {
            const old = JSON.parse(stored.value), history = old.history || [old];
            if (!history.some((item: unknown) => JSON.stringify(item) === JSON.stringify(value))) history.push(value);
            await db.meta.put({ key, value: JSON.stringify({ schemaVersion: 1, mail, history }) });
        }
    }
    private validate(s: Snapshot) {
        validateProfile(s.profile?.data); validateTechniques(s.techniques?.data); validateVersion(s.comments?.data); validateVersion(s.index?.data);
        if ('pwd' in s.profile.data || 'probeOnly' in s.profile.data || !Array.isArray(s.plans)) throw Error('Restauración no válida');
        for (const r of s.plans) { validatePlan(r.data); if (r.data.mail !== s.profile.data.mail) throw Error('Plan de otra cuenta'); }
    }
    private entries(s: Snapshot, mail: string): LocalEntry[] {
        return [['profile', s.profile], ['techniques', s.techniques], ['comments', s.comments], ['index', s.index],
            ...s.plans.map(r => ['plan:' + r.data.planId, r])].map(([key, value]) => {
                const r = value as RemoteRecord;
                return { key: key as string, mail, data: r.data, base: structuredClone(r.data), sha: r.sha, dirty: false, conflicts: [],
                    endpoint: '/api/app/users/' + encodeURIComponent(mail) + '/' + key };
            });
    }
    private async snapshot(identity: Identity, useCache = true): Promise<Snapshot> {
        const old = useCache && await repository.owner() === identity.mail ? await repository.entries(identity.mail) : [];
        const known = Object.fromEntries(old.filter(e => e.sha).map(e => [e.key, e.sha]));
        const raw = await this.raw('/api/v2/users/' + encodeURIComponent(identity.mail) + '/snapshot?known=' + encodeURIComponent(JSON.stringify(known)), 'GET', undefined, identity.token);
        const restore = (key: string, r: any) => {
            if (!r?.unchanged) return r;
            const entry = old.find(e => e.key === key && e.sha === r.sha); if (!entry) throw Error('Falta la versión local');
            return { data: structuredClone(entry.base), sha: r.sha };
        };
        return { ...raw, profile: restore('profile', raw.profile), techniques: restore('techniques', raw.techniques), comments: restore('comments', raw.comments),
            index: restore('index', raw.index), plans: raw.plans.map((r: any) => restore('plan:' + (r.planId || r.data?.planId), r)) };
    }
    private async accept(identity: Identity, snapshot: Snapshot) {
        this.validate(snapshot);
        if (snapshot.profile.data.mail !== identity.mail || this.current().token !== identity.token) throw Error('Sesión cambiada');
        if (this.identity?.profile.perfil !== snapshot.profile.data.perfil) await this.invalidateTrainerCache(identity.mail);
        await db.transaction('rw', db.entries, db.meta, db.commentNotices, async () => {
            if (this.current().token !== identity.token) throw Error('Sesión cambiada');
            const owner = await repository.owner(), old = owner === identity.mail ? await repository.entries(identity.mail) : [];
            if (owner) await this.archive(owner, await db.entries.toArray());
            await receiveComments(identity.mail, snapshot.comments.data as Comments, snapshot.techniques.data as Techniques,
                old.find(e => e.key === 'comments')?.data as Comments | undefined);
            const incoming = this.entries(snapshot, identity.mail), keys = new Set(incoming.map(e => e.key));
            if (owner !== identity.mail) await db.entries.clear();
            else for (const entry of old) if (!keys.has(entry.key)) await db.entries.delete(entry.key);
            const changed = incoming.filter(entry => {
                const prior = old.find(e => e.key === entry.key);
                return owner !== identity.mail || !prior || prior.dirty || prior.sha !== entry.sha;
            });
            if (changed.length) await db.entries.bulkPut(changed);
            await db.meta.put({ key: 'owner', value: identity.mail });
            await db.meta.put({ key: 'plan-issues:' + identity.mail, value: JSON.stringify(snapshot.planIssues || []) });
        });
        this.identity = { ...identity, profile: snapshot.profile.data }; localStorage.setItem('pgt-session', JSON.stringify(this.identity));
        this.status = snapshot.planIssues?.length ? planIssueMessage(snapshot.planIssues) : snapshot.pendingPlanIds?.length ? 'Actualización incompleta: planes pendientes' :
            snapshot.plans.some(p => p.data.structuralUpdateError) ? 'Actualización incompleta: planes bloqueados' : 'Actualizado';
    }
    async login(mail: string, password: string) { await this.authenticate('login', { mail, password }); }
    async register(mail: string, password: string, confirm: string, nombre: string, apellidos: string) { await this.authenticate('register', { mail, password, confirm, nombre, apellidos }); }
    private async authenticate(kind: string, body: unknown) {
        if (!navigator.onLine) throw Error('La primera carga requiere conexión');
        const mail = (body as { mail?: unknown })?.mail;
        const priorActors = new Set([this.identity?.mail, await repository.owner()]);
        for (const prior of priorActors) if (prior && typeof mail === 'string' && prior !== mail.trim().toLowerCase()) {
            await draftJournal.checkpoint();
            if ((await draftJournal.list(prior)).length) throw Error('Hay un borrador pendiente de la cuenta anterior. Vuelve a esa cuenta para resolverlo o exportarlo.');
        }
        const auth = await this.raw<{ token: string; profile: Profile }>('/api/v2/auth/' + kind, 'POST', body, '');
        const identity = { mail: auth.profile.mail, token: auth.token, profile: auth.profile }, snapshot = await this.snapshot(identity, false);
        this.validate(snapshot); this.stop();
        const previous = this.identity;
        if (previous && previous.mail !== identity.mail) await this.invalidateTrainerCache(previous.mail);
        await this.invalidateTrainerCache(identity.mail);
        this.retryGeneration++; this.identity = identity; this.locked = false;
        localStorage.setItem('pgt-session', JSON.stringify(identity)); this.channel.postMessage('session-changed');
        try { await this.accept(identity, snapshot); } catch (error) { this.locked = true; this.onChange(); throw error; }
        this.onChange(); void this.connect();
    }
    async load() { if (!this.identity || this.locked || await repository.owner() !== this.identity.mail) return []; return repository.entries(this.identity.mail); }
    async sync(): Promise<void> {
        if (!this.identity || this.locked) return;
        if (!navigator.onLine) { this.status = 'Sin conexión · copia local de consulta'; this.onChange(); return; }
        if (this.refresh) { this.refreshAgain = true; return this.refresh; }
        this.refresh = (async () => {
            do { this.refreshAgain = false; const identity = this.current();
                try { await this.accept(identity, await this.snapshot(identity)); }
                catch (error) { this.status = 'No se pudo actualizar: ' + (error instanceof Error ? error.message : 'error'); throw error; }
                finally { this.onChange(); }
            } while (this.refreshAgain && this.identity && !this.locked && navigator.onLine);
        })().finally(() => { this.refresh = undefined; });
        void this.connect(); return this.refresh;
    }
    async edit(key: string, data: Document, expectedVersion?: string | null) {
        if (key.startsWith('plan:')) throw Error('PLAN_READ_ONLY');
        const identity = this.current();
        const save = this.writes.catch(() => {}).then(async () => {
            if (!navigator.onLine || this.current().token !== identity.token) throw Error('Sin conexión o sesión cambiada. Conserva el borrador.');
            const old = await db.entries.get(key);
            if (!old || old.mail !== identity.mail) throw Error('Datos de otra cuenta');
            if (expectedVersion !== undefined && old.sha !== expectedVersion) throw Error('Los datos han cambiado. Conserva el borrador y revisa la versión actual.');
            if (JSON.stringify(old.data) === JSON.stringify(data)) return;
            this.status = 'Guardando…'; this.onChange();
            try {
                const saved = await this.request<RemoteRecord>('/api/app/users/' + encodeURIComponent(identity.mail) + '/' + key, 'PUT', { data, sha: old.sha });
                if (this.current().token !== identity.token) throw Error('Sesión cambiada');
                this.lastConfirmedRevision.set(key, saved.sha);
                await repository.save({ ...old, data: saved.data, base: structuredClone(saved.data), sha: saved.sha, dirty: false, conflicts: [] }, identity.mail);
                await this.sync();
            } catch (error) { this.status = 'No guardado: ' + (error instanceof Error ? error.message : 'error'); this.onChange(); throw error; }
        });
        this.writes = save; return save;
    }
    async cachedTrainer(mail: string, section: TrainerSection, planId = '') {
        const i = this.current(), epoch = this.cacheEpoch, stamp = this.cacheFence(i.mail).stamp; if (i.profile.perfil !== 'entrenador') throw Error('Solo entrenadores');
        await this.cacheClears;
        this.assertCacheIdentity(i, epoch, stamp);
        const local = await trainerCache.get(i.mail, mail, section, planId);
        this.assertCacheIdentity(i, epoch, stamp); return local?.data;
    }
    async trainerView(mail: string, section: TrainerSection, _force = false, planId = ''): Promise<TrainerView> {
        const i = this.current(), epoch = this.cacheEpoch, stamp = this.cacheFence(i.mail).stamp, key = trainerKey(i.mail, mail, section, planId), flight = key + ':' + epoch + ':' + stamp;
        if (this.trainerLoads.has(flight)) return this.trainerLoads.get(flight)!;
        const load = (async () => {
            if (i.profile.perfil !== 'entrenador') throw Error('Solo entrenadores');
            if (!navigator.onLine) { const local = await this.cachedTrainer(mail, section, planId); if (local) return local; throw Error('Sin copia local de esta ficha'); }
            const prefix = '/api/v2/users/' + encodeURIComponent(mail) + '/';
            let view: TrainerView;
            if (section === 'techniques') {
                const [profile, techniques, comments] = await Promise.all([
                    this.raw(prefix + 'profile'), this.raw(prefix + 'repertoire'), this.raw(prefix + 'comments')
                ]);
                view = { profile: record(profile), techniques: record(techniques), comments: record(comments) };
            } else if (section === 'plans') {
                const [profile, index, catalog] = await Promise.all([
                    this.raw(prefix + 'profile'), this.raw(prefix + 'assignment'), this.raw('/api/v2/catalog')
                ]);
                view = { profile: record(profile) };
                view.planSummaries = index.data.planIds.map((id: string) => ({ planId: id, fecha_torneo: catalog.data.plans.find((c: any) => c.planId === id)?.fecha_torneo }));
                view.plans = [];
                if (planId) { const value = await this.raw(prefix + 'plans/' + planId); if (value) view.plans.push({ data: value.data, sha: value.version.distribution + ':' + value.version.text }); }
            } else view = { profile: record(await this.raw(prefix + 'profile')) };
            validateTrainerView(view, mail, section);
            if (this.current().token !== i.token || epoch !== this.cacheEpoch) throw Error('La ficha ha cambiado durante la consulta');
            await this.cacheResult(i, epoch, stamp, () => db.trainerViews.put({ key, owner: i.mail, mail, section, data: view, checkedAt: Date.now() })); return view;
        })();
        this.trainerLoads.set(flight, load); try { return await load; } finally { this.trainerLoads.delete(flight); }
    }
    async cachedTrainingDay(date: string) {
        const i = this.current(), epoch = this.cacheEpoch, stamp = this.cacheFence(i.mail).stamp; if (i.profile.perfil !== 'entrenador') throw Error('Solo entrenadores');
        await this.cacheClears; this.assertCacheIdentity(i, epoch, stamp);
        const local = await db.trainerDays.get(JSON.stringify([i.mail, date]));
        this.assertCacheIdentity(i, epoch, stamp); return local?.data;
    }
    async trainingDay(date: string) {
        const i = this.current(), epoch = this.cacheEpoch, stamp = this.cacheFence(i.mail).stamp, key = JSON.stringify([i.mail, date]), flight = key + ':' + epoch + ':' + stamp;
        if (this.dayLoads.has(flight)) return this.dayLoads.get(flight)!;
        const load = (async () => {
            if (!navigator.onLine) { const cached = await this.cachedTrainingDay(date); if (cached) return cached; throw Error('Sin copia local para esta fecha'); }
            let data = await this.raw('/api/v2/training-day?date=' + encodeURIComponent(date));
            if (data.missing > 0) {
                const catalog = await this.raw('/api/v2/catalog');
                for (const competition of catalog.data.plans.filter((c: any) => date ? c.fecha_comienzo <= date && date < c.fecha_torneo : c.fecha_torneo >= madridDate())) {
                    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(i.mail + ':' + competition.planId + ':' + catalog.version)));
                    const hex = [...hash].map(v => v.toString(16).padStart(2, '0')).join('').slice(0, 32);
                    const operationId = hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
                    await this.raw('/api/v2/commands/prepare', 'POST', { planId: competition.planId, expected: catalog.version, operationId });
                }
                await this.sync();
                data = await this.raw('/api/v2/training-day?date=' + encodeURIComponent(date));
            }
            if (this.current().token !== i.token || epoch !== this.cacheEpoch) throw Error('La consulta ha cambiado');
            await this.cacheResult(i, epoch, stamp, () => db.trainerDays.put({ key, owner: i.mail, data })); return data;
        })();
        this.dayLoads.set(flight, load); try { return await load; } finally { this.dayLoads.delete(flight); }
    }
    private stop() { this.socketEpoch++; this.opening = false; this.connection = ''; clearTimeout(this.retry); this.retry = undefined; if (this.socket) { this.socket.onclose = null; this.socket.close(); this.socket = undefined; } }
    private async connect() {
        if (!this.identity || this.locked || !navigator.onLine || this.opening || this.socket && this.socket.readyState <= WebSocket.OPEN) return;
        const i = this.current(), epoch = this.socketEpoch; this.opening = true;
        try {
            const { ticket } = await this.raw('/api/v2/realtime-ticket', 'POST', {});
            if (epoch !== this.socketEpoch || this.identity?.token !== i.token) return;
            const url = new URL(API + '/api/v2/realtime', location.href); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('ticket', ticket);
            const socket = new WebSocket(url); this.socket = socket;
            socket.onmessage = event => {
                if (epoch !== this.socketEpoch || this.identity?.token !== i.token || this.locked) return;
                let e: any; try { e = JSON.parse(event.data); } catch { return; }
                if (e.type === 'ready' || e.type === 'reset') {
                    this.serverEpoch = e.epoch; this.sequence = e.sequence; this.connection = e.connection || this.connection; this.retryDelay = 500;
                    void this.invalidateTrainerCache(i.mail).then(() => this.sync()).then(() =>
                        window.dispatchEvent(new CustomEvent('pgt-live-update', { detail: { reset: true } }))).catch(() => {}); return;
                }
                if (e.type !== 'changed' || !Array.isArray(e.resources)) return;
                if (typeof e.epoch !== 'string' || !Number.isSafeInteger(e.sequence) || e.sequence < 1) return;
                if (this.serverEpoch === e.epoch && e.sequence <= this.sequence) return;
                const gap = this.serverEpoch !== e.epoch || e.sequence !== this.sequence + 1;
                this.serverEpoch = e.epoch; this.sequence = e.sequence;
                if (typeof e.operationId === 'string') {
                    if (!gap && this.seenOperations.has(e.operationId)) return;
                    this.seenOperations.add(e.operationId);
                    if (this.seenOperations.size > 128) this.seenOperations.delete(this.seenOperations.values().next().value!);
                }
                const resources = e.resources as LiveResource[]; this.cacheEpoch++;
                const own = gap || resources.some(r => r.owner === i.mail);
                void (gap ? trainerCache.clear(i.mail) : this.invalidateViews(resources)).then(() => own ? this.sync() : undefined).then(() => {
                    window.dispatchEvent(new CustomEvent('pgt-live-update', { detail: { resources, reset: gap } }));
                }).catch(() => { this.status = 'No se pudo actualizar. Pulsa Actualizar para reintentar.'; this.onChange(); });
            };
            socket.onclose = event => {
                if (epoch !== this.socketEpoch) return; this.socket = undefined; this.connection = '';
                if (event.code === 4401) { this.locked = true; this.status = 'La sesión ha cambiado. Vuelve a entrar.'; void this.invalidateTrainerCache(i.mail, true).catch(() => {}); this.onChange(); return; }
                this.scheduleReconnect();
            };
        } catch { this.scheduleReconnect(); }
        finally { if (epoch === this.socketEpoch) this.opening = false; }
    }
    private scheduleReconnect() {
        if (!this.identity || this.locked || !navigator.onLine) return;
        clearTimeout(this.retry); this.retry = setTimeout(() => void this.connect(), this.retryDelay + Math.random() * 250); this.retryDelay = Math.min(30000, this.retryDelay * 2);
    }
    private async invalidateViews(resources: LiveResource[]) {
        const i = this.current();
        const owners = new Set(resources.filter(r => r.owner).map(r => r.owner));
        await db.transaction('rw', db.trainerViews, db.trainerDays, async () => {
            for (const entry of await db.trainerViews.where('owner').equals(i.mail).toArray())
                if (owners.has(entry.mail) || resources.some(r => r.kind === 'catalog')) await db.trainerViews.delete(entry.key);
            if (resources.some(r => ['agenda', 'catalog', 'assignment', 'plan'].includes(r.kind))) await db.trainerDays.where('owner').equals(i.mail).delete();
        });
    }
    async importBackup(value: unknown) {
        const i = this.current(), b = value as any;
        if (b?.schemaVersion !== 1 || b.mail !== i.mail || !Array.isArray(b.entries) || b.entries.length > 200 || new Set(b.entries.map((e: any) => e.key)).size !== b.entries.length) throw Error('Copia no válida o de otra cuenta');
        for (const e of b.entries) {
            if (e.key === 'profile') { validateProfile(e.data); if (e.data.mail !== i.mail || e.data.perfil !== i.profile.perfil || 'pwd' in e.data) throw Error('Perfil no válido'); }
            else if (e.key === 'techniques') validateTechniques(e.data);
            else if (!['comments', 'index'].includes(e.key) && !e.key?.startsWith('plan:')) throw Error('Archivo no importable');
        }
        for (const e of b.entries) if (e.key === 'profile' || e.key === 'techniques') await this.edit(e.key, e.data);
    }
    async resolve(_key?: string, _choice?: string) { throw Error('Exporta los borradores anteriores y revisa la versión actual antes de guardar.'); }
    async logout(revoked = false) {
        const i = this.identity; this.stop(); this.locked = true;
        const invalidated = i ? this.invalidateTrainerCache(i.mail) : Promise.resolve();
        try { if (i && navigator.onLine && !revoked) await this.raw('/api/v2/auth/logout', 'POST', {}, i.token); }
        finally { await invalidated; this.identity = null; localStorage.removeItem('pgt-session'); this.channel.postMessage('logout'); this.status = 'Sesión cerrada'; this.onChange(); }
    }
}
