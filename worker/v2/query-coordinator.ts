import { VersionCache } from '../../src/application/version-cache.ts';
import type { Profile, Catalog, Index, TrainingPlan } from '../../src/domain/models.ts';
import { ApiError, normalizedMail, fingerprint } from '../security.ts';
import { NativeAggregates, type AggregateRef, type AggregateChange, type Publication, type CommandIdentity } from './aggregates.ts';
import { PlanViews } from './plan-views.ts';
import { materializePlanSlice, type PlanTextProjection } from '../../src/infrastructure/plan-text-projection.ts';
import { queryMonthlyAgenda, type MonthlyAgenda } from '../../src/infrastructure/trainer-agenda.ts';
import { madridDate } from '../../src/domain/plan-text-updates.ts';
import type { Roster } from './users.ts';
import { validDate } from '../../src/domain/models.ts';
import { collectUnusedBlocks } from './block-cleanup.ts';
import type { PreparedPlan } from './plans.ts';
import { publicProfile, sessionEpoch, type SessionProfile } from './session-identity.ts';

/** Issued only by authenticated session middleware, never decoded from a request body. */
export type QuerySession = { mail: string; pwdFingerprint: string; role: Profile['perfil']; sessionEpoch?: string };
export type EntityReader = <T>(ref: AggregateRef) => Promise<{ data: T; version: string } | null>;
export type PlanChange = { owner: string; planId: string; data: TrainingPlan | null; expected: string | null; prepared?: PreparedPlan };
export type PreparedCommand = { changes: AggregateChange[]; operationId: string; metadata?: Record<string, string>; plans?: PlanChange[] };
type RecordValue = { data: unknown; version: string } | null;
export type UserQuery = { kind: 'profile' | 'repertoire' | 'comments' | 'assignment'; owner: string };
export type SharedQuery = { kind: 'catalog' | 'roster' } | { kind: 'agenda'; month: string };
const keyOf = (ref: AggregateRef) => ref.kind + ':' + ref.id;

/** One instance per academy, owned by its sole command Durable Object.
 * All active writers must use command() or the same serialized boundary. Startup
 * starts a new empty cache; no persistent business cache or arbitrary TTL exists.
 * This module does not expose an HTTP API or authenticate bearer tokens itself.
 */
export class QueryCoordinator {
    onPublish: (changes: AggregateChange[], plans: PlanChange[], operationId: string) => void | Promise<void> = () => {};
    beforePublish: (operationId: string) => void | Promise<void> = () => {};
    private readonly store: NativeAggregates;
    private readonly plans: PlanViews;
    private readonly cache: VersionCache<unknown>;
    private readonly viewsCache: VersionCache<unknown>;
    private readonly generations = new Map<string, number>();
    private queue: Promise<unknown> = Promise.resolve();
    constructor(store: NativeAggregates, plans: PlanViews, bytes = 32 * 1024 * 1024) {
        if (store !== plans.aggregates) throw Error('COORDINATOR_STORE_MISMATCH');
        this.store = store; this.plans = plans;
        // Large materialized plans must not evict authorization/source/version
        // records and make every connected user's navigation refetch metadata.
        this.cache = new VersionCache(Math.floor(bytes / 2));
        this.viewsCache = new VersionCache(Math.floor(bytes / 2));
    }
    get planViews() { return this.plans; }
    collectBlocks(target: string, token = '') {
        return this.serial(() => collectUnusedBlocks(this.store.db, this.store.namespace, target, token));
    }
    private async pinned(owner: string, id: string) {
        const key = 'plan:' + id + '__' + owner;
        return await this.cache.load(key, String(this.generations.get(key) ?? 0), () => this.plans.plans.head(owner, id)) as Awaited<ReturnType<PlanViews['plans']['head']>>;
    }
    private async view(owner: string, id: string, date?: string) {
        const distribution = 'plan:' + id + '__' + owner, text = keyOf({ kind: 'plan-text', id: id + '__' + owner });
        const version = (this.generations.get(distribution) ?? 0) + '/' + (this.generations.get(text) ?? 0);
        return await this.viewsCache.load(JSON.stringify(['view', owner, id, date ?? 'all']), version, async () => {
            const head = await this.pinned(owner, id), binding = await this.record<PlanTextProjection>({ kind: 'plan-text', id: id + '__' + owner });
            const base = await this.viewsCache.load(JSON.stringify(['base', owner, id, date ?? 'all']), String(this.generations.get(distribution) ?? 0),
                () => this.plans.plans.read(owner, id, date, head)) as Awaited<ReturnType<PlanViews['plans']['read']>>;
            if (!base) return null;
            if (!binding) throw new ApiError(409, 'PLAN_TEXT_NOT_PUBLISHED');
            return { data: materializePlanSlice(base.data, binding.data, base.baseHash), version: { distribution: base.version, text: binding.version } };
        }) as Awaited<ReturnType<PlanViews['read']>>;
    }
    snapshot(session: QuerySession, owner: string, known: Record<string, string> = {}) {
        return this.serial(async () => {
            const actor = await this.actor(session); owner = normalizedMail(owner); this.permitted(actor, owner);
            const profile = await this.record<Profile>({ kind: 'profile', id: owner }), techniques = await this.record<import('../../src/domain/models.ts').Techniques>({ kind: 'repertoire', id: owner }),
                comments = await this.record({ kind: 'comments', id: owner }), index = await this.record<Index & { pendingPlanIds?: string[]; projectionIssues?: Record<string, { code: string; bytes: number }> }>({ kind: 'assignment', id: owner });
            if (!profile || !techniques || !comments || !index) throw new ApiError(409, 'REGISTRATION_INCOMPLETE');
            const remote = (key: string, record: { data: unknown; version: string }) => known[key] === record.version ?
                { unchanged: true, sha: record.version } : { data: record.data, sha: record.version };
            const safe = publicProfile(profile.data);
            const plans = [];
            for (const id of index.data.planIds.filter(id => !index.data.deletedPlanIds?.includes(id))) {
                const head = await this.pinned(owner, id), text = await this.record<PlanTextProjection>({ kind: 'plan-text', id: id + '__' + owner });
                if (!head || !text || text.data.format !== 'pgt-plan-text-v2') continue;
                const version = head.version + ':' + text.version;
                if (known['plan:' + id] === version) plans.push({ unchanged: true, sha: version, planId: id });
                else { const value = await this.view(owner, id); if (value) plans.push({ data: value.data, sha: version }); }
            }
            const planIssues = Object.entries(index.data.projectionIssues ?? {}).map(([planId, issue]) => ({ planId, code: issue.code,
                ...(issue.code === 'PLAN_TOO_LARGE' ? { size: { file: 'plan_' + planId + '.json', bytes: issue.bytes, limitBytes: 4194304 } } : {}) }));
            return { profile: remote('profile', { ...profile, data: safe }), techniques: remote('techniques', techniques), comments: remote('comments', comments),
                index: remote('index', index), plans, deletedPlanIds: index.data.deletedPlanIds ?? [], planIssues, pendingPlanIds: index.data.pendingPlanIds ?? [] };
        });
    }
    trainingDay(session: QuerySession, date: string, today = madridDate()) {
        if (date && !validDate(date) || !validDate(today)) return Promise.reject(new ApiError(400, 'DATE_INVALID'));
        return this.serial(async () => {
            const actor = await this.actor(session);
            if (actor.perfil !== 'entrenador') throw new ApiError(403, 'TRAINER_REQUIRED');
            const roster = await this.record<Roster>({ kind: 'roster', id: 'users' });
            const names = new Map((roster?.data.users ?? []).map(p => [p.mail, [p.nombre, p.apellidos].filter(Boolean).join(' ')]));
            if (date) {
                const month = await this.record<MonthlyAgenda>({ kind: 'agenda', id: date.slice(0, 7) });
                return queryMonthlyAgenda(month?.data ?? { format: 'pgt-trainer-month-v2', month: date.slice(0, 7), labels: [], patterns: [], dateSets: [], calendars: [], contributions: [], pending: [] }, date, today, names);
            }
            const calendar = await this.record<{ months: string[] }>({ kind: 'agenda', id: 'calendar' });
            for (const key of (calendar?.data.months ?? []).filter(m => m >= today.slice(0, 7)).sort()) {
                const month = await this.record<MonthlyAgenda>({ kind: 'agenda', id: key });
                if (!month) continue;
                const next = [...new Set(month.data.calendars.filter(c => c.end >= today).flatMap(c => month.data.dateSets[c.dateSet].dates))].sort().find(d => d > today);
                if (!next || next.slice(0, 7) !== key) continue;
                return queryMonthlyAgenda(month.data, '', today, names);
            }
            return { date: '', nextDate: '', dates: [], groups: [], missing: 0, blocked: 0 };
        });
    }
    private serial<T>(fn: () => Promise<T>): Promise<T> {
        const result = this.queue.then(fn);
        this.queue = result.catch(() => undefined);
        return result;
    }
    private async record<T>(ref: AggregateRef): Promise<{ data: T; version: string } | null> {
        const key = keyOf(ref), generation = String(this.generations.get(key) ?? 0);
        return await this.cache.load(key, generation, () => this.store.read(ref)) as { data: T; version: string } | null;
    }
    private async actor(session: QuerySession): Promise<Profile> {
        const mail = normalizedMail(session.mail), profile = await this.record<SessionProfile>({ kind: 'profile', id: mail });
        if (!profile || profile.data.mail !== mail || !profile.data.pwd ||
            !session.sessionEpoch || session.sessionEpoch !== sessionEpoch(profile.data) ||
            profile.data.perfil !== session.role || await fingerprint(profile.data.pwd) !== session.pwdFingerprint)
            throw new ApiError(401, 'SESSION_REVOKED');
        return profile.data;
    }
    private permitted(actor: Profile, owner: string) {
        if (actor.mail !== owner && actor.perfil !== 'entrenador') throw new ApiError(403, 'OTHER_USER_FORBIDDEN');
    }
    private invalidate(ref: AggregateRef) {
        const key = keyOf(ref);
        this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
        this.cache.invalidate(key);
    }
    /** Trusted server services only (login/registration); never a generic API endpoint. */
    internal<T>(action: (read: EntityReader, publish: (command: PreparedCommand, identity?: CommandIdentity) => Promise<Publication>) => Promise<T>) {
        return this.serial(() => action(ref => this.record(ref), (command, identity) => this.publish(command, identity)));
    }
    private async publish(command: PreparedCommand, identity?: CommandIdentity): Promise<Publication> {
        try {
            await this.beforePublish(command.operationId);
            const plans = [];
            for (const p of command.plans ?? []) plans.push(p.prepared ?? (p.data ? await this.plans.plans.prepare(p.data, p.expected, command.operationId, command.changes.length + (command.plans?.length ?? 0) > 20) :
                await this.plans.plans.prepareRemoval(p.owner, p.planId, p.expected)));
            const outcome = await this.store.publishDetailed(command.changes, command.operationId,
                identity ? { requestHash: identity.requestHash, metadata: command.metadata } : undefined, plans), result = outcome.publication;
            if (!outcome.replayed) for (const [i, change] of command.changes.entries()) {
                if (result.changed[i]) this.invalidate(change.ref);
                const key = keyOf(change.ref), generation = String(this.generations.get(key) ?? 0);
                await this.cache.load(key, generation, async () => ({ data: change.data, version: result.versions[i] }));
            }
            if (!outcome.replayed) for (const p of plans) if (p.changed) {
                const key = 'plan:' + p.planId + '__' + p.owner;
                this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
            }
            if (!outcome.replayed) await this.onPublish(command.changes.filter((_, i) => result.changed[i]), command.plans ?? [], command.operationId);
            return result;
        } catch (error) {
            command.changes.forEach(change => this.invalidate(change.ref));
            for (const p of command.plans ?? []) {
                const key = 'plan:' + p.planId + '__' + p.owner;
                this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
            }
            throw error;
        }
    }
    /** Private outbox recovery, called only for persisted coordination IDs after a mutation. */
    deliverOperation(operationId: string) {
        return this.serial(async () => {
            const event = await this.store.publicationEvent(operationId);
            if (!event) return false;
            const changes: AggregateChange[] = [];
            for (const ref of event.refs) {
                const current = ref.kind === 'profile' ? await this.record<Profile>(ref) : null;
                changes.push({ ref, data: current?.data, expected: current?.version ?? null });
            }
            await this.onPublish(changes, event.plans.map(p => ({ ...p, data: null, expected: null })), operationId);
            return true;
        });
    }
    user(session: QuerySession, query: UserQuery): Promise<RecordValue> {
        return this.serial(async () => {
            const actor = await this.actor(session), owner = normalizedMail(query.owner);
            this.permitted(actor, owner);
            if (!['profile', 'repertoire', 'comments', 'assignment'].includes(query.kind)) throw new ApiError(400, 'QUERY_INVALID');
            const result = await this.record<Record<string, unknown>>({ kind: query.kind, id: owner });
            if (result && query.kind === 'profile') {
                const data = publicProfile(result.data as unknown as SessionProfile);
                return { ...result, data };
            }
            return result;
        });
    }
    shared(session: QuerySession, query: SharedQuery): Promise<RecordValue> {
        return this.serial(async () => {
            const actor = await this.actor(session);
            if (query.kind === 'catalog') {
                const result = await this.record<Catalog>({ kind: 'catalog', id: 'competitions' });
                if (!result || actor.perfil === 'entrenador') return result;
                return { ...result, data: { ...result.data, plans: result.data.plans.filter(p => p.alumnos.includes(actor.mail)).map(p => ({ ...p, alumnos: [actor.mail] })) } };
            }
            if (actor.perfil !== 'entrenador') throw new ApiError(403, 'TRAINER_REQUIRED');
            if (query.kind === 'roster') return this.record({ kind: 'roster', id: 'users' });
            if (query.kind !== 'agenda' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(query.month)) throw new ApiError(400, 'QUERY_INVALID');
            return this.record({ kind: 'agenda', id: query.month });
        });
    }
    plan(session: QuerySession, owner: string, planId: string, date?: string) {
        if (date !== undefined && !validDate(date)) return Promise.reject(new ApiError(400, 'DATE_INVALID'));
        return this.serial(async () => {
            const actor = await this.actor(session);
            owner = normalizedMail(owner); this.permitted(actor, owner);
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(planId)) throw new ApiError(400, 'PLAN_ID_INVALID');
            planId = planId.toLowerCase();
            const assignments = await this.record<Index>({ kind: 'assignment', id: owner });
            if (!assignments?.data.planIds.includes(planId) || assignments.data.deletedPlanIds?.includes(planId))
                throw new ApiError(404, 'PLAN_NOT_ASSIGNED');
            return this.view(owner, planId, date);
        });
    }
    /** Trusted business command handlers only. They validate payload/permissions and
     * recover their durable command ACK before preparing non-deterministic changes.
     * This callback cannot be supplied by a network request.
     */
    command(session: QuerySession, prepare: (actor: Readonly<Profile>, read: EntityReader) => Promise<PreparedCommand>, identity?: CommandIdentity): Promise<Publication> {
        return this.serial(async () => {
            const actor = await this.actor(session);
            if (identity) {
                const saved = await this.store.recoverCommand(identity);
                if (saved) return saved;
            }
            const command = await prepare(structuredClone(actor), ref => this.record(ref));
            if (identity && command.operationId !== identity.operationId) throw new ApiError(400, 'COMMAND_IDENTITY_INVALID');
            return this.publish(command, identity);
        });
    }
}
