import {test} from "node:test";
import assert from "node:assert/strict";
import {
    madridDate,
    updateFuturePlanText,
    projectFutureDescriptions,
} from "../src/domain/plan-text-updates.ts";
import {cloneTemplate, initialVersion} from "../src/domain/models.ts";
import {generatePlan, tabata} from "../src/domain/planner.ts";
import {template} from "./template-fixture.ts";

function sample() {
    const t = cloneTemplate(template);
    const notes = {
        ...initialVersion(),
        comments: [] as { techniqueId: string; comment: string }[],
        commentUpdates: {} as Record<string, string>,
    };
    const plan = generatePlan(
        {
            planId: crypto.randomUUID(),
            alumnos: ["test@example.com"],
            fecha_comienzo: "2026-10-08",
            fecha_torneo: "2026-12-13",
            dias_de_entrenamiento: [2, 4],
            ejercicios_por_sesion: 5,
            tiempo_por_tecnica_segundos: 180,
            descanso_entre_ciclos_segundos: 10,
            descanso_entre_tecnicas_segundos: 20,
        },
        "test@example.com",
        t,
        notes,
        "2026-10-01T00:00:00Z",
    );
    return {t, notes, plan};
}

test("Madrid date handles UTC midnight, summer time and winter time", () => {
    assert.equal(madridDate("2026-10-13T22:01:00Z"), "2026-10-14");
    assert.equal(madridDate("2026-12-13T22:30:00Z"), "2026-12-13");
    assert.equal(madridDate("2026-12-13T23:01:00Z"), "2026-12-14");
});
test("All future occurrences refresh both text fields; historical and today snapshots are exact", () => {
    const {t, notes, plan} = sample();
    const before = structuredClone(plan),
        id = t.positions[0].tecnicas[0].id;
    t.positions[0].tecnicas[0].descripcion_del_alumno = "Nueva salida";
    t.descriptionUpdates = {[id]: "d1"};
    notes.comments = [{techniqueId: id, comment: "Comentario nuevo"}];
    notes.commentUpdates = {[id]: "c1"};
    const next = updateFuturePlanText(plan, t, notes, "2026-10-13");
    let occurrences = 0;
    for (let i = 0; i < plan.sessions.length; i++) {
        const session = next.sessions[i];
        if (session.date <= "2026-10-13")
            assert.deepEqual(session, before.sessions[i]);
        else
            for (let j = 0; j < session.exercises.length; j++) {
                const e = session.exercises[j],
                    previous = before.sessions[i].exercises[j];
                if (e.techniqueId === id) {
                    occurrences++;
                    assert.equal(e.descripcion_del_alumno, "Nueva salida");
                    assert.equal(e.comment, "Comentario nuevo");
                } else assert.deepEqual(e, previous);
                assert.deepEqual(
                    {
                        ...e,
                        descripcion_del_alumno: previous.descripcion_del_alumno,
                        comment: previous.comment,
                    },
                    previous,
                );
            }
    }
    assert.ok(occurrences > 1);
    assert.deepEqual(plan, before);
    assert.deepEqual(tabata(next), tabata(plan));
    assert.equal(updateFuturePlanText(next, t, notes, "2026-10-13"), next);
});
test("Finished competition today or before today is untouched including checkpoints", () => {
    const {t, notes, plan} = sample();
    t.descriptionUpdates = {[t.positions[0].tecnicas[0].id]: "d"};
    assert.equal(updateFuturePlanText(plan, t, notes, "2026-12-13"), plan);
    assert.equal(updateFuturePlanText(plan, t, notes, "2026-12-14"), plan);
});
test("Removing a comment clears future text only; no repeat overrides later manual edits", () => {
    const {t, notes, plan} = sample(),
        id = t.positions[0].tecnicas[0].id;
    for (const s of plan.sessions)
        for (const e of s.exercises)
            if (e.techniqueId === id) e.comment = "Anterior";
    notes.commentUpdates = {[id]: "clear"};
    const next = updateFuturePlanText(plan, t, notes, "2026-10-13");
    assert.equal(next.sessions[0].exercises[0].comment, "Anterior");
    const e = next.sessions
        .flatMap((s) => (s.date > "2026-10-13" ? s.exercises : []))
        .find((e) => e.techniqueId === id)!;
    assert.equal(e.comment, "");
    e.comment = "Manual posterior";
    assert.equal(updateFuturePlanText(next, t, notes, "2026-10-13"), next);
});
test("Adding, deleting, reprioritizing and reordering never implicitly regenerates sessions", () => {
    const {t, notes, plan} = sample();
    const changed = structuredClone(t);
    changed.positions.reverse();
    changed.positions[0].prioridad = 99;
    changed.positions[0].tecnicas.push({
        id: crypto.randomUUID(),
        tipo: "Nueva",
        descripcion_del_alumno: "",
    });
    changed.positions.pop();
    assert.equal(updateFuturePlanText(plan, changed, notes, "2026-10-13"), plan);
    assert.equal(projectFutureDescriptions(plan, t, changed, "2026-10-13"), plan);
});
test("Offline projection preserves source checkpoints, times and protected sessions", () => {
    const {t, plan} = sample(),
        incoming = structuredClone(t);
    incoming.positions[0].tecnicas[0].descripcion_del_alumno = "Offline";
    const next = projectFutureDescriptions(plan, t, incoming, "2026-10-13");
    assert.deepEqual(next.sessions.slice(0, 2), plan.sessions.slice(0, 2));
    assert.equal(next.appliedDescriptionUpdates, plan.appliedDescriptionUpdates);
    assert.ok(
        next.sessions.some(
            (s) =>
                s.date > "2026-10-13" &&
                s.exercises.some((e) => e.descripcion_del_alumno === "Offline"),
        ),
    );
    assert.deepEqual(tabata(next), tabata(plan));
});

test("Matching technique on today's session keeps both old text fields", () => {
    const {t, notes, plan} = sample();
    const id = plan.sessions[1].exercises[0].techniqueId;
    t.positions
        .flatMap((p) => p.tecnicas)
        .find((t) => t.id === id)!.descripcion_del_alumno = "Cambio hoy";
    t.descriptionUpdates = {[id]: "description"};
    notes.comments = [{techniqueId: id, comment: "Cambio comentario hoy"}];
    notes.commentUpdates = {[id]: "comment"};
    const next = updateFuturePlanText(plan, t, notes, plan.sessions[1].date);
    assert.deepEqual(next.sessions[1], plan.sessions[1]);
    assert.ok(
        next.sessions.some(
            (s) =>
                s.date > plan.sessions[1].date &&
                s.exercises.some(
                    (e) =>
                        e.techniqueId === id &&
                        e.descripcion_del_alumno === "Cambio hoy" &&
                        e.comment === "Cambio comentario hoy",
                ),
        ),
    );
});
