import { test } from "node:test";
import assert from "node:assert/strict";
import { AppApi } from "../worker/application.ts";
import { ApiError } from "../worker/security.ts";
import { template } from "./template-fixture.ts";
import type { CloudStorageProvider, CloudRecord } from "../worker/storage.ts";

function fixture() {
  const files = new Map<string, CloudRecord<any>>([
    [
      "PGT/master_data/tecnics_base.json",
      { data: structuredClone(template), sha: "1".repeat(40) },
    ],
  ]);
  const sessions = new Map<string, unknown>();
  let revision = 1,
    failure = 0;
  const storage = {
    get: async (k: string) => sessions.get(k),
    put: async (k: string, v: unknown) => {
      sessions.set(k, v);
    },
    delete: async (k: string) => sessions.delete(k),
    list: async ({ prefix }: { prefix: string }) =>
      new Map([...sessions].filter(([k]) => k.startsWith(prefix))),
  };
  const cloud: CloudStorageProvider = {
    verifyPrivate: async () => {},
    read: async <T>(p: string) => (files.get(p) as CloudRecord<T>) || null,
    write: async (p, data, sha) => {
      if (p.includes("/training_plans/") && failure) {
        const status = failure;
        failure = 0;
        throw new ApiError(status, "INJECTED_PLAN_FAILURE");
      }
      if ((files.get(p)?.sha ?? null) !== sha)
        throw new ApiError(409, "VERSION_CONFLICT");
      const next = (++revision).toString(16).padStart(40, "0");
      files.set(p, { data: structuredClone(data), sha: next });
      return next;
    },
    remove: async (p) => {
      files.delete(p);
    },
    list: async (dir) =>
      [
        ...new Set(
          [...files.keys()]
            .filter((p) => p.startsWith(dir + "/"))
            .map((p) => p.slice(dir.length + 1).split("/")[0]),
        ),
      ].map((name) => ({
        name,
        type: name.endsWith(".json") ? "file" : "dir",
        sha: files.get(dir + "/" + name)?.sha,
      })),
  };
  let instant = new Date("2026-10-13T22:30:00Z");
  const api = new AppApi(
    storage as unknown as DurableObjectStorage,
    cloud,
    () => instant,
  );
  async function call(
    path: string,
    method: string,
    body?: unknown,
    token = "",
  ) {
    const req = new Request("https://fixture" + path, {
      method,
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    try {
      return await api.handle(req, new URL(req.url));
    } catch (e) {
      if (e instanceof ApiError)
        return Response.json({ error: e.message }, { status: e.status });
      throw e;
    }
  }
  async function register(mail: string) {
    const r = await call("/api/app/register", "POST", {
      mail,
      password: "synthetic-test-password",
      confirm: "synthetic-test-password",
      nombre: "Fixture",
      apellidos: "",
    });
    assert.equal(r.status, 201);
    return ((await r.json()) as any).token;
  }
  return {
    files,
    setDate: (date: string) => {
      instant = new Date(date + "T10:00:00Z");
    },
    call,
    register,
    fail: (status: number) => {
      failure = status;
    },
  };
}

test("Future text sync persists to GitHub adapter, recovers partial failures, isolates students and preserves closed plans", async () => {
  const f = fixture(),
    a = "a@example.com",
    b = "b@example.com";
  const aToken = await f.register(a),
    bToken = await f.register(b);
  await f.register("coach@example.com");
  f.files.get("PGT/users_data/coach@example.com/user_data.json")!.data.perfil = "entrenador";
  const trainer = (
    (await (
      await f.call("/api/app/login", "POST", {
        mail: "coach@example.com",
        password: "synthetic-test-password",
      })
    ).json()) as any
  ).token;
  let catalogSha: string | null = null;
  for (const tournament of ["2026-12-13", "2026-10-14"]) {
    const competition = {
      fecha_comienzo: "2026-10-08",
      fecha_torneo: tournament,
      dias_de_entrenamiento: [2, 4],
      ejercicios_por_sesion: 5,
      tiempo_por_tecnica_segundos: 180,
      descanso_entre_ciclos_segundos: 10,
      descanso_entre_tecnicas_segundos: 20,
      alumnos: [a, b],
    };
    assert.equal(
      (
        await f.call(
          "/api/app/competition",
          "POST",
          { competition, sha: catalogSha },
          trainer,
        )
      ).status,
      200,
    );
    catalogSha = f.files.get("PGT/master_data/plans.json")!.sha;
  }
  const path = `/api/app/users/${a}/`,
    snapshot = async () =>
      (await (
        await f.call(path + "snapshot", "GET", undefined, aToken)
      ).json()) as any;
  let snap = await snapshot();
  await f.call(`/api/app/users/${b}/snapshot`, "GET", undefined, bToken);
  const active = snap.plans.find(
      (p: any) => p.data.fecha_torneo === "2026-12-13",
    ),
    ended = snap.plans.find((p: any) => p.data.fecha_torneo === "2026-10-14");
  const before = structuredClone(active.data),
    other = JSON.stringify(
      [...f.files].filter(([k]) => k.includes(`/users_data/${b}/`)),
    ),
    id = snap.techniques.data.positions[0].tecnicas[0].id;
  const techniques = structuredClone(snap.techniques.data);
  techniques.positions[0].tecnicas[0].descripcion_del_alumno =
    "Nueva preferida";
  f.fail(503);
  assert.equal(
    (
      await f.call(
        path + "techniques",
        "PUT",
        { data: techniques, sha: snap.techniques.sha },
        aToken,
      )
    ).status,
    503,
  );
  assert.equal(
    f.files.get(`PGT/users_data/${a}/tecnics.json`)!.data.positions[0]
      .tecnicas[0].descripcion_del_alumno,
    "Nueva preferida",
  );
  // Source and version are already durable. Snapshot heals the interrupted fan-out.
  snap = await snapshot();
  let updated = snap.plans.find(
    (p: any) => p.data.planId === active.data.planId,
  );
  assert.deepEqual(
    snap.plans.find((p: any) => p.data.planId === ended.data.planId),
    ended,
  );
  assert.deepEqual(
    updated.data.sessions.filter((s: any) => s.date <= "2026-10-14"),
    before.sessions.filter((s: any) => s.date <= "2026-10-14"),
  );
  let occurrences = 0;
  for (const s of updated.data.sessions)
    if (s.date > "2026-10-14")
      for (const e of s.exercises)
        if (e.techniqueId === id) {
          occurrences++;
          assert.equal(e.descripcion_del_alumno, "Nueva preferida");
        }
  assert.ok(occurrences > 1);
  assert.equal(
    JSON.stringify(
      [...f.files].filter(([k]) => k.includes(`/users_data/${b}/`)),
    ),
    other,
  );
  f.fail(409); // CAS failure must refetch the plan and retry, never last-writer-win.
  const notes = {
    ...snap.comments.data,
    comments: [{ techniqueId: id, comment: "Consejo futuro" }],
  };
  assert.equal(
    (
      await f.call(
        path + "comments",
        "PUT",
        { data: notes, sha: snap.comments.sha },
        trainer,
      )
    ).status,
    200,
  );
  snap = await snapshot();
  updated = snap.plans.find((p: any) => p.data.planId === active.data.planId);
  for (const s of updated.data.sessions)
    for (const e of s.exercises)
      if (e.techniqueId === id)
        assert.equal(e.comment, s.date > "2026-10-14" ? "Consejo futuro" : "");
  const unchanged = JSON.stringify(updated);
  assert.equal(
    JSON.stringify(
      (await snapshot()).plans.find(
        (p: any) => p.data.planId === active.data.planId,
      ),
    ),
    unchanged,
  );
  const manual = structuredClone(updated.data),
    future = manual.sessions.find(
      (s: any) =>
        s.date > "2026-10-14" &&
        s.exercises.some((e: any) => e.techniqueId === id),
    );
  manual.appliedDescriptionUpdates = { [id]: "forged" };
  future.exercises.find(
    (e: any) => e.techniqueId === id,
  ).descripcion_del_alumno = "Manual posterior";
  assert.equal(
    (
      await f.call(
        path + "plan",
        "PUT",
        { data: manual, sha: updated.sha },
        aToken,
      )
    ).status,
    403,
  );
  snap = await snapshot();
  assert.equal(
    snap.plans
      .find((p: any) => p.data.planId === active.data.planId)
      .data.sessions.find((s: any) => s.date === future.date)
      .exercises.find((e: any) => e.techniqueId === id).descripcion_del_alumno,
    "Nueva preferida",
  );
  assert.equal(
    (
      await f.call(
        path + "comments",
        "PUT",
        { data: notes, sha: snap.comments.sha },
        aToken,
      )
    ).status,
    403,
  );
  // Additions alone do not silently activate the structural algorithm under analysis.
  const newTech = structuredClone(snap.techniques.data);
  newTech.positions[0].tecnicas.push({
    id: crypto.randomUUID(),
    tipo: "Nueva",
    descripcion_del_alumno: "",
  });
  const plansBefore = JSON.stringify(snap.plans);
  assert.equal(
    (
      await f.call(
        path + "techniques",
        "PUT",
        { data: newTech, sha: snap.techniques.sha },
        aToken,
      )
    ).status,
    200,
  );
  assert.equal(JSON.stringify((await snapshot()).plans), plansBefore);
  snap = await snapshot();
  const beforeRecovery = snap.plans.find(
    (p: any) => p.data.planId === active.data.planId,
  ).data;
  const recoveryDate = beforeRecovery.sessions.find(
    (s: any) =>
      s.date > "2026-10-14" &&
      s.exercises.some((e: any) => e.techniqueId === id),
  ).date;
  const delayed = structuredClone(snap.techniques.data);
  delayed.positions
    .flatMap((p: any) => p.tecnicas)
    .find((t: any) => t.id === id).descripcion_del_alumno =
    "Segunda actualización";
  f.fail(503);
  assert.equal(
    (
      await f.call(
        path + "techniques",
        "PUT",
        { data: delayed, sha: snap.techniques.sha },
        aToken,
      )
    ).status,
    503,
  );
  f.setDate(recoveryDate);
  const recovered = (await snapshot()).plans.find(
    (p: any) => p.data.planId === active.data.planId,
  ).data;
  assert.deepEqual(
    recovered.sessions.filter((s: any) => s.date <= recoveryDate),
    beforeRecovery.sessions.filter((s: any) => s.date <= recoveryDate),
  );
  assert.ok(
    recovered.sessions.some(
      (s: any) =>
        s.date > recoveryDate &&
        s.exercises.some(
          (e: any) =>
            e.techniqueId === id &&
            e.descripcion_del_alumno === "Segunda actualización",
        ),
    ),
  );
});
