import type { TrainingPlan, Exercise } from '../domain/models.ts';
import type { Cursor, Continuity } from '../domain/plan-continuity.ts';
import { sessionSignature } from '../domain/plan-continuity.ts';
import { MAX_JSON_BYTES, jsonBytes } from '../domain/json-limits.ts';
import { validatePlan } from '../domain/models.ts';
import { putPackedBlock, storeNativeNode, readNativeNode, verifiedBlock, type NativeNode, type PackedBlock, PLAN_BLOCK_BYTES, nativeBlockBytes } from './native-packing.ts';
export { PLAN_BLOCK_BYTES, nativeBlockBytes, nativeValueBytes } from './native-packing.ts';
/** Native maps, arrays and scalar values only. Never encodes business data as JSON strings. */
type ObjectValue = Record<string, unknown>;
type Node = NativeNode;
export type PlanBlock = PackedBlock;
type Bank<T> = {
    inline: T[];
} | {
    blocks: string[];
};
type PackedCursor = Omit<Cursor, 'pending'> & {
    order?: string[];
    passesOrder?: string[];
    extra?: ObjectValue;
    pending: {
        p: number;
        t: number;
        complete: boolean;
        order?: string[];
        extra?: ObjectValue;
    }[];
};
type Value = {
    p: number;
    t: number;
    name: number;
    type: number;
    description: number;
    comment: number;
};
type PackedExercise = {
    v: number;
    priority: number;
    pass: number;
    complete: boolean;
    extra?: ObjectValue;
};
type PackedSession = {
    date: string;
    exercises: PackedExercise[];
    boundary?: {
        cursor: PackedCursor;
        stateSignature: string;
        signatureOverride?: string;
        extra?: ObjectValue;
    };
    extra?: ObjectValue;
};
type Metadata = {
    plan: Omit<TrainingPlan, 'sessions' | 'continuity'>;
    continuity?: Omit<Continuity, 'boundaries'> | Continuity;
};
export interface PlanHead {
    format: 'pgt-plan-v2';
    metadata: Node;
    strings: Bank<string>;
    dictionary: Bank<Value>;
    calendar: {
        date: string;
        block: string;
        offset: number;
    }[];
    packedContinuity: boolean;
}
export interface EncodedPlan {
    head: PlanHead;
    blocks: Record<string, PlanBlock>;
}
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const extras = (v: object, keys: string[]) => Object.fromEntries(Object.entries(v).filter(([k]) => !keys.includes(k)));
const exerciseKeys = ['positionId', 'techniqueId', 'posicion', 'tipo', 'descripcion_del_alumno', 'comment', 'prioridad', 'pass', 'positionComplete'];
const cursorKeys = ['priorities', 'priority', 'move', 'passes', 'pending'];
const pendingKeys = ['positionId', 'techniqueId', 'complete'];
const orderOf = (value: object, normal: string[]) => JSON.stringify(Object.keys(value)) === JSON.stringify(normal) ? {} : { order: Object.keys(value) };
const ordered = <T extends object>(value: T, order?: string[]): T => order ? Object.fromEntries(order.map(k => [k, (value as ObjectValue)[k]])) as T : value;
// Cursor checksums depend on JSON property order. Firestore maps do not preserve it.
function unpackCursor(c: PackedCursor, text: (id: number) => string): Cursor {
    return ordered({ priorities: c.priorities, priority: c.priority, move: c.move,
        passes: ordered(c.passes, c.passesOrder), pending: c.pending.map(p => ordered({
            positionId: text(p.p), techniqueId: text(p.t), complete: p.complete, ...p.extra
        }, p.order)), ...c.extra }, c.order);
}
function packableCursor(c: Cursor): boolean {
    return !!c && Array.isArray(c.priorities) && !!c.passes && typeof c.passes === 'object' &&
        !Array.isArray(c.passes) && Array.isArray(c.pending) && c.pending.every(p => p &&
            typeof p.positionId === 'string' && typeof p.techniqueId === 'string' && typeof p.complete === 'boolean');
}
/** Lossless codec only: does not generate, repair, project or change plan metadata. */
export function encodePlan(input: TrainingPlan): EncodedPlan {
    validatePlan(input);
    if (jsonBytes(input) > MAX_JSON_BYTES)
        throw Error('PLAN_LOGICAL_SIZE_LIMIT');
    const plan = plain(input), blocks: EncodedPlan['blocks'] = {};
    const put = (block: PlanBlock) => putPackedBlock(blocks, block);
    const treeNode = (value: unknown) => storeNativeNode(value, blocks);
    const strings: string[] = [], stringIds = new Map<string, number>(), dictionary: Value[] = [], valueIds = new Map<string, number>();
    const string = (value: string) => { let id = stringIds.get(value); if (id === undefined) {
        id = strings.length;
        strings.push(value);
        stringIds.set(value, id);
    } return id; };
    const value = (e: Exercise) => {
        const item: Value = { p: string(e.positionId), t: string(e.techniqueId), name: string(e.posicion), type: string(e.tipo),
            description: string(e.descripcion_del_alumno), comment: string(e.comment) };
        const key = JSON.stringify(item);
        let id = valueIds.get(key);
        if (id === undefined) {
            id = dictionary.length;
            dictionary.push(item);
            valueIds.set(key, id);
        }
        return id;
    };
    const cursor = (c: Cursor): PackedCursor => {
        const extra = extras(c, cursorKeys);
        return { priorities: c.priorities, priority: c.priority, move: c.move, passes: c.passes,
            ...orderOf(c, cursorKeys), passesOrder: Object.keys(c.passes),
            ...(Object.keys(extra).length ? { extra } : {}),
            pending: c.pending.map(p => {
                const extra = extras(p, pendingKeys);
                return { p: string(p.positionId), t: string(p.techniqueId), complete: p.complete,
                    ...orderOf(p, pendingKeys), ...(Object.keys(extra).length ? { extra } : {}) };
            }) };
    };
    const aligned = Boolean(plan.continuity && plan.continuity.boundaries.length === plan.sessions.length &&
        plan.continuity.boundaries.every((b, i) => b.date === plan.sessions[i].date && packableCursor(b.cursor)));
    const metadata: Metadata = { plan: extras(plan, ['sessions', 'continuity']) as Metadata['plan'],
        ...(plan.continuity ? { continuity: aligned ? extras(plan.continuity, ['boundaries']) as Omit<Continuity, 'boundaries'> : plan.continuity } : {}) };
    const calendar: PlanHead['calendar'] = [];
    let month = '', rows: Node[] = [], dates: string[] = [];
    const flush = () => { if (!rows.length)
        return; const id = put({ kind: 'sessions', rows }); dates.forEach((date, offset) => calendar.push({ date, block: id, offset })); rows = []; dates = []; };
    for (const [i, s] of plan.sessions.entries()) {
        const b = aligned ? plan.continuity!.boundaries[i] : undefined;
        const extra = extras(s, ['date', 'exercises']);
        const packed: PackedSession = { date: s.date, exercises: s.exercises.map(e => {
                const extra = extras(e, exerciseKeys);
                return { v: value(e), priority: e.prioridad, pass: e.pass, complete: e.positionComplete,
                    ...(Object.keys(extra).length ? { extra } : {}) };
            }), ...(b ? { boundary: { cursor: cursor(b.cursor), stateSignature: b.stateSignature,
                    ...(Object.keys(extras(b, ['date', 'signature', 'stateSignature', 'cursor'])).length ? { extra: extras(b, ['date', 'signature', 'stateSignature', 'cursor']) } : {}),
                    ...(b.signature === sessionSignature(s.exercises) ? {} : { signatureOverride: b.signature }) } } : {}),
            ...(Object.keys(extra).length ? { extra } : {}) };
        const node = treeNode(packed), nextMonth = s.date.slice(0, 7);
        if (month !== nextMonth || nativeBlockBytes({ kind: 'sessions', rows: [...rows, node] }) > PLAN_BLOCK_BYTES)
            flush();
        month = nextMonth;
        rows.push(node);
        dates.push(s.date);
    }
    flush();
    const bank = <T>(kind: 'strings' | 'dictionary', items: T[], allowInline: boolean): Bank<T> => {
        if (allowInline && nativeBlockBytes(items) < 64 * 1024)
            return { inline: items };
        const ids: string[] = [];
        let rows: unknown[] = [];
        for (const item of items) {
            if (nativeBlockBytes({ kind, rows: [...rows, item] }) > PLAN_BLOCK_BYTES && rows.length) {
                ids.push(put({ kind, rows }));
                rows = [];
            }
            rows.push(item);
        }
        if (rows.length)
            ids.push(put({ kind, rows }));
        return { blocks: ids };
    };
    const head: PlanHead = { format: 'pgt-plan-v2', metadata: treeNode(metadata), strings: bank('strings', strings, true),
        dictionary: bank('dictionary', dictionary, true), calendar, packedContinuity: aligned };
    if (nativeBlockBytes(head) > PLAN_BLOCK_BYTES)
        head.strings = bank('strings', strings, false);
    if (nativeBlockBytes(head) > PLAN_BLOCK_BYTES)
        head.dictionary = bank('dictionary', dictionary, false);
    if (nativeBlockBytes(head) > PLAN_BLOCK_BYTES)
        throw Error('PLAN_HEAD_TOO_LARGE');
    return { head, blocks };
}
/** Reads only referenced blocks; corrupt or missing content never becomes an empty plan. */
export function decodePlan(encoded: EncodedPlan, date?: string): TrainingPlan {
    const { head, blocks } = encoded;
    if (head.format !== 'pgt-plan-v2')
        throw Error('PLAN_FORMAT_UNSUPPORTED');
    const block = (id: string) => verifiedBlock(blocks, id);
    const node = (n: Node) => readNativeNode(n, blocks);
    const bank = <T>(value: Bank<T>, kind: 'strings' | 'dictionary'): T[] => 'inline' in value ? value.inline : value.blocks.flatMap(id => {
        const b = block(id);
        if (b.kind !== kind)
            throw Error('PLAN_BLOCK_KIND');
        return b.rows as T[];
    });
    const strings = bank(head.strings, 'strings'), dictionary = bank(head.dictionary, 'dictionary'), metadata = node(head.metadata) as Metadata;
    const text = (id: number) => { if (!Number.isInteger(id) || id < 0 || id >= strings.length)
        throw Error('PLAN_TEXT_REFERENCE'); return strings[id]; };
    const boundaries: Continuity['boundaries'] = [];
    const sessions = head.calendar.filter(s => date === undefined || s.date === date).map(entry => {
        const b = block(entry.block);
        if (b.kind !== 'sessions')
            throw Error('PLAN_BLOCK_KIND');
        if (!b.rows[entry.offset])
            throw Error('PLAN_SESSION_REFERENCE');
        const s = node(b.rows[entry.offset] as Node) as PackedSession;
        if (s.date !== entry.date)
            throw Error('PLAN_DATE_REFERENCE');
        const exercises = s.exercises.map(e => {
            const v = dictionary[e.v];
            if (!v)
                throw Error('PLAN_VALUE_REFERENCE');
            return { ...e.extra, positionId: text(v.p), techniqueId: text(v.t), posicion: text(v.name), tipo: text(v.type),
                descripcion_del_alumno: text(v.description), comment: text(v.comment), prioridad: e.priority, pass: e.pass, positionComplete: e.complete };
        });
        if (s.boundary)
            boundaries.push({ ...s.boundary.extra, date: s.date, signature: s.boundary.signatureOverride ?? sessionSignature(exercises),
                stateSignature: s.boundary.stateSignature, cursor: unpackCursor(s.boundary.cursor, text) });
        return { ...s.extra, date: s.date, exercises };
    });
    return { ...metadata.plan, sessions, ...(metadata.continuity ? {
            continuity: head.packedContinuity ? { ...metadata.continuity, boundaries } as Continuity : metadata.continuity as Continuity
        } : {}) };
}
