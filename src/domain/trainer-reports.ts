import type {TrainingPlan, Techniques, Competition} from './models.ts';

export function listedCompetitions(plans: Competition[], today: string, includePast = false) {
    return plans.filter(p => includePast || p.fecha_torneo >= today).slice().sort((a, b) => a.fecha_torneo.localeCompare(b.fecha_torneo) || a.planId.localeCompare(b.planId));
}

/** Current repertoire is the denominator; saved exercises remain untouched. */
export function preparation(plan: TrainingPlan, techniques: Techniques) {
    const current = new Map(techniques.positions.flatMap(p => p.tecnicas.map(t => [t.id, {
        ...t,
        position: p.posicion,
        priority: p.prioridad
    }] as const)));
    const planned = new Map<string, {
        id: string;
        position: string;
        type: string;
        priority: number;
        snapshotPriority: number;
        count: number;
        described: boolean;
        inRepertoire: boolean
    }>();
    for (const s of plan.sessions) for (const e of s.exercises) {
        let t = planned.get(e.techniqueId);
        if (!t) {
            const c = current.get(e.techniqueId);
            t = {
                id: e.techniqueId,
                position: e.posicion,
                type: e.tipo,
                priority: c?.priority ?? e.prioridad,
                snapshotPriority: e.prioridad,
                count: 0,
                described: Boolean(c?.descripcion_del_alumno.trim()),
                inRepertoire: Boolean(c)
            };
            planned.set(e.techniqueId, t);
        }
        t.count++;
    }
    const rows = [...new Set([...techniques.positions.map(p => p.prioridad), ...[...planned.values()].map(t => t.priority)])].sort((a, b) => a - b).map(priority => {
        const repertoire = [...current.values()].filter(t => t.priority === priority),
            items = [...planned.values()].filter(t => t.priority === priority),
            covered = items.filter(t => t.inRepertoire).length, appearances = items.reduce((n, t) => n + t.count, 0);
        return {
            priority,
            total: repertoire.length,
            covered,
            percent: repertoire.length ? covered / repertoire.length * 100 : 0,
            planned: items.length,
            described: items.filter(t => t.described).length,
            appearances,
            repeats: appearances - items.length,
            removed: items.filter(t => !t.inRepertoire).length
        };
    });
    const items = [...planned.values()];
    return {
        rows,
        items,
        total: current.size,
        covered: items.filter(t => t.inRepertoire).length,
        planned: items.length,
        described: items.filter(t => t.described).length,
        missing: items.filter(t => !t.described).sort((a, b) => b.count - a.count || a.position.localeCompare(b.position) || a.type.localeCompare(b.type)),
        sessions: plan.sessions.length,
        appearances: items.reduce((n, t) => n + t.count, 0)
    };
}

export interface StructureIndex {
    schemaVersion: 1;
    sourceSha: string;
    planId: string;
    mail: string;
    dictionary: [string, string][];
    sessions: { date: string; items: number[] }[];
    blocked: boolean
}

export function structureIndex(plan: TrainingPlan, sourceSha: string): StructureIndex {
    const dictionary: [string, string][] = [], ids = new Map<string, number>();
    return {
        schemaVersion: 1,
        sourceSha,
        planId: plan.planId,
        mail: plan.mail,
        blocked: Boolean(plan.structuralUpdateError),
        dictionary,
        sessions: plan.sessions.map(s => ({
            date: s.date, items: s.exercises.map(e => {
                const key = JSON.stringify([e.posicion, e.tipo]);
                let id = ids.get(key);
                if (id === undefined) {
                    id = dictionary.length;
                    ids.set(key, id);
                    dictionary.push([e.posicion, e.tipo]);
                }
                return id;
            })
        }))
    };
}

export interface DayGroup {
    key: string;
    exercises: [string, string][];
    students: { mail: string; name: string }[];
    competitions: string[]
}

export interface TrainingDay {
    date: string;
    nextDate: string;
    dates: string[];
    groups: DayGroup[];
    missing: number;
    blocked: number
}

export function trainingDay(indexes: {
    index: StructureIndex;
    name: string
}[], date: string, today: string): TrainingDay {
    const dates = [...new Set(indexes.flatMap(({index}) => index.sessions.map(s => s.date)))].sort(),
        nextDate = dates.find(d => d > today) || '';
    const chosen = date || nextDate, groups = new Map<string, {
        orders: Map<string, { exercises: [string, string][]; votes: number }>;
        students: Map<string, string>;
        competitions: Set<string>
    }>();
    for (const {index, name} of indexes) for (const s of index.sessions) {
        if (s.date !== chosen) continue;
        const exercises = s.items.map(id => index.dictionary[id]);
        const tokens = exercises.map(e => JSON.stringify(e));
        const key = JSON.stringify(tokens.slice().sort());
        let group = groups.get(key);
        if (!group) {
            group = {orders: new Map(), students: new Map(), competitions: new Set()};
            groups.set(key, group);
        }
        group.students.set(index.mail, name);
        group.competitions.add(index.planId);
        const order = JSON.stringify(tokens);
        let variant = group.orders.get(order);
        if (!variant) {
            variant = {exercises, votes: 0};
            group.orders.set(order, variant);
        }
        variant.votes++;
    }
    return {
        date: chosen,
        nextDate,
        dates,
        missing: 0,
        blocked: indexes.filter(x => x.index.blocked).length,
        groups: [...groups].map(([key, g]) => ({
            key,
            exercises: [...g.orders].sort((a, b) => b[1].votes - a[1].votes || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0][1].exercises,
            students: [...g.students].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0])).map(([mail, name]) => ({
                mail,
                name
            })),
            competitions: [...g.competitions].sort()
        })).sort((a, b) => b.students.length - a.students.length || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).map((group, index) => ({
            ...group,
            key: chosen + ":" + index
        }))
    };
}

export function validStructure(value: unknown): value is StructureIndex {
    if (!value || typeof value !== "object") return false;
    const v = value as StructureIndex;
    return v.schemaVersion === 1 && typeof v.sourceSha === "string" && typeof v.mail === "string" && typeof v.planId === "string" && typeof v.blocked === "boolean" && Array.isArray(v.dictionary) && v.dictionary.every(e => Array.isArray(e) && e.length === 2 && e.every(t => typeof t === "string")) && Array.isArray(v.sessions) && v.sessions.every(s => typeof s.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.date) && Array.isArray(s.items) && s.items.every(i => Number.isInteger(i) && i >= 0 && i < v.dictionary.length));
}
