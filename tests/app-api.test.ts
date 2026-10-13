import { test } from "node:test";
import assert from "node:assert/strict";
import { AppApi } from "../worker/application.ts";
import { ApiError } from "../worker/security.ts";
import type { CloudStorageProvider, CloudRecord } from "../worker/storage.ts";
import { template } from "./template-fixture.ts";
function fixture() {
  const files = new Map<string, CloudRecord<unknown>>([
    [
      "PGT/master_data/tecnics_base.json",
      { data: template, sha: "1".repeat(40) },
    ],
  ]);
  const sessions = new Map<string, unknown>();
  const reads=new Map<string,number>();
  let revision = 1;
  const store = {
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
    read: async <T>(path: string) => {reads.set(path,(reads.get(path)||0)+1);return (files.get(path) as CloudRecord<T>) || null;},
    write: async (path, data, sha) => {
      assert.equal(files.get(path)?.sha ?? null, sha);
      const next = (++revision).toString(16).padStart(40, "0");
      files.set(path, {
        data: structuredClone(data) as Record<string, unknown>,
        sha: next,
      });
      return next;
    },
    remove: async (path, sha) => {
      assert.equal(files.get(path)?.sha, sha);
      files.delete(path);
    },
    list: async (directory) =>
      [
        ...new Set(
          [...files.keys()]
            .filter((p) => p.startsWith(directory + "/"))
            .map((p) => p.slice(directory.length + 1).split("/")[0]),
        ),
      ].map((name) => ({
        name,
        type: name.endsWith(".json") ? "file" : "dir",
        sha:files.get(directory+'/'+name)?.sha,
      })),
  };
  const api = new AppApi(store as unknown as DurableObjectStorage, cloud, {
    PROBE_ADMIN_KEY: "admin-key",
  });
  const call = async (
    path: string,
    method: string,
    body?: unknown,
    token = "",
  ) => {
    const request = new Request("https://example" + path, {
      method,
      headers: {
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    try {
      return await api.handle(request, new URL(request.url));
    } catch (e) {
      if (e instanceof ApiError)
        return Response.json({ error: e.message }, { status: e.status });
      throw e;
    }
  };
  return { call, files, reads };
}
test("Registro completo, plantilla sintética, UUID exclusivos, bootstrap único y permisos", async () => {
  const f = fixture();
  const register = async (mail: string) => {
    const r = await f.call("/api/app/register", "POST", {
      mail,
      password: "synthetic-test-password",
      confirm: "synthetic-test-password",
      nombre: "Test",
      apellidos: "",
    });
    assert.equal(r.status, 201);
    return (await r.json()) as { token: string; profile: any };
  };
  const a = await register("app-a@example.com"),
    b = await register("app-b@example.com");
  assert.ok(!JSON.stringify(a).includes("pbkdf2"));
  assert.equal(
    (f.files.get("PGT/users_data/app-a@example.com/tecnics.json")!.data as any)
      .positions.length,
    17,
  );
  assert.notEqual(
    (f.files.get("PGT/users_data/app-a@example.com/tecnics.json")!.data as any)
      .positions[0].id,
    (f.files.get("PGT/users_data/app-b@example.com/tecnics.json")!.data as any)
      .positions[0].id,
  );
  assert.equal(
    (
      await f.call(
        "/api/app/users/app-b@example.com/snapshot",
        "GET",
        undefined,
        a.token,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call(
        "/api/app/bootstrap",
        "POST",
        { mail: "app-a@example.com" },
        "admin-key",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await f.call(
        "/api/app/bootstrap",
        "POST",
        { mail: "app-b@example.com" },
        "admin-key",
      )
    ).status,
    409,
  );
  assert.equal(
    (await f.call("/api/app/catalog", "GET", undefined, a.token)).status,
    401,
  );
});
test("Contraseña cambia solo pwd, revoca sesiones y conserva técnicas y perfil", async () => {
  const f = fixture();
  const r = await f.call("/api/app/register", "POST", {
    mail: "test@example.com",
    password: "synthetic-test-password",
    confirm: "synthetic-test-password",
    nombre: "Test",
    apellidos: "",
  });
  const { token } = (await r.json()) as any;
  const old = f.files.get("PGT/users_data/test@example.com/user_data.json")!;
  const t = f.files.get("PGT/users_data/test@example.com/tecnics.json")!;
  assert.equal(
    (
      await f.call(
        "/api/app/password",
        "POST",
        {
          mail: "test@example.com",
          password: "synthetic-new-password",
          confirm: "wrong",
          sha: old.sha,
        },
        token,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call(
        "/api/app/password",
        "POST",
        {
          mail: "test@example.com",
          password: "synthetic-new-password",
          confirm: "synthetic-new-password",
          sha: old.sha,
        },
        token,
      )
    ).status,
    200,
  );
  const next = f.files.get("PGT/users_data/test@example.com/user_data.json")!;
  const { pwd: x, ...before } = old.data as any,
    { pwd: y, ...after } = next.data as any;
  assert.deepEqual(before, after);
  assert.notEqual(x, y);
  assert.deepEqual(
    f.files.get("PGT/users_data/test@example.com/tecnics.json"),
    t,
  );
  assert.equal(
    (await f.call("/api/app/catalog", "GET", undefined, token)).status,
    401,
  );
  assert.equal(
    (
      await f.call("/api/app/login", "POST", {
        mail: "test@example.com",
        password: "synthetic-new-password",
      })
    ).status,
    200,
  );
});
test("Competición: asignación, snapshot único, comentarios, manual, CAS, desasignación y tombstone", async () => {
  const f = fixture(),
    password = "synthetic-test-password";
  for (const mail of ["trainer@example.com", "student@example.com"])
    assert.equal(
      (
        await f.call("/api/app/register", "POST", {
          mail,
          password,
          confirm: password,
          nombre: "Test",
          apellidos: "",
        })
      ).status,
      201,
    );
  await f.call(
    "/api/app/bootstrap",
    "POST",
    { mail: "trainer@example.com" },
    "admin-key",
  );
  const login = async (mail: string) =>
    (
      (await (
        await f.call("/api/app/login", "POST", { mail, password })
      ).json()) as any
    ).token;
  const trainer = await login("trainer@example.com"),
    student = await login("student@example.com");
  const path = "/api/app/users/student@example.com/";
  let snapshot = (await (
    await f.call(path + "snapshot", "GET", undefined, student)
  ).json()) as any;
  assert.equal(
    (
      await f.call(
        path + "comments",
        "PUT",
        { data: snapshot.comments.data, sha: snapshot.comments.sha },
        student,
      )
    ).status,
    403,
  );
  const notes = {
    ...snapshot.comments.data,
    comments: [
      {
        techniqueId: snapshot.techniques.data.positions[0].tecnicas[0].id,
        comment: "Entrenador",
      },
    ],
  };
  assert.equal(
    (
      await f.call(
        path + "comments",
        "PUT",
        { data: notes, sha: snapshot.comments.sha },
        trainer,
      )
    ).status,
    200,
  );
  const competition = {
    fecha_comienzo: "2026-10-13",
    fecha_torneo: "2026-10-21",
    dias_de_entrenamiento: [2, 4],
    ejercicios_por_sesion: 3,
    tiempo_por_tecnica_segundos: 60,
    descanso_entre_ciclos_segundos: 0,
    descanso_entre_tecnicas_segundos: 0,
    alumnos: ["student@example.com"],
  };
  assert.equal(
    (
      await f.call(
        "/api/app/competition",
        "POST",
        {
          competition: { ...competition, ejercicios_por_sesion: 0 },
          sha: null,
        },
        trainer,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call(
        "/api/app/competition",
        "POST",
        { competition, sha: null },
        student,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call(
        "/api/app/competition",
        "POST",
        { competition, sha: null },
        trainer,
      )
    ).status,
    200,
  );
  snapshot = (await (
    await f.call(path + "snapshot", "GET", undefined, student)
  ).json()) as any;
  assert.equal(snapshot.plans.length, 1);
  assert.ok(
    snapshot.plans[0].data.sessions.every((s: any) => s.exercises.length === 3),
  );
  assert.equal(
    snapshot.plans[0].data.sessions[0].exercises[0].comment,
    "Entrenador",
  );
  const known = {
    profile: snapshot.profile.sha,
    techniques: snapshot.techniques.sha,
    comments: snapshot.comments.sha,
    index: snapshot.index.sha,
    ["plan:" + snapshot.plans[0].data.planId]: snapshot.plans[0].sha,
  };
  const inc = (await (
    await f.call(
      path + "snapshot?known=" + encodeURIComponent(JSON.stringify(known)),
      "GET",
      undefined,
      student,
    )
  ).json()) as any;
  assert.equal(inc.techniques.unchanged, true);
  assert.equal("data" in inc.plans[0], false);
  const original = structuredClone(snapshot.plans[0]);
  const edited = structuredClone(snapshot.techniques.data);
  edited.positions[0].tecnicas[0].descripcion_del_alumno = "Después";
  assert.equal(
    (
      await f.call(
        path + "techniques",
        "PUT",
        { data: edited, sha: snapshot.techniques.sha },
        student,
      )
    ).status,
    200,
  );
  snapshot = (await (
    await f.call(path + "snapshot", "GET", undefined, student)
  ).json()) as any;
  assert.deepEqual(snapshot.plans[0], original);
  const manual = structuredClone(original.data);
  manual.sessions[0].exercises[0].descripcion_del_alumno = "Manual";
  assert.equal(
    (
      await f.call(
        path + "plan",
        "PUT",
        { data: manual, sha: original.sha },
        student,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await f.call(
        path + "plan",
        "PUT",
        { data: manual, sha: original.sha },
        student,
      )
    ).status,
    409,
  );
  let catalog = (await (
    await f.call("/api/app/catalog", "GET", undefined, trainer)
  ).json()) as any;
  const id = catalog.data.plans[0].planId;
  assert.equal(
    (
      await f.call(
        "/api/app/assignment",
        "POST",
        { planId: id, alumnos: [], sha: catalog.sha },
        trainer,
      )
    ).status,
    200,
  );
  snapshot = (await (
    await f.call(path + "snapshot", "GET", undefined, student)
  ).json()) as any;
  assert.equal(snapshot.index.data.planIds.length, 0);
  assert.equal(snapshot.plans.length, 1);
  catalog = (await (
    await f.call("/api/app/catalog", "GET", undefined, trainer)
  ).json()) as any;
  assert.equal(
    (
      await f.call(
        "/api/app/delete-competition",
        "POST",
        { planId: id, sha: catalog.sha },
        trainer,
      )
    ).status,
    200,
  );
  snapshot = (await (
    await f.call(path + "snapshot", "GET", undefined, student)
  ).json()) as any;
  assert.equal(snapshot.plans.length, 0);
  assert.ok(snapshot.deletedPlanIds.includes(id));
});
test("Trainer reset: inexistente, confirmación, CAS, hash nuevo y roles sin auto degradación", async () => {
  const f = fixture(),
    password = "synthetic-test-password";
  for (const mail of ["trainer@example.com", "student@example.com"])
    await f.call("/api/app/register", "POST", {
      mail,
      password,
      confirm: password,
      nombre: "Test",
      apellidos: "",
    });
  await f.call(
    "/api/app/bootstrap",
    "POST",
    { mail: "trainer@example.com" },
    "admin-key",
  );
  const trainer = (
    (await (
      await f.call("/api/app/login", "POST", {
        mail: "trainer@example.com",
        password,
      })
    ).json()) as any
  ).token;
  const p = f.files.get("PGT/users_data/student@example.com/user_data.json")!,
    t = f.files.get("PGT/users_data/student@example.com/tecnics.json")!;
  const reset = {
    mail: "student@example.com",
    password: "synthetic-new-password",
    confirm: "synthetic-new-password",
    sha: p.sha,
  };
  assert.equal(
    (
      await f.call(
        "/api/app/password",
        "POST",
        { ...reset, mail: "missing@example.com" },
        trainer,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await f.call(
        "/api/app/password",
        "POST",
        { ...reset, confirm: "different" },
        trainer,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call(
        "/api/app/password",
        "POST",
        { ...reset, sha: "0".repeat(40) },
        trainer,
      )
    ).status,
    409,
  );
  assert.equal(
    (await f.call("/api/app/password", "POST", reset, trainer)).status,
    200,
  );
  assert.deepEqual(
    f.files.get("PGT/users_data/student@example.com/tecnics.json"),
    t,
  );
  assert.equal(
    (
      await f.call("/api/app/login", "POST", {
        mail: "student@example.com",
        password,
      })
    ).status,
    401,
  );
  const student = (
    (await (
      await f.call("/api/app/login", "POST", {
        mail: "student@example.com",
        password: reset.password,
      })
    ).json()) as any
  ).token;
  const tp = f.files.get("PGT/users_data/trainer@example.com/user_data.json")!;
  assert.equal(
    (
      await f.call(
        "/api/app/role",
        "POST",
        { mail: "trainer@example.com", perfil: "alumno", sha: tp.sha },
        trainer,
      )
    ).status,
    400,
  );
  const sp = f.files.get("PGT/users_data/student@example.com/user_data.json")!;
  assert.equal(
    (
      await f.call(
        "/api/app/role",
        "POST",
        { mail: "student@example.com", perfil: "entrenador", sha: sp.sha },
        trainer,
      )
    ).status,
    200,
  );
  assert.equal(
    (await f.call("/api/app/catalog", "GET", undefined, student)).status,
    401,
  );
});
test("Guardado sin cambios confirma SHA sin crear otro commit", async () => {
  const f = fixture();
  const auth = (await (
    await f.call("/api/app/register", "POST", {
      mail: "same@example.com",
      password: "synthetic-test-password",
      confirm: "synthetic-test-password",
      nombre: "Test",
      apellidos: "",
    })
  ).json()) as any;
  const path = "/api/app/users/same@example.com/";
  const snap = (await (
    await f.call(path + "snapshot", "GET", undefined, auth.token)
  ).json()) as any;
  for (const key of ["profile", "techniques"]) {
    const record = snap[key];
    const r = await f.call(
      path + key,
      "PUT",
      { data: record.data, sha: record.sha },
      auth.token,
    );
    assert.equal(r.status, 200);
    const result = (await r.json()) as any;
    assert.equal(result.status, "UNCHANGED_NO_COMMIT");
    assert.equal(result.sha, record.sha);
  }
  f.reads.clear();const known={profile:snap.profile.sha,techniques:snap.techniques.sha,comments:snap.comments.sha,index:snap.index.sha};const incremental=await (await f.call(path+'snapshot?known='+encodeURIComponent(JSON.stringify(known)),'GET',undefined,auth.token)).json() as any;assert.equal(incremental.techniques.unchanged,true);assert.equal(f.reads.get('PGT/users_data/same@example.com/tecnics.json')||0,0);assert.equal(f.reads.get('PGT/users_data/same@example.com/trainer_comments.json')||0,0);
});
