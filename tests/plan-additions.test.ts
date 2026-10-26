import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialVersion, type Techniques, type TrainingPlan} from '../src/domain/models.ts';
import {generatePlan, tabata} from '../src/domain/planner.ts';
import {catalogOf} from '../src/domain/plan-continuity.ts';
import {hasTrainableAdditions, updateFutureStructure, type AdditionTechniques} from '../src/domain/plan-additions.ts';

function sample() {
    const t: AdditionTechniques = {
        ...initialVersion(),
        positions: [1, 2, 3].flatMap(prioridad => [0, 1].map(n => ({
            id: crypto.randomUUID(),
            posicion: `Position ${prioridad}-${n}`,
            prioridad,
            tecnicas: [0, 1, 2].map(i => ({
                id: crypto.randomUUID(),
                tipo: `Technique ${i}`,
                descripcion_del_alumno: ''
            }))
        })))
    };
    const notes = {...initialVersion(), comments: []};
    const plan = generatePlan({
        planId: crypto.randomUUID(),
        alumnos: ['a@example.test'],
        fecha_comienzo: '2026-10-01',
        fecha_torneo: '2026-12-01',
        dias_de_entrenamiento: [1, 2, 3, 4, 5, 6, 7],
        ejercicios_por_sesion: 2,
        tiempo_por_tecnica_segundos: 180,
        descanso_entre_ciclos_segundos: 10,
        descanso_entre_tecnicas_segundos: 20
    }, 'a@example.test', t, notes, '2026-09-01T12:00:00Z');
    const next: AdditionTechniques = structuredClone(t);
    next.additionRevision = 1;
    next.deletionCatalog = catalogOf(t);
    return {t, notes, plan, next};
}

const technique = () => ({id: crypto.randomUUID(), tipo: 'Added', descripcion_del_alumno: 'New text'});
const future = (p: TrainingPlan, today: string) => p.sessions.filter(s => s.date > today).flatMap(s => s.exercises);

function check(before: TrainingPlan, after: TrainingPlan, today: string) {
    assert.equal(after.structuralUpdateError, undefined);
    assert.deepEqual(after.sessions.filter(s => s.date <= today), before.sessions.filter(s => s.date <= today));
    assert.deepEqual(after.sessions.map(s => s.date), before.sessions.map(s => s.date));
    assert.deepEqual(tabata(after), tabata(before));
    assert.ok(after.sessions.every(s => s.exercises.length === before.ejercicios_por_sesion));
}

test('Appended technique joins unfinished position immediately after the existing ordered remainder, with exact protected history', () => {
    const {t, notes, plan, next} = sample(), added = technique();
    next.positions[0].tecnicas.push(added);
    const before = structuredClone(plan), updated = updateFutureStructure(plan, next, notes, '2026-10-01');
    check(plan, updated, '2026-10-01');
    assert.deepEqual(future(updated, '2026-10-01').slice(0, 3).map(e => e.techniqueId), [t.positions[0].tecnicas[2].id, added.id, t.positions[1].tecnicas[0].id]);
    assert.equal(future(updated, '2026-10-01')[1].pass, 1);
    assert.equal(future(updated, '2026-10-01')[1].positionComplete, true);
    assert.deepEqual(plan, before);
    assert.equal(updateFutureStructure(updated, next, notes, '2026-10-01'), updated);
});
test('A completed position waits for its next circular appearance; no rewind or artificial repetition', () => {
    const {notes, plan, next} = sample(), added = technique();
    next.positions[0].tecnicas.push(added);
    const updated = updateFutureStructure(plan, next, notes, '2026-10-02');
    check(plan, updated, '2026-10-02');
    const occurrences = future(updated, '2026-10-02').filter(e => e.techniqueId === added.id);
    assert.ok(occurrences.length);
    assert.equal(occurrences[0].pass, 2);
    assert.equal(future(updated, '2026-10-02')[0].techniqueId, next.positions[1].tecnicas[1].id);
});
test('Insertion before the consumed technique waits until next pass; insertion after cursor enters the current pass in array order', () => {
    for (const index of [0, 2]) {
        const {notes, plan, next} = sample(), added = technique();
        next.positions[0].tecnicas.splice(index, 0, added);
        const updated = updateFutureStructure(plan, next, notes, '2026-10-01');
        check(plan, updated, '2026-10-01');
        assert.equal(future(updated, '2026-10-01').find(e => e.techniqueId === added.id)!.pass, index === 0 ? 2 : 1);
        if (index === 2) assert.equal(future(updated, '2026-10-01')[0].techniqueId, added.id);
    }
});
test('New nonempty positions before/after the consumed cursor preserve current occurrence and include new priorities at circular boundaries', () => {
    for (const [index, priority, expectedPass] of [[0, 1, 2], [2, 1, 1], [6, 4, 1]] as const) {
        const {notes, plan, next} = sample(), added = technique();
        next.positions.splice(index, 0, {
            id: crypto.randomUUID(),
            posicion: 'New position',
            prioridad: priority,
            tecnicas: [added]
        });
        const updated = updateFutureStructure(plan, next, notes, '2026-10-01');
        check(plan, updated, '2026-10-01');
        const entry = future(updated, '2026-10-01').find(e => e.techniqueId === added.id);
        assert.ok(entry);
        assert.equal(entry.pass, expectedPass);
        assert.equal(entry.prioridad, priority);
        const appearances = future(updated, '2026-10-01').filter((e, i, a) => !i || e.pass !== a[i - 1].pass || e.prioridad !== a[i - 1].prioridad).map(e => e.prioridad);
        assert.deepEqual(appearances.slice(0, 7), priority === 4 ? [1, 2, 1, 3, 2, 4, 3] : [1, 2, 1, 3, 2, 1, 3]);
    }
});
test('Empty positions are ignored, then first technique activates their addition; no training dates are invented to fit content', () => {
    const {t, notes, plan, next} = sample(), empty = {
        id: crypto.randomUUID(),
        posicion: 'Empty',
        prioridad: 8,
        tecnicas: [] as ReturnType<typeof technique>[]
    };
    next.positions.push(empty);
    delete next.additionRevision;
    assert.equal(hasTrainableAdditions(t, next), false);
    assert.equal(updateFutureStructure(plan, next, notes, '2026-10-01'), plan);
    empty.tecnicas.push(technique());
    assert.equal(hasTrainableAdditions(t, next), true);
    const short = {
        ...plan,
        sessions: plan.sessions.slice(0, 1),
        continuity: {...plan.continuity!, boundaries: plan.continuity!.boundaries.slice(0, 1)}
    };
    next.additionRevision = 1;
    assert.equal(updateFutureStructure(short, next, notes, '2026-10-01'), short);
});
test('Before first session, additions produce exactly the original generator using the new catalogue; today and ended plans are protected', () => {
    const {notes, plan, next} = sample();
    next.positions[0].tecnicas.push(technique());
    const updated = updateFutureStructure(plan, next, notes, '2026-09-30'),
        oracle = generatePlan(plan, plan.mail, next, notes, plan.generatedAt);
    check(plan, updated, '2026-09-30');
    assert.deepEqual(updated.sessions, oracle.sessions);
    assert.deepEqual(updated.continuity, oracle.continuity);
    assert.equal(updateFutureStructure(plan, next, notes, plan.fecha_torneo), plan);
});
test('Successive additions after advancing the Madrid protected boundary are idempotent and retain the exact existing past', () => {
    const {notes, plan, next} = sample();
    next.positions[0].tecnicas.push(technique());
    const first = updateFutureStructure(plan, next, notes, '2026-10-01');
    next.positions[1].tecnicas.push(technique());
    next.additionRevision = 2;
    const second = updateFutureStructure(first, next, notes, '2026-10-04');
    check(first, second, '2026-10-04');
    assert.equal(updateFutureStructure(second, next, notes, '2026-10-04'), second);
});
test('Legacy reconstruction requires a matching server-owned pre-change catalogue; corrupt continuity preserves the entire plan and reports failure', () => {
    const {notes, plan, next} = sample();
    next.positions[0].tecnicas.push(technique());
    const legacy = structuredClone(plan);
    delete legacy.continuity;
    check(legacy, updateFutureStructure(legacy, next, notes, '2026-10-01'), '2026-10-01');
    for (const bad of [structuredClone(plan), structuredClone(legacy)]) {
        if (bad.continuity) bad.continuity.boundaries[0].cursor.move = 'forward'; else bad.sessions[0].exercises.reverse();
        const result = updateFutureStructure(bad, next, notes, '2026-10-01');
        assert.ok(result.structuralUpdateError);
        assert.deepEqual(result.sessions, bad.sessions);
    }
});

test('A combined replacement with a genuinely new priority retains history and adopts the new ring without looping', () => {
    const {t, notes, plan, next} = sample(), added = technique();
    next.positions = [{id: crypto.randomUUID(), posicion: 'Replacement', prioridad: 9, tecnicas: [added]}];
    next.deletedIds = t.positions.flatMap(p => [p.id, ...p.tecnicas.map(t => t.id)]);
    next.deletionRevision = 1;
    const updated = updateFutureStructure(plan, next, notes, '2026-10-01');
    check(plan, updated, '2026-10-01');
    assert.ok(future(updated, '2026-10-01').every(e => e.techniqueId === added.id && e.prioridad === 9));
    assert.equal(updateFutureStructure(updated, next, notes, '2026-10-01'), updated);
});
