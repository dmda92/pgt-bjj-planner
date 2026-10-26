import type {Techniques, TrainingPlan, Comments} from './models.ts';
import {
    catalogOf,
    cursorSignature,
    initialCursor,
    nextExercise,
    sessionSignature,
    updateFutureDeletions,
    type CatalogPosition,
    type Continuity,
    type Cursor
} from './plan-continuity.ts';
import {generatePlan} from './planner.ts';

// DEV structural extension. The original generator/deletion engine remains intact.
export type AdditionTechniques = Techniques & { additionRevision?: number };
export type AdditionPlan = TrainingPlan & { appliedAdditionRevision?: number };

export function hasTrainableAdditions(previous: Techniques, next: Techniques): boolean {
    const known = new Map(catalogOf(previous).map(p => [p.id, new Set(p.techniques)]));
    return catalogOf(next).some(p => !known.has(p.id) || p.techniques.some(id => !known.get(p.id)!.has(id)));
}

function restoreContinuity(plan: TrainingPlan, t: Techniques, notes: Comments): Continuity {
    if (plan.continuity) return plan.continuity;
    // A short legacy plan is accepted only against the server-owned pre-change catalogue.
    const reference = t.deletionCatalog;
    if (!reference) throw Error('Este plan antiguo no tiene un cursor reconstruible. El entrenador debe revisar su continuidad.');
    const source: Techniques = {
        schemaVersion: 1,
        revision: 1,
        updatedAt: plan.updatedAt,
        positions: reference.map(p => ({
            id: p.id,
            posicion: 'Legacy',
            prioridad: p.priority,
            tecnicas: p.techniques.map(id => ({id, tipo: 'Legacy', descripcion_del_alumno: ''}))
        }))
    };
    const generated = generatePlan(plan, plan.mail, source, notes, plan.generatedAt);
    if (plan.sessions.length !== generated.sessions.length || plan.sessions.some((s, i) => s.date !== generated.sessions[i].date || sessionSignature(s.exercises) !== sessionSignature(generated.sessions[i].exercises))) throw Error('Este plan antiguo tiene una secuencia incompatible. El entrenador debe revisar su continuidad.');
    return generated.continuity!;
}

function validateBoundary(plan: TrainingPlan, continuity: Continuity, count: number, cursor: Cursor) {
    if (continuity.version !== 1 || continuity.boundaries.length !== plan.sessions.length || plan.sessions.some((s, i) => continuity.boundaries[i].date !== s.date || continuity.boundaries[i].signature !== sessionSignature(s.exercises) || continuity.boundaries[i].stateSignature !== cursorSignature(continuity.boundaries[i].cursor))) throw Error('No se puede validar el cursor del plan. El entrenador debe revisar su continuidad.');
    if (!Array.isArray(cursor.pending) || !['second', 'back', 'forward'].includes(cursor.move) || !cursor.priorities.includes(cursor.priority) || Object.values(cursor.passes).some(n => !Number.isSafeInteger(n) || n < 1)) throw Error('Cursor del plan no válido; requiere revisión del entrenador');
    if (!count) return;
    const history = plan.sessions.slice(0, count).flatMap(s => s.exercises), last = history.at(-1)!,
        passes: Record<string, number> = {};
    for (const e of history) passes[e.prioridad] = Math.max(passes[e.prioridad] || 0, e.pass);
    const consumed = new Set(history.filter(e => e.prioridad === cursor.priority && e.pass === cursor.passes[cursor.priority]).map(e => e.techniqueId));
    if (last.prioridad !== cursor.priority || last.pass !== cursor.passes[cursor.priority] || Object.keys(passes).length !== Object.keys(cursor.passes).length || Object.entries(passes).some(([p, n]) => cursor.passes[p] !== n) || new Set(cursor.pending.map(r => r.techniqueId)).size !== cursor.pending.length || cursor.pending.some(r => consumed.has(r.techniqueId))) throw Error('El cursor contradice el avance histórico; requiere revisión del entrenador');
}

/** Incorporate only additions; existing priority changes remain outside this policy.
 * Insertions before the consumed cursor and closed positions wait for next pass. */
function extendPending(cursor: Cursor, old: CatalogPosition[], catalog: CatalogPosition[], plan: TrainingPlan, count: number) {
    if (!count || !cursor.pending.length) return;
    const history = plan.sessions.slice(0, count).flatMap(s => s.exercises).filter(e => e.prioridad === cursor.priority && e.pass === cursor.passes[cursor.priority]);
    const last = history.at(-1)!, anchor = old.findIndex(p => p.id === last.positionId);
    const pendingIds = new Set(cursor.pending.map(r => r.techniqueId));
    const consumed = new Set(history.map(e => e.techniqueId));
    const oldPositions = new Map(old.map((p, i) => [p.id, {p, i}]));
    cursor.pending = catalog.filter(p => p.priority === cursor.priority).flatMap((p, index, positions) => {
        const existing = oldPositions.get(p.id),
            closed = history.some(e => e.positionId === p.id && e.positionComplete);
        let eligiblePosition = false;
        if (existing) eligiblePosition = existing.i >= anchor && !closed;
        else {
            // A new position belongs to the current occurrence only after its consumed anchor.
            const before = positions.slice(0, index).filter(v => oldPositions.has(v.id)).at(-1);
            eligiblePosition = !!before && oldPositions.get(before.id)!.i >= anchor;
        }
        const lastCurrentIndex = p.techniques.indexOf(last.techniqueId);
        return p.techniques.filter((id, i) => {
            if (pendingIds.has(id)) return true;
            if (!eligiblePosition || consumed.has(id) || existing?.p.techniques.includes(id)) return false;
            if (p.id !== last.positionId) return true;
            if (lastCurrentIndex >= 0) return i > lastCurrentIndex;
            // Deleted anchor: compare to the next surviving old technique, without rewinding.
            const nextOld = p.techniques.slice(i + 1).find(v => existing?.p.techniques.includes(v));
            return !nextOld || existing!.p.techniques.indexOf(nextOld) > existing!.p.techniques.indexOf(last.techniqueId);
        }).map(id => ({positionId: p.id, techniqueId: id, complete: false}));
    });
    cursor.pending = cursor.pending.map((r, i, a) => ({
        ...r,
        complete: !a.slice(i + 1).some(v => v.positionId === r.positionId)
    }));
}

export function updateFutureStructure(plan: AdditionPlan, t: AdditionTechniques, notes: Comments, today: string): AdditionPlan {
    const base = updateFutureDeletions(plan, t, notes, today) as AdditionPlan;
    if (!t.additionRevision || base.appliedAdditionRevision === t.additionRevision || plan.fecha_torneo <= today || !plan.sessions.some(s => s.date > today)) return base;
    try {
        const continuity = restoreContinuity(base, t, notes), current = catalogOf(t),
            previousCatalog = plan.continuity?.catalog || continuity.catalog,
            known = new Map(previousCatalog.map(p => [p.id, p]));
        // Keep existing priority assignments; a genuinely new priority joins the sorted
        // ring when the current occurrence finishes, preserving the -1/+2 phase.
        const catalog = current.map(p => ({...p, priority: known.get(p.id)?.priority ?? p.priority}));
        const count = base.sessions.filter(s => s.date <= today).length;
        if (base.sessions.some((s, i) => i < count ? s.date > today : s.date <= today)) throw Error('El orden de fechas del plan no permite recuperar el cursor');
        const cursor = count ? structuredClone(continuity.boundaries[count - 1].cursor) : initialCursor(catalog);
        validateBoundary(base, continuity, count, cursor);
        extendPending(cursor, previousCatalog, catalog, base, count);
        if (!catalog.some(p => p.priority === cursor.priority)) cursor.priorities = [...new Set([...cursor.priorities, ...catalog.map(p => p.priority)])].sort((a, b) => a - b);
        const boundaries = continuity.boundaries.slice(0, count);
        const sessions = base.sessions.map((s, i) => {
            if (i < count) return s;
            const exercises = Array.from({length: base.ejercicios_por_sesion}, () => nextExercise(cursor, catalog, t, notes));
            boundaries.push({
                date: s.date,
                signature: sessionSignature(exercises),
                stateSignature: cursorSignature(cursor),
                cursor: structuredClone(cursor)
            });
            return {...s, exercises};
        });
        const {structuralUpdateError: _, ...rest} = base;
        return {
            ...rest,
            sessions,
            continuity: {version: 1, catalog, boundaries},
            appliedDeletions: [...new Set([...(base.appliedDeletions || []), ...(t.deletedIds || [])])],
            appliedDeletionRevision: t.deletionRevision || 0,
            appliedAdditionRevision: t.additionRevision
        };
    } catch (e) {
        const message = e instanceof Error ? e.message : 'No se puede actualizar el plan';
        return base.structuralUpdateError === message ? base : {...base, structuralUpdateError: message};
    }
}
