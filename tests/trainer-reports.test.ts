import {test} from 'node:test';
import assert from 'node:assert/strict';
import {preparation, structureIndex, trainingDay, listedCompetitions} from '../src/domain/trainer-reports.ts';
import type {TrainingPlan, Techniques, Exercise} from '../src/domain/models.ts';

const exercise = (id: string, position = 'Guardia cerrada', type = 'Sumisión 1'): Exercise => ({
    positionId: 'p',
    techniqueId: id,
    posicion: position,
    tipo: type,
    prioridad: 1,
    descripcion_del_alumno: 'antigua',
    comment: 'privado',
    pass: 1,
    positionComplete: false
});
const plan = (mail: string, ex: Exercise[], day = '2026-10-19') => ({
    planId: mail,
    mail,
    sessions: [{date: day, exercises: ex}]
} as TrainingPlan);
test('Preparation counts unique techniques, current descriptions, removed UUIDs, zero priorities and extra repetitions', () => {
    const source = {
        positions: [{
            posicion: 'Guardia cerrada',
            prioridad: 1,
            tecnicas: [{id: 'a', tipo: 'Sumisión 1', descripcion_del_alumno: 'texto'}, {
                id: 'b',
                tipo: 'Sumisión 2',
                descripcion_del_alumno: '  '
            }]
        }, {posicion: 'Araña', prioridad: 2, tecnicas: [{id: 'c', tipo: 'Raspada', descripcion_del_alumno: 'x'}]}]
    } as Techniques;
    const p = plan('a', [exercise('a'), exercise('a'), exercise('b'), exercise('removed')]), before = JSON.stringify(p);
    const r = preparation(p, source);
    assert.equal(r.planned, 3);
    assert.equal(r.described, 1);
    assert.equal(r.covered, 2);
    assert.equal(r.total, 3);
    assert.equal(r.rows[0].percent, 100);
    assert.equal(r.rows[0].repeats, 1);
    assert.equal(r.rows[1].percent, 0);
    assert.equal(r.rows[0].removed, 1);
    assert.equal(JSON.stringify(p), before);
});
test('Daily equivalence ignores UUIDs/text/order/priority, preserves multiplicity and chooses most frequent order', () => {
    const a = exercise('a'), b = exercise('b', 'Guardia araña', 'Raspada');
    const indexes = [{
        index: structureIndex(plan('1', [a, b]), '1'),
        name: 'Uno'
    }, {index: structureIndex(plan('2', [b, a]), '2'), name: 'Dos'}, {
        index: structureIndex(plan('3', [b, {
            ...a,
            prioridad: 2,
            descripcion_del_alumno: 'otro'
        }]), '3'), name: 'Tres'
    }, {index: structureIndex(plan('4', [a, a, b]), '4'), name: 'Cuatro'}];
    const r = trainingDay(indexes, '', '2026-10-17');
    assert.equal(r.date, '2026-10-19');
    assert.equal(r.groups.length, 2);
    assert.equal(r.groups[0].students.length, 3);
    assert.deepEqual(r.groups[0].exercises, [[b.posicion, b.tipo], [a.posicion, a.tipo]]);
    assert.equal(r.groups[1].students.length, 1);
    assert.equal(JSON.stringify(r).includes('privado'), false);
    assert.deepEqual(trainingDay(indexes.slice().reverse(), '', '2026-10-17'), r);
    const tied = [{
        index: structureIndex(plan('x', [exercise('1', 'Café')]), 'x'),
        name: 'X'
    }, {index: structureIndex(plan('y', [exercise('2', 'Café')]), 'y'), name: 'Y'}];
    assert.deepEqual(trainingDay(tied, '', '2026-10-17'), trainingDay(tied.slice().reverse(), '', '2026-10-17'));
});
test('Daily next date is strictly future, arbitrary dates can be empty, duplicated membership counts once', () => {
    const index = structureIndex(plan('one', [exercise('a')], '2026-10-17'), 'sha');
    const r = trainingDay([{index, name: 'Uno'}, {
        index: {...index, planId: 'second'},
        name: 'Uno'
    }], '2026-10-17', '2026-10-17');
    assert.equal(r.groups[0].students.length, 1);
    assert.equal(r.groups[0].competitions.length, 2);
    assert.equal(r.nextDate, '');
    assert.equal(trainingDay([{index, name: 'Uno'}], '2026-10-18', '2026-10-17').groups.length, 0);
});
test('Competition filter includes today, hides strictly past and sorts dates without mutating source', () => {
    const plans = [{planId: 'b', fecha_torneo: '2026-10-20'}, {planId: 'a', fecha_torneo: '2026-10-15'}, {
        planId: 'c',
        fecha_torneo: '2026-10-16'
    }] as any;
    assert.deepEqual(listedCompetitions(plans, '2026-10-16').map(c => c.planId), ['c', 'b']);
    assert.deepEqual(listedCompetitions(plans, '2026-10-16', true).map(c => c.planId), ['a', 'c', 'b']);
    assert.equal(plans[0].planId, 'b');
});
