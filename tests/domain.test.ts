import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cloneTemplate,
  initialVersion,
  validateTechniques,
  validatePlan,
  validDate,
  type Competition,
  type Template,
} from "../src/domain/models.ts";
import {
  priorityCycle,
  generatePlan,
  tabata,
  trainingDates,
  coverage,
} from "../src/domain/planner.ts";
import { merge } from "../src/domain/merge.ts";
import { template as base } from "./template-fixture.ts";
const c: Competition = {
  planId: crypto.randomUUID(),
  fecha_comienzo: "2026-10-08",
  fecha_torneo: "2026-12-13",
  alumnos: ["test@example.com"],
  dias_de_entrenamiento: [2, 4],
  ejercicios_por_sesion: 5,
  tiempo_por_tecnica_segundos: 180,
  descanso_entre_ciclos_segundos: 10,
  descanso_entre_tecnicas_segundos: 20,
};
test("Fixture sintético de 17 posiciones y 36 técnicas; sin order", () => {
  assert.equal(base.positions.length, 17);
  assert.equal(base.positions.flatMap((p) => p.tecnicas).length, 36);
  assert.ok(!JSON.stringify(base).includes("order"));
});

test("Alumnos tienen UUID nuevos, exclusivos y descripciones vacías; orden preservado", () => {
  const a = cloneTemplate(base),
    b = cloneTemplate(base);
  validateTechniques(a);
  const ids = new Set([
    ...a.positions.map((p) => p.id),
    ...a.positions.flatMap((p) => p.tecnicas.map((t) => t.id)),
  ]);
  for (const p of b.positions) {
    assert.ok(!ids.has(p.id));
    for (const t of p.tecnicas) {
      assert.ok(!ids.has(t.id));
      assert.equal(t.descripcion_del_alumno, "");
    }
  }
});
test("Secuencia circular, prioridades no consecutivas y caso único", () => {
  for (const priorities of [
    [1, 2, 3, 4, 5],
    [2, 7, 8, 12, 20],
  ]) {
    const flow = priorityCycle(priorities);
    assert.deepEqual(
      Array.from({ length: 14 }, () => flow.next().value),
      [0, 1, 0, 2, 1, 3, 2, 4, 3, 0, 4, 1, 0, 2].map((i) => priorities[i]),
    );
  }
  const flow = priorityCycle([8]);
  assert.deepEqual(
    Array.from({ length: 8 }, () => flow.next().value),
    Array(8).fill(8),
  );
  assert.throws(() => priorityCycle([]).next());
});
test("Plan continuo con fixture, cinco ejercicios, fechas exclusivas, snapshots y determinismo", () => {
  const tech = cloneTemplate(base),
    comments = { ...initialVersion(), comments: [] };
  const first = generatePlan(
    c,
    "test@example.com",
    tech,
    comments,
    "2026-10-13T16:00:00Z",
  );
  assert.deepEqual(
    first,
    generatePlan(c, "test@example.com", tech, comments, "2026-10-13T16:00:00Z"),
  );
  assert.equal(first.sessions.length, 19);
  assert.ok(
    first.sessions.every(
      (s) => s.exercises.length === 5 && s.date < c.fecha_torneo,
    ),
  );
  const flat = first.sessions.flatMap((s) => s.exercises);
  assert.deepEqual(
    flat.slice(0, 22).map((e) => e.techniqueId),
    tech.positions
      .filter((p) => p.prioridad === 1)
      .flatMap((p) => p.tecnicas.map((t) => t.id)),
  );
  assert.ok(flat.slice(22, 36).every((e) => e.prioridad === 2));
  assert.equal(flat[36].techniqueId, flat[0].techniqueId);
  assert.equal(tabata(first).duration, 1930);
  tech.positions[0].tecnicas[0].descripcion_del_alumno = "changed";
  assert.equal(flat[0].descripcion_del_alumno, "");
  assert.ok(coverage(first).completed.size > 0);
});
test("Tiempos variables, descansos cero y calendario vacío; validaciones", () => {
  assert.equal(
    tabata({
      ...c,
      ejercicios_por_sesion: 3,
      tiempo_por_tecnica_segundos: 60,
      descanso_entre_ciclos_segundos: 0,
      descanso_entre_tecnicas_segundos: 0,
    }).duration,
    360,
  );
  assert.deepEqual(
    trainingDates({
      ...c,
      fecha_comienzo: "2026-10-09",
      fecha_torneo: "2026-10-10",
    }),
    [],
  );
  assert.throws(() => tabata({ ...c, ejercicios_por_sesion: 0 }));
  assert.throws(() => tabata({ ...c, descanso_entre_ciclos_segundos: -1 }));
  assert.equal(validDate("2026-02-30"), false);
  assert.equal(validDate("2026-13-01"), false);
  assert.throws(() =>
    generatePlan(
      c,
      "test@example.com",
      { ...initialVersion(), positions: [] },
      { ...initialVersion(), comments: [] },
      "2026-10-13T00:00:00Z",
    ),
  );
});
test("Fusión independiente, colisiones reales, borrado y reordenación", () => {
  assert.deepEqual(merge({ a: 1, b: 1 }, { a: 2, b: 1 }, { a: 1, b: 2 }), {
    value: { a: 2, b: 2 },
    conflicts: [],
  });
  assert.equal(merge({ a: 1 }, { a: 2 }, { a: 3 }).conflicts.length, 1);
  const b = [
    { id: "a", text: "a" },
    { id: "b", text: "b" },
  ];
  assert.deepEqual(merge(b, [b[1]], b).value, [b[1]]);
  assert.equal(
    merge(b, [b[1]], [{ id: "a", text: "remote" }, b[1]]).conflicts.length,
    1,
  );
});
test("Inserciones independientes se fusionan sin conflictos de orden", () => {
  const base = [
    { id: "a", text: "A" },
    { id: "b", text: "B" },
  ];
  const result = merge(
    base,
    [...base, { id: "c", text: "C" }],
    [...base, { id: "d", text: "D" }],
  );
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(
    new Set(result.value.map((v) => v.id)),
    new Set(["a", "b", "c", "d"]),
  );
});
test("Cobertura corta por fecha y descarta posiciones sin técnicas", () => {
  const tech = cloneTemplate(base);
  tech.positions[0].tecnicas = [];
  const plan = generatePlan(
    { ...c, ejercicios_por_sesion: 1 },
    "test@example.com",
    tech,
    {
      ...initialVersion(),
      comments: [
        { techniqueId: tech.positions[1].tecnicas[0].id, comment: "Nota" },
      ],
    },
    "2026-10-13T16:00:00Z",
  );
  assert.equal(plan.sessions[0].exercises[0].comment, "Nota");
  assert.equal(coverage(plan, "2020-01-01").touched.size, 0);
  assert.equal(coverage(plan, plan.sessions[0].date).touched.size, 1);
  assert.deepEqual(plan.alumnos, ["test@example.com"]);
});
test("Fusión conserva tombstones, cambios UUID disjuntos y colisiones de orden", () => {
  const base = [
    { id: "a", x: 1, y: 1 },
    { id: "b", x: 1, y: 1 },
    { id: "c", x: 1, y: 1 },
  ];
  assert.equal(
    merge(base, [base[1], base[0], base[2]], [base[0], base[2], base[1]])
      .conflicts.length,
    1,
  );
  assert.equal(
    merge(
      base,
      [{ ...base[0], x: 2 }, base[1], base[2]],
      [{ ...base[0], y: 2 }, base[1], base[2]],
    ).value[0].x,
    2,
  );
  assert.equal(
    merge(base, [base[1], base[2]], [base[1], base[2]]).value.length,
    2,
  );
  assert.equal(
    merge(
      { revision: 1, updatedAt: "old", x: 1, y: 1 },
      { revision: 1, updatedAt: "old", x: 2, y: 1 },
      { revision: 2, updatedAt: "new", x: 1, y: 2 },
    ).value.revision,
    2,
  );
  assert.equal(merge({ a: 1 }, {}, { a: 2 }).conflicts.length, 1);
});
test("Validación exhaustiva de versiones, perfiles, técnicas y configuración", async () => {
  const { validateVersion, validateProfile, validateCompetition, versioned } =
    await import("../src/domain/models.ts");
  const v = initialVersion();
  assert.equal(versioned(v).revision, 2);
  for (const bad of [
    null,
    {},
    { ...v, schemaVersion: 2 },
    { ...v, revision: 0 },
    { ...v, revision: 1.5 },
    { ...v, updatedAt: "invalid" },
    { ...v, updatedAt: 12 },
  ])
    assert.throws(() => validateVersion(bad));
  for (const bad of [
    undefined,
    23,
    "wrong",
    "2026-2-01",
    "2026-02-30",
    "2026-13-01",
  ])
    assert.equal(validDate(bad), false);
  assert.equal(validDate("2024-02-29"), true);
  const p = {
    ...v,
    mail: "test@example.com",
    nombre: "Test",
    apellidos: "",
    peso: null,
    fecha_nacimiento: null,
    cinturon: "Blanco",
    perfil: "alumno",
  } as any;
  validateProfile(p);
  validateProfile({ ...p, peso: 70, fecha_nacimiento: "2000-01-01" });
  for (const [key, value] of [
    ["mail", 2],
    ["nombre", null],
    ["nombre", "a".repeat(201)],
    ["apellidos", null],
    ["apellidos", "a".repeat(201)],
    ["peso", -1],
    ["peso", NaN],
    ["peso", Infinity],
    ["peso", 0],
    ["peso", 500],
    ["peso", "70"],
    ["cinturon", "verde"],
    ["perfil", "admin"],
    ["fecha_nacimiento", "bad"],
  ])
    assert.throws(() => validateProfile({ ...p, [String(key)]: value }));
  for (const change of [
    { fecha_comienzo: "bad" },
    { fecha_torneo: "bad" },
    { fecha_comienzo: c.fecha_torneo },
    { dias_de_entrenamiento: [] },
    { dias_de_entrenamiento: null },
    { dias_de_entrenamiento: [2, 2] },
    { dias_de_entrenamiento: [0] },
    { dias_de_entrenamiento: [8] },
    { dias_de_entrenamiento: [1.5] },
    { ejercicios_por_sesion: 101 },
    { ejercicios_por_sesion: 1.5 },
    { tiempo_por_tecnica_segundos: 0 },
    { tiempo_por_tecnica_segundos: 3601 },
    { descanso_entre_ciclos_segundos: -1 },
    { descanso_entre_tecnicas_segundos: 3601 },
    { fecha_torneo: "2029-12-13" },
  ])
    assert.throws(() =>
      validateCompetition({ ...c, ...change } as Competition),
    );
  const t = cloneTemplate(base);
  for (const bad of [
    { ...t, positions: null },
    { ...t, positions: Array(201).fill(t.positions[0]) },
  ])
    assert.throws(() => validateTechniques(bad));
  for (const change of [
    { id: "bad" },
    { posicion: "" },
    { posicion: 2 },
    { posicion: "a".repeat(501) },
    { prioridad: 0 },
    { prioridad: 1.5 },
    { tecnicas: null },
    { tecnicas: Array(101).fill(t.positions[0].tecnicas[0]) },
  ])
    assert.throws(() =>
      validateTechniques({
        ...t,
        positions: [{ ...t.positions[0], ...change }],
      }),
    );
  for (const change of [
    { id: t.positions[0].id },
    { tipo: "" },
    { tipo: 2 },
    { tipo: "a".repeat(501) },
    { descripcion_del_alumno: 2 },
    { descripcion_del_alumno: "a".repeat(10001) },
  ])
    assert.throws(() =>
      validateTechniques({
        ...t,
        positions: [
          {
            ...t.positions[0],
            tecnicas: [{ ...t.positions[0].tecnicas[0], ...change }],
          },
        ],
      }),
    );
});
test("Fusión: valores iguales, arrays sin UUID, adiciones simultáneas y orden independiente", () => {
  assert.deepEqual(merge(1, 2, 2), { value: 2, conflicts: [] });
  assert.deepEqual(merge([1], [2], [3]).conflicts, ["/"]);
  assert.deepEqual(merge({ a: 1 }, { a: 1 }, { a: 2 }).value, { a: 2 });
  const b = [
    { id: "a", x: 1 },
    { id: "b", x: 1 },
  ];
  assert.deepEqual(
    merge(b, [...b, { id: "c", x: 1 }], [b[1], b[0]]).value.map((v) => v.id),
    ["b", "a", "c"],
  );
  assert.deepEqual(
    merge(b, [b[1], b[0]], [...b, { id: "c", x: 1 }]).conflicts,
    [],
  );
  assert.equal(
    merge([], [{ id: "a", x: 1 }], [{ id: "a", x: 2 }]).conflicts.length,
    1,
  );
  assert.deepEqual(merge({ a: 1, b: 1 }, { b: 1 }, { a: 1, b: 2 }).value, {
    b: 2,
  });
});
test("Fusión preserva la posición de inserciones y notas por UUID de técnica", () => {
  const base = [
    { id: "a", x: 1 },
    { id: "b", x: 1 },
  ];
  const r = merge(
    base,
    [base[0], { id: "c", x: 1 }, base[1]],
    [{ ...base[0], x: 2 }, base[1]],
  );
  assert.equal(r.conflicts.length, 0);
  assert.deepEqual(
    r.value.map((v) => v.id),
    ["a", "c", "b"],
  );
  assert.deepEqual(
    merge(
      [{ techniqueId: "a", comment: "A" }],
      [{ techniqueId: "a", comment: "B" }],
      [
        { techniqueId: "a", comment: "A" },
        { techniqueId: "b", comment: "C" },
      ],
    ).conflicts,
    [],
  );
  assert.equal(merge({ a: 1 }, { a: 2 }, { a: undefined }).value.a, 2);
});
test("Resolver colisión remota conserva cambios independientes locales y remotos", async () => {
  const { resolveRemote } = await import("../src/domain/merge.ts");
  const result = merge(
    { a: 1, b: 1, c: 1 },
    { a: 2, b: 2, c: 1 },
    { a: 3, b: 1, c: 3 },
  );
  assert.deepEqual(
    resolveRemote(result.value, { a: 3, b: 1, c: 3 }, result.conflicts),
    { a: 3, b: 2, c: 3 },
  );
  const base = [
      { id: "a", x: 1 },
      { id: "b", x: 1 },
    ],
    local = [{ id: "b", x: 2 }],
    remote = [
      { id: "a", x: 2 },
      { id: "b", x: 1 },
    ];
  const m = merge(base, local, remote);
  assert.deepEqual(
    new Set(resolveRemote(m.value, remote, m.conflicts).map((v) => v.id)),
    new Set(["a", "b"]),
  );
});
test("Validación de plan completo y snapshots inválidos", async () => {
  const p = generatePlan(
    c,
    "test@example.com",
    cloneTemplate(base),
    { ...initialVersion(), comments: [] },
    "2026-10-13T00:00:00Z",
  );
  validatePlan(p);
  for (const change of [
    { planId: "bad" },
    { mail: 2 },
    { alumnos: [] },
    { alumnos: ["other@example.com"] },
    { generatedAt: "bad" },
    { sessions: null },
    { sessions: [p.sessions[0], p.sessions[0]] },
  ])
    assert.throws(() => validatePlan({ ...p, ...change }));
  for (const change of [
    { date: "bad" },
    { date: "2020-01-01" },
    { date: c.fecha_torneo },
    { exercises: [] },
    { exercises: null },
  ])
    assert.throws(() =>
      validatePlan({ ...p, sessions: [{ ...p.sessions[0], ...change }] }),
    );
  for (const change of [
    { positionId: "bad" },
    { techniqueId: "bad" },
    { posicion: "" },
    { tipo: "" },
    { descripcion_del_alumno: 2 },
    { comment: 2 },
    { prioridad: 0 },
    { pass: 0 },
    { positionComplete: 2 },
  ]) {
    const next = structuredClone(p);
    next.sessions[0].exercises[0] = {
      ...next.sessions[0].exercises[0],
      ...change,
    } as any;
    assert.throws(() => validatePlan(next));
  }
});
test("Resolver conflictos: eliminación, orden, raíz y atributos UUID", async () => {
  const { resolveRemote } = await import("../src/domain/merge.ts");
  assert.deepEqual(
    resolveRemote(
      [{ id: "a" }, { id: "b", x: 2 }],
      [{ id: "b", x: 1 }],
      ["/a"],
    ),
    [{ id: "b", x: 2 }],
  );
  assert.deepEqual(
    resolveRemote(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      [{ id: "b" }, { id: "a" }],
      ["/order"],
    ).map((v) => v.id),
    ["b", "a", "c"],
  );
  assert.deepEqual(resolveRemote([1], [2], ["/"]), [2]);
  assert.deepEqual(resolveRemote({ a: 1, b: 2 }, { a: 3 }, ["/b"]), { a: 1 });
  assert.deepEqual(
    resolveRemote(
      [{ techniqueId: "a", comment: "local" }],
      [{ techniqueId: "a", comment: "remote" }],
      ["/a/comment"],
    ),
    [{ techniqueId: "a", comment: "remote" }],
  );
});
test("Generación de prioridad única, todos los días y cobertura vacía", () => {
  const t = cloneTemplate(base);
  t.positions = t.positions.slice(0, 1);
  const single = {
    ...c,
    dias_de_entrenamiento: [1, 2, 3, 4, 5, 6, 7],
    ejercicios_por_sesion: 1,
    tiempo_por_tecnica_segundos: 1,
    descanso_entre_ciclos_segundos: 0,
    descanso_entre_tecnicas_segundos: 0,
  };
  const plan = generatePlan(
    single,
    "test@example.com",
    t,
    { ...initialVersion(), comments: [] },
    "2026-10-13T00:00:00Z",
  );
  assert.equal(plan.sessions.length, 66);
  assert.ok(plan.sessions.every((s) => s.exercises.length === 1));
  assert.equal(tabata(single).duration, 2);
  assert.equal(coverage({ ...plan, sessions: [] }, "").touched.size, 0);
  assert.equal(coverage(plan, "9999-01-01").touched.size, 1);
});
