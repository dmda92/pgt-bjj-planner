import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodePlan, decodePlan, nativeBlockBytes, PLAN_BLOCK_BYTES } from '../src/infrastructure/plan-codec.ts';
import { generatePlan } from '../src/domain/planner.ts';
import { cloneTemplate, initialVersion, type TrainingPlan, type Competition } from '../src/domain/models.ts';
import { template } from './template-fixture.ts';
const baseline = JSON.parse(readFileSync(new URL('./fixtures/firestore/domain-baseline.json', import.meta.url), 'utf8')) as {
    fixtures: {
        name: string;
        expected: {
            generated: TrainingPlan;
            result?: TrainingPlan;
        };
    }[];
};
for (const fixture of baseline.fixtures)
    test('V2 native codec preserves frozen plan: ' + fixture.name, () => {
        for (const plan of [fixture.expected.generated, ...(fixture.expected.result ? [fixture.expected.result] : [])]) {
            const before = structuredClone(plan), encoded = encodePlan(plan);
            assert.deepEqual(decodePlan(encoded), plan);
            assert.deepEqual(plan, before);
            assert.ok(nativeBlockBytes(encoded.head) <= PLAN_BLOCK_BYTES);
            for (const block of Object.values(encoded.blocks))
                assert.ok(nativeBlockBytes(block) <= PLAN_BLOCK_BYTES);
            if (plan.sessions.length)
                assert.deepEqual(decodePlan(encoded, plan.sessions[0].date).sessions, [plan.sessions[0]]);
        }
    });
const scenario = () => {
    const techniques = cloneTemplate(template);
    const competition: Competition = { planId: crypto.randomUUID(), alumnos: ['codec@example.test'], fecha_comienzo: '2026-01-01',
        fecha_torneo: '2026-07-02', dias_de_entrenamiento: [1, 2, 3, 4, 5, 6, 7], ejercicios_por_sesion: 5,
        tiempo_por_tecnica_segundos: 180, descanso_entre_ciclos_segundos: 10, descanso_entre_tecnicas_segundos: 20 };
    return { techniques, competition };
};
test('One date requires only its month distribution, not 182 session documents', () => {
    const { techniques, competition } = scenario(), plan = generatePlan(competition, 'codec@example.test', techniques, { ...initialVersion(), comments: [] }, '2026-01-01T00:00:00Z'), encoded = encodePlan(plan);
    const sessionBlocks = Object.values(encoded.blocks).filter(b => b.kind === 'sessions');
    assert.equal(sessionBlocks.length, 7);
    const date = '2026-03-20', needed = new Set(encoded.head.calendar.filter(s => s.date === date).map(s => s.block));
    const partial = { ...encoded, blocks: Object.fromEntries(Object.entries(encoded.blocks).filter(([id, b]) => b.kind !== 'sessions' || needed.has(id))) };
    assert.deepEqual(decodePlan(partial, date).sessions, plan.sessions.filter(s => s.date === date));
    assert.throws(() => decodePlan(partial), /INTEGRITY/);
});
test('Long descriptions and comments are deduplicated without truncation or oversized physical documents', () => {
    const { techniques, competition } = scenario();
    techniques.positions[0].tecnicas[0].descripcion_del_alumno = 'á'.repeat(100000);
    competition.fecha_torneo = '2026-01-04';
    const comments = { ...initialVersion(), comments: [{ techniqueId: techniques.positions[0].tecnicas[0].id, comment: 'ñ'.repeat(100000) }] };
    const plan = generatePlan(competition, 'codec@example.test', techniques, comments, '2026-01-01T00:00:00Z');
    const encoded = encodePlan(plan);
    assert.deepEqual(decodePlan(encoded), plan);
    for (const block of Object.values(encoded.blocks))
        assert.ok(nativeBlockBytes(block) <= PLAN_BLOCK_BYTES);
});
test('Corrupt legacy continuity is preserved, never silently repaired', () => {
    const plan = structuredClone(baseline.fixtures[0].expected.generated);
    plan.continuity!.boundaries[0].signature = 'legacy-corrupt';
    plan.continuity!.boundaries[0].stateSignature = 'invalid';
    assert.deepEqual(decodePlan(encodePlan(plan)), plan);
    plan.continuity!.boundaries.pop();
    assert.deepEqual(decodePlan(encodePlan(plan)), plan);
});
test('Missing and altered blocks fail closed; no empty-plan recovery', () => {
    const encoded = encodePlan(baseline.fixtures[0].expected.generated), id = encoded.head.calendar[0].block;
    const altered = structuredClone(encoded);
    delete altered.blocks[id];
    assert.throws(() => decodePlan(altered), /INTEGRITY/);
    altered.blocks[id] = structuredClone(encoded.blocks[id]);
    const b = altered.blocks[id];
    if (b.kind === 'sessions')
        b.rows = [];
    assert.throws(() => decodePlan(altered), /INTEGRITY/);
});
test('Physical compaction never authorizes a logical plan larger than 4 MiB', () => {
    const { techniques, competition } = scenario();
    for (const position of techniques.positions)
        for (const t of position.tecnicas)
            t.descripcion_del_alumno = 'x'.repeat(10000);
    const plan = generatePlan(competition, 'codec@example.test', techniques, { ...initialVersion(), comments: [] }, '2026-01-01T00:00:00Z');
    assert.throws(() => encodePlan(plan), /LOGICAL_SIZE_LIMIT/);
});
