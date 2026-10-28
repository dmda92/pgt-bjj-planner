import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMonthlyAgenda, queryMonthlyAgenda } from '../src/infrastructure/trainer-agenda.ts';
import { nativeBlockBytes, storeNativeNode, readNativeNode, type PackedBlocks } from '../src/infrastructure/native-packing.ts';
import { structureIndex, trainingDay } from '../src/domain/trainer-reports.ts';
import { generatePlan } from '../src/domain/planner.ts';
import { cloneTemplate, initialVersion, type TrainingPlan, type Competition } from '../src/domain/models.ts';
import { template } from './template-fixture.ts';
function plan(owner = 'agenda@example.test'): TrainingPlan {
    const c: Competition = { planId: crypto.randomUUID(), alumnos: [owner], fecha_comienzo: '2026-01-01', fecha_torneo: '2026-07-02',
        dias_de_entrenamiento: [1, 2, 3, 4, 5, 6, 7], ejercicios_por_sesion: 5, tiempo_por_tecnica_segundos: 180,
        descanso_entre_ciclos_segundos: 10, descanso_entre_tecnicas_segundos: 20 };
    return generatePlan(c, owner, cloneTemplate(template), { ...initialVersion(), comments: [] }, '2026-01-01T00:00:00Z');
}
for (const size of [10, 30, 100])
    test('Shared agenda matches original grouping for ' + size + ' participants', () => {
        const base = plan(), plans = Array.from({ length: size }, (_, i) => ({ ...structuredClone(base), mail: 'member' + i + '@example.test', alumnos: ['member' + i + '@example.test'] }));
        const names = new Map(plans.map(p => [p.mail, p.mail]));
        const agenda = buildMonthlyAgenda(plans, '2026-02');
        const expected = trainingDay(plans.map(p => ({ index: structureIndex(p, 'synthetic'), name: names.get(p.mail)! })), '2026-02-10', '2026-01-31');
        assert.deepEqual(queryMonthlyAgenda(agenda, '2026-02-10', '2026-01-31', names), expected);
        assert.ok(nativeBlockBytes(agenda) < 512 * 1024);
        assert.ok(!JSON.stringify(agenda).includes('descripcion_del_alumno'));
    });
test('Text changes do not alter the month, while future labels alter grouping', () => {
    const p = plan(), before = buildMonthlyAgenda([p], '2026-02');
    for (const s of p.sessions)
        for (const e of s.exercises) {
            e.descripcion_del_alumno = 'Changed';
            e.comment = 'Changed';
        }
    assert.deepEqual(buildMonthlyAgenda([p], '2026-02'), before);
    p.sessions.find(s => s.date === '2026-02-10')!.exercises[0].tipo = 'Renamed';
    assert.notDeepEqual(buildMonthlyAgenda([p], '2026-02'), before);
});
test('Multiple competitions preserve vote multiplicity and unique students, including arbitrary historical dates', () => {
    const a = plan(), b = structuredClone(a);
    b.planId = crypto.randomUUID();
    b.structuralUpdateError = 'Existing issue';
    b.sessions.find(s => s.date === '2026-02-10')!.exercises.reverse();
    const names = new Map([[a.mail, 'Current Name']]), agenda = buildMonthlyAgenda([a, b], '2026-02');
    const expected = trainingDay([a, b].map(p => ({ index: structureIndex(p, 'synthetic'), name: 'Current Name' })), '2026-02-10', '2027-01-01');
    assert.deepEqual(queryMonthlyAgenda(agenda, '2026-02-10', '2027-01-01', names), expected);
    assert.equal(queryMonthlyAgenda(agenda, '2026-02-10', '2027-01-01', names).groups[0].students.length, 1);
});
test('Default date is strictly future, missing plans remain visible, and other months require explicit loading', () => {
    const p = plan(), names = new Map([[p.mail, 'Name']]), agenda = buildMonthlyAgenda([p], '2026-02', [{ owner: 'pending@example.test', planId: crypto.randomUUID(), start: '2026-01-01', end: '2026-07-02' }]);
    assert.equal(queryMonthlyAgenda(agenda, '', '2026-01-31', names).date, '2026-02-01');
    assert.equal(queryMonthlyAgenda(agenda, '', '2026-01-31', names).missing, 1);
    assert.throws(() => queryMonthlyAgenda(agenda, '', '2026-02-28', names), /MONTH_NOT_LOADED/);
});
test('Distinct labels remain native and can be split without losing votes or calendars', () => {
    const base = plan(), plans = Array.from({ length: 100 }, (_, i) => {
        const p = structuredClone(base);
        p.mail = 'different' + i + '@example.test';
        p.alumnos = [p.mail];
        for (const s of p.sessions)
            for (const e of s.exercises) {
                e.tipo += ' ' + i;
                e.posicion += ' ' + i;
            }
        return p;
    }), agenda = buildMonthlyAgenda(plans, '2026-02'), blocks: PackedBlocks = {}, node = storeNativeNode(agenda, blocks);
    assert.deepEqual(readNativeNode(node, blocks), agenda);
});
