import {test} from "node:test";
import assert from "node:assert/strict";
import {planCoverage} from "../src/domain/coverage.ts";
import {generatePlan} from "../src/domain/planner.ts";
import {
    cloneTemplate,
    initialVersion,
    type Competition,
} from "../src/domain/models.ts";
import {template} from "./template-fixture.ts";

const competition: Competition = {
    planId: crypto.randomUUID(),
    fecha_comienzo: "2026-10-08",
    fecha_torneo: "2026-12-13",
    alumnos: ["fixture@example.com"],
    dias_de_entrenamiento: [2, 4],
    ejercicios_por_sesion: 5,
    tiempo_por_tecnica_segundos: 180,
    descanso_entre_ciclos_segundos: 10,
    descanso_entre_tecnicas_segundos: 20,
};
const makePlan = () =>
    generatePlan(
        competition,
        competition.alumnos[0],
        cloneTemplate(template),
        {...initialVersion(), comments: []},
        "2026-10-01T00:00:00Z",
    );
test("Coverage date boundaries, empty date, and snapshot immutability", () => {
    const plan = makePlan(),
        original = JSON.stringify(plan);
    assert.equal(planCoverage(plan, "2026-10-07").exercises, 0);
    assert.equal(planCoverage(plan, "2026-10-08", false).sessions, 0);
    assert.equal(planCoverage(plan, "2026-10-08").exercises, 5);
    assert.equal(planCoverage(plan, "").sessions, 0);
    assert.equal(planCoverage(plan, "2099-01-01").sessions, plan.sessions.length);
    assert.equal(JSON.stringify(plan), original);
});
test("Coverage counts identities, first dates and repetitions independently", () => {
    const plan = makePlan(),
        report = planCoverage(plan, "2099-01-01");
    const all = plan.sessions.flatMap((s) => s.exercises);
    assert.equal(report.unique, new Set(all.map((e) => e.techniqueId)).size);
    assert.equal(report.exercises, all.length);
    for (const p of report.positions)
        for (const t of p.techniques) {
            assert.equal(t.count, all.filter((e) => e.techniqueId === t.id).length);
            assert.equal(
                t.first,
                plan.sessions.find((s) =>
                    s.exercises.some((e) => e.techniqueId === t.id),
                )!.date,
            );
        }
});
test("Split positions retain partial passes and never count a later marker before earlier exercises", () => {
    const plan = makePlan(),
        sample = plan.sessions[0].exercises[0];
    plan.sessions = [
        {
            date: "2026-10-08",
            exercises: [
                {...sample, techniqueId: "a", pass: 1, positionComplete: false},
            ],
        },
        {
            date: "2026-10-13",
            exercises: [
                {...sample, techniqueId: "b", pass: 1, positionComplete: true},
            ],
        },
        {
            date: "2026-10-15",
            exercises: [
                {...sample, techniqueId: "a", pass: 2, positionComplete: false},
            ],
        },
    ];
    let p = planCoverage(plan, "2026-10-08").positions[0];
    assert.equal(p.complete, 0);
    assert.equal(p.partial, true);
    p = planCoverage(plan, "2026-10-13").positions[0];
    assert.equal(p.complete, 1);
    assert.equal(p.partial, false);
    p = planCoverage(plan, "2026-10-15").positions[0];
    assert.equal(p.complete, 1);
    assert.equal(p.partial, true);
    plan.sessions[0].date = "2026-10-20";
    assert.equal(planCoverage(plan, "2026-10-13").positions[0].complete, 0);
});
test("Zero sessions produces no invented catalogue or percentages", () => {
    assert.deepEqual(
        planCoverage({...makePlan(), sessions: []}, "2099-01-01"),
        {positions: [], total: 0, unique: 0, sessions: 0, exercises: 0},
    );
});
