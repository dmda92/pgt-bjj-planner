import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { indexPlanText, projectPlanText, materializePlanText, updateProjectionMetadata, ProjectedPlanTooLarge } from '../src/infrastructure/plan-text-projection.ts';
import { updateFuturePlanText } from '../src/domain/plan-text-updates.ts';
import { updateFuturePlanLabels } from '../src/domain/plan-labels.ts';
import { jsonBytes } from '../src/domain/json-limits.ts';
import { generatePlan } from '../src/domain/planner.ts';
import { cloneTemplate, initialVersion, type TrainingPlan, type Techniques, type Comments, type Competition } from '../src/domain/models.ts';
import { template } from './template-fixture.ts';
const baseline = JSON.parse(readFileSync(new URL('./fixtures/firestore/domain-baseline.json', import.meta.url), 'utf8')) as {
    fixtures: {
        name: string;
        input: {
            techniques: Techniques;
            comments: Comments;
        };
        change: null | {
            techniques: Techniques;
            comments: Comments;
            today: string;
        };
        expected: {
            generated: TrainingPlan;
            result?: TrainingPlan;
        };
    }[];
};
for (const f of baseline.fixtures)
    test('V2 text index matches existing text/label semantics: ' + f.name, () => {
        const t = f.change?.techniques ?? f.input.techniques, c = f.change?.comments ?? f.input.comments, today = f.change?.today ?? '2026-10-01';
        for (const base of [f.expected.generated, ...(f.expected.result ? [f.expected.result] : [])]) {
            const before = structuredClone(base), index = indexPlanText(base);
            const projected = projectPlanText(index, t, c, today), expected = updateFuturePlanLabels(updateFuturePlanText(base, t, c, today), t, today);
            assert.deepEqual(materializePlanText(base, projected), expected);
            assert.equal(projected.logicalBytes, jsonBytes(expected));
            assert.deepEqual(base, before);
            assert.deepEqual(projectPlanText(projected, t, c, today), projected);
        }
    });
function scenario() {
    const t = cloneTemplate(template), c: Competition = { planId: crypto.randomUUID(), alumnos: ['timeline@example.test'], fecha_comienzo: '2026-10-01', fecha_torneo: '2026-11-01',
        dias_de_entrenamiento: [1, 2, 3, 4, 5, 6, 7], ejercicios_por_sesion: 5, tiempo_por_tecnica_segundos: 180, descanso_entre_ciclos_segundos: 10, descanso_entre_tecnicas_segundos: 20 };
    const notes: Comments = { ...initialVersion(), comments: [] };
    return { t, notes, base: generatePlan(c, c.alumnos[0], t, notes, '2026-10-01T00:00:00Z') };
}
test('Edits before the first session retain only the text version that a session can observe', () => {
    const { t, notes, base } = scenario();
    const id = t.positions[0].tecnicas[0].id;
    let index = indexPlanText(base), expected = base;
    for (let day = 1; day <= 14; day++) {
        const today = '2026-09-' + String(day).padStart(2, '0');
        t.positions[0].tecnicas[0].descripcion_del_alumno = 'Text ' + day;
        t.descriptionUpdates = { [id]: String(day) };
        expected = updateFuturePlanText(expected, t, notes, today);
        index = projectPlanText(index, t, notes, today);
    }
    assert.deepEqual(materializePlanText(base, index), expected);
    assert.equal(index.patches.filter(p => p.techniqueId === id).length, 1);
    assert.equal(index.logicalBytes, jsonBytes(expected));
});
test('Successive days and same-day saves retain historical text without a midnight database write', () => {
    const { t, notes, base } = scenario(), id = t.positions[0].tecnicas[0].id;
    let expected = base, index = indexPlanText(base);
    for (const [day, text, version] of [['2026-10-02', 'First', 'v1'], ['2026-10-02', 'Replacement', 'v2'], ['2026-10-10', 'Third', 'v3']]) {
        t.positions[0].tecnicas[0].descripcion_del_alumno = text;
        t.descriptionUpdates = { [id]: version };
        expected = updateFuturePlanText(expected, t, notes, day);
        index = projectPlanText(index, t, notes, day);
        assert.deepEqual(materializePlanText(base, index), expected);
        assert.equal(index.logicalBytes, jsonBytes(expected));
    }
    assert.equal(index.patches.filter(p => p.from === '2026-10-03').length, 1);
    assert.deepEqual(materializePlanText(base, index).sessions.filter(s => s.date <= '2026-10-02'), base.sessions.filter(s => s.date <= '2026-10-02'));
});
test('Escaping, Unicode, repeated occurrences and metadata use exact UTF-8 logical byte deltas', () => {
    const { t, notes, base } = scenario(), id = t.positions[0].tecnicas[0].id;
    t.descriptionUpdates = { [id]: 'version' };
    t.positions[0].tecnicas[0].descripcion_del_alumno = 'á\n"\\😀';
    notes.comments = [{ techniqueId: id, comment: 'another\n"é' }];
    notes.commentUpdates = { [id]: 'note' };
    const index = updateProjectionMetadata(projectPlanText(indexPlanText(base), t, notes, '2026-10-02'), { revision: 9, updatedAt: '2026-10-03T00:00:00Z' });
    assert.equal(index.logicalBytes, jsonBytes(materializePlanText(base, index)));
});
test('Oversized virtual output rejects the projection without changing the last valid plan or source', () => {
    const { t, notes, base } = scenario(), index = indexPlanText(base);
    for (const p of t.positions)
        for (const e of p.tecnicas) {
            e.descripcion_del_alumno = 'x'.repeat(100000);
            (t.descriptionUpdates ??= {})[e.id] = 'new';
        }
    const before = structuredClone(index);
    assert.throws(() => projectPlanText(index, t, notes, '2026-10-01'), ProjectedPlanTooLarge);
    assert.deepEqual(index, before);
    assert.deepEqual(materializePlanText(base, index), base);
});
test('Ended and structurally blocked plans do not adopt newer text or labels', () => {
    const { t, notes, base } = scenario();
    t.positions[0].posicion = 'New';
    t.descriptionUpdates = { [t.positions[0].tecnicas[0].id]: 'new' };
    const ended = indexPlanText(base);
    assert.equal(projectPlanText(ended, t, notes, '2026-11-01'), ended);
    base.structuralUpdateError = 'Original diagnostic';
    const blocked = indexPlanText(base);
    assert.equal(projectPlanText(blocked, t, notes, '2026-10-01'), blocked);
});

test('Text projection cannot be applied to a different generation with the same owner and competition', () => {
    const {base}=scenario(),index=indexPlanText(base),other=structuredClone(base);
    other.sessions[0].exercises[0].tipo='Different generation';
    assert.throws(()=>materializePlanText(other,index),/BASE_REVISION_MISMATCH/);
});
