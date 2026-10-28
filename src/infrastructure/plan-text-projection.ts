import { blockDigest } from './native-packing.ts';
import type { TrainingPlan, Techniques, Comments } from '../domain/models.ts';
import { validDate, validatePlan } from '../domain/models.ts';
import { MAX_JSON_BYTES, jsonBytes } from '../domain/json-limits.ts';
type Fields = {
    posicion: string;
    tipo: string;
    descripcion_del_alumno: string;
    comment: string;
};
type PlanMetadata = Omit<TrainingPlan, 'sessions' | 'continuity'>;
type Appearance = {
    date: string;
    positionId: string;
    techniqueId: string;
    value: number;
    count: number;
};
type Patch = {
    from: string;
    positionId: string;
    techniqueId: string;
    fields: Partial<Fields>;
};
export interface PlanTextProjection {
    format: 'pgt-plan-text-v2';
    baseHash: string;
    metadata: PlanMetadata;
    values: Fields[];
    appearances: Appearance[];
    patches: Patch[];
    logicalBytes: number;
}
export class ProjectedPlanTooLarge extends Error {
    readonly bytes: number;
    readonly planId: string;
    constructor(planId: string, bytes: number) { super('PLAN_TOO_LARGE'); this.planId = planId; this.bytes = bytes; }
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function fields(e: Fields): Fields { return { posicion: e.posicion, tipo: e.tipo, descripcion_del_alumno: e.descripcion_del_alumno, comment: e.comment }; }
/** Derived at import/generation/structure publication, not rebuilt on a text command. */
export function indexPlanText(plan: TrainingPlan): PlanTextProjection {
    validatePlan(plan);
    const { sessions, continuity, ...metadata } = copy(plan), values: Fields[] = [], ids = new Map<string, number>(), appearances: Appearance[] = [];
    for (const s of sessions) {
        const counts = new Map<string, Appearance>();
        for (const e of s.exercises) {
            const value = fields(e), key = JSON.stringify(value);
            let id = ids.get(key);
            if (id === undefined) {
                id = values.length;
                ids.set(key, id);
                values.push(value);
            }
            const k = JSON.stringify([e.positionId, e.techniqueId, id]);
            const prior = counts.get(k);
            if (prior)
                prior.count++;
            else
                counts.set(k, { date: s.date, positionId: e.positionId, techniqueId: e.techniqueId, value: id, count: 1 });
        }
        appearances.push(...counts.values());
    }
    return { format: 'pgt-plan-text-v2', baseHash: blockDigest(plan), metadata, values, appearances, patches: [], logicalBytes: jsonBytes(plan) };
}
function resolved(index: PlanTextProjection, a: Appearance): Fields {
    const base = index.values[a.value];
    if (!base)
        throw Error('PLAN_TEXT_INDEX_CORRUPT');
    let value = base;
    for (const p of index.patches)
        if (p.from <= a.date && p.positionId === a.positionId && p.techniqueId === a.techniqueId)
            value = { ...value, ...p.fields };
    return value;
}
const tomorrow = (today: string) => new Date(Date.parse(today + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
/** Pure text/label propagation. Never consumes a distribution block or a current clock. */
export function projectPlanText(index: PlanTextProjection, techniques: Techniques, comments: Comments, today: string): PlanTextProjection {
    if (!validDate(today))
        throw Error('DATE_INVALID');
    if (index.metadata.fecha_torneo <= today || index.metadata.structuralUpdateError)
        return index;
    const source = new Map(techniques.positions.flatMap(p => p.tecnicas.map(t => [t.id, { p, t }] as const)));
    const notes = new Map(comments.comments.map(c => [c.techniqueId, c.comment]));
    const descriptions = { ...index.metadata.appliedDescriptionUpdates }, annotations = { ...index.metadata.appliedCommentUpdates };
    const updates = new Map<string, Patch>();
    let checkpointsChanged = false;
    for (const a of index.appearances) {
        if (a.date <= today)
            continue;
        const t = source.get(a.techniqueId);
        if (!t)
            continue;
        const old = resolved(index, a), value: Partial<Fields> = {};
        const d = techniques.descriptionUpdates?.[a.techniqueId], c = comments.commentUpdates?.[a.techniqueId];
        if (d && index.metadata.appliedDescriptionUpdates?.[a.techniqueId] !== d) {
            value.descripcion_del_alumno = t.t.descripcion_del_alumno;
            descriptions[a.techniqueId] = d;
            checkpointsChanged = true;
        }
        if (c && index.metadata.appliedCommentUpdates?.[a.techniqueId] !== c) {
            value.comment = notes.get(a.techniqueId) || '';
            annotations[a.techniqueId] = c;
            checkpointsChanged = true;
        }
        if (t.p.id === a.positionId) {
            if (old.posicion !== t.p.posicion)
                value.posicion = t.p.posicion;
            if (old.tipo !== t.t.tipo)
                value.tipo = t.t.tipo;
        }
        if (Object.keys(value).length) {
            const key = JSON.stringify([a.positionId, a.techniqueId]), prior = updates.get(key);
            updates.set(key, { from: tomorrow(today), positionId: a.positionId, techniqueId: a.techniqueId, fields: { ...prior?.fields, ...value } });
        }
    }
    if (!updates.size && !checkpointsChanged)
        return index;
    const next = copy(index);
    for (const p of updates.values()) {
        const same = next.patches.find(v => v.from === p.from && v.positionId === p.positionId && v.techniqueId === p.techniqueId);
        if (same)
            same.fields = { ...same.fields, ...p.fields };
        else
            next.patches.push(p);
    }
    next.patches.sort((a, b) => a.from.localeCompare(b.from));
    // Keep only field versions observed by at least one stored session. Edits made
    // between training dates must not accumulate unreachable 100k-character strings.
    const used = next.patches.map(() => new Set<keyof Fields>());
    for (const a of next.appearances) {
        const last = new Map<keyof Fields, number>();
        next.patches.forEach((p, i) => {
            if (p.from <= a.date && p.positionId === a.positionId && p.techniqueId === a.techniqueId)
                for (const key of Object.keys(p.fields) as (keyof Fields)[]) last.set(key, i);
        });
        for (const [key, i] of last) used[i].add(key);
    }
    next.patches = next.patches.flatMap((p, i) => used[i].size ? [{ ...p, fields: Object.fromEntries(Object.entries(p.fields).filter(([key]) => used[i].has(key as keyof Fields))) }] : []);
    if (checkpointsChanged) {
        next.metadata.appliedDescriptionUpdates = descriptions;
        next.metadata.appliedCommentUpdates = annotations;
    }
    let delta = jsonBytes(next.metadata) - jsonBytes(index.metadata);
    for (const a of index.appearances) {
        const before = resolved(index, a), after = resolved(next, a);
        for (const key of Object.keys(before) as (keyof Fields)[])
            delta += a.count * (jsonBytes(after[key]) - jsonBytes(before[key]));
    }
    next.logicalBytes = index.logicalBytes + delta;
    if (next.logicalBytes > MAX_JSON_BYTES)
        throw new ProjectedPlanTooLarge(index.metadata.planId, next.logicalBytes);
    return next;
}
/** A revision/updatedAt change also participates in exact logical size accounting. */
export function updateProjectionMetadata(index: PlanTextProjection, changes: Partial<PlanMetadata>): PlanTextProjection {
    const metadata = { ...index.metadata, ...changes }, logicalBytes = index.logicalBytes + jsonBytes(metadata) - jsonBytes(index.metadata);
    if (logicalBytes > MAX_JSON_BYTES)
        throw new ProjectedPlanTooLarge(metadata.planId, logicalBytes);
    return { ...index, metadata, logicalBytes };
}
/** Requires the matching base distribution; text validity never comes from live technique reads. */
export function materializePlanText(base: TrainingPlan, index: PlanTextProjection): TrainingPlan {
    return materializePlanSlice(base, index, blockDigest(base));
}
/** Internal selective-read path. verifiedBaseHash must come from the stored plan head,
 * never from request parameters. It identifies the full base even for a single-date slice.
 */
export function materializePlanSlice(base: TrainingPlan, index: PlanTextProjection, verifiedBaseHash: string): TrainingPlan {
    if (verifiedBaseHash !== index.baseHash) throw Error('PLAN_BASE_REVISION_MISMATCH');
    if (base.mail !== index.metadata.mail || base.planId !== index.metadata.planId)
        throw Error('PLAN_IDENTITY_INVALID');
    return { ...copy(base), ...copy(index.metadata), sessions: base.sessions.map(s => ({ ...s, exercises: s.exercises.map(e => {
                let value = fields(e);
                for (const p of index.patches)
                    if (p.from <= s.date && p.positionId === e.positionId && p.techniqueId === e.techniqueId)
                        value = { ...value, ...p.fields };
                return { ...e, ...value };
            }) })) };
}
