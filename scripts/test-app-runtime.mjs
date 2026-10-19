import { madridDate } from "../src/domain/plan-text-updates.ts";
import { template } from "../tests/template-fixture.ts";
import assert from "node:assert/strict";
import { pbkdf2Sync } from "node:crypto";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
const password = "synthetic-application-password",
  admin = "synthetic-admin-more-than-thirty-two-characters";
let seq = 1,
  calls = 0;
const files = new Map([
  [
    "PGT/master_data/tecnics_base.json",
    {
      content: Buffer.from(JSON.stringify(template)).toString("base64"),
      sha: "1".repeat(40),
    },
  ],
]);
const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    scriptPath: ".worker-build/index.js",
    compatibilityDate: "2026-10-13",
    durableObjects: {
      SECURITY: { className: "ProbeSecurity", useSQLite: true },
    },
    bindings: {
      ALLOWED_ORIGINS: "https://pgt.example,https://pgt.pages.dev",
      DATA_BRANCH: "main",
      PROBE_ADMIN_KEY: admin,
      GITHUB_DATA_TOKEN: "synthetic-github",
    },
    outboundService: async (request) => {
      const url = new URL(request.url);
      assert.equal(url.hostname, "api.github.com");
      assert.equal(
        request.headers.get("Authorization"),
        "Bearer synthetic-github",
      );
      if (url.pathname === "/repos/dmda92/pgt-bjj-data")
        return Response.json({
          private: true,
          full_name: "dmda92/pgt-bjj-data",
        });
      const path = decodeURIComponent(
        url.pathname.replace("/repos/dmda92/pgt-bjj-data/contents/", ""),
      );
      assert.ok(path.startsWith("PGT/"));
      if (request.method === "GET") {
        if (!path.endsWith(".json")) {
          const names = [
            ...new Set(
              [...files.keys()]
                .filter((p) => p.startsWith(path + "/"))
                .map((p) => p.slice(path.length + 1).split("/")[0]),
            ),
          ];
          return Response.json(
            names.map((name) => ({
              name,
              type: name.endsWith(".json") ? "file" : "dir",
              sha: files.get(path + "/" + name)?.sha,
            })),
          );
        }
        const file = files.get(path);
        if (!file) return Response.json({}, { status: 404 });
        return Response.json({
          ...file,
          type: "file",
          encoding: "base64",
          size: Buffer.from(file.content, "base64").length,
        });
      }
      const b = await request.json();
      assert.equal(b.branch, "main");
      const old = files.get(path);
      if ((old?.sha ?? null) !== (b.sha ?? null))
        return Response.json({}, { status: 409 });
      if (request.method === "DELETE") {
        files.delete(path);
        return Response.json({});
      }
      assert.equal(request.method, "PUT");
      const sha = (++seq).toString(16).padStart(40, "0");
      files.set(path, { content: b.content, sha });
      if (path.endsWith("/user_data.json")) {
        const profile = JSON.parse(
          Buffer.from(b.content, "base64").toString("utf8"),
        );
        const [kind, count, salt, hash] = profile.pwd.split("$");
        assert.equal(kind, "pbkdf2-sha256");
        assert.equal(count, "600000");
        assert.equal(
          hash,
          pbkdf2Sync(password, salt, 600000, 32, "sha256").toString("base64"),
        );
      }
      return Response.json({ content: { sha } }, { status: old ? 200 : 201 });
    },
  }),
);
async function call(path, method = "GET", body, token = "", expected = 200) {
  const response = await runtime.dispatchFetch("http://localhost" + path, {
    method,
    headers: {
      "CF-Connecting-IP": "fixture-" + ++calls,
      Origin: calls % 2 ? "https://pgt.example" : "https://pgt.pages.dev",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await response.json();
  assert.equal(response.status, expected, JSON.stringify(value));
  assert.ok(!JSON.stringify(value).includes("pbkdf2-sha256"));
  return value;
}
try {
  const a = await call(
    "/api/app/register",
    "POST",
    {
      mail: "runtime-a@example.com",
      password,
      confirm: password,
      nombre: "A",
      apellidos: "Fixture",
    },
    "",
    201,
  );
  const b = await call(
    "/api/app/register",
    "POST",
    {
      mail: "runtime-b@example.com",
      password,
      confirm: password,
      nombre: "B",
      apellidos: "Fixture",
    },
    "",
    201,
  );
  const bp = "/api/app/users/runtime-b@example.com/";
  await call(bp + "snapshot", "GET", undefined, a.token, 403);
  const path = "PGT/users_data/runtime-a@example.com/user_data.json";
  const profile = JSON.parse(Buffer.from(files.get(path).content, "base64").toString());
  profile.perfil = "entrenador";
  files.set(path, {content: Buffer.from(JSON.stringify(profile)).toString("base64"), sha: (++seq).toString(16).padStart(40,"0")});
  const trainer = await call("/api/app/login", "POST", {
    mail: "runtime-a@example.com",
    password,
  });
  let snap = await call(bp + "snapshot", "GET", undefined, b.token);
  assert.equal(snap.techniques.data.positions.length, 17);
  const competition = {
    fecha_comienzo: "2026-10-13",
    fecha_torneo: "2026-10-23",
    dias_de_entrenamiento: [2, 4],
    ejercicios_por_sesion: 5,
    tiempo_por_tecnica_segundos: 180,
    descanso_entre_ciclos_segundos: 10,
    descanso_entre_tecnicas_segundos: 20,
    alumnos: ["runtime-b@example.com"],
  };
  await call(
    "/api/app/competition",
    "POST",
    { competition, sha: null },
    trainer.token,
  );
  snap = await call(bp + "snapshot", "GET", undefined, b.token);
  assert.equal(snap.plans.length, 1);
  let plan = snap.plans[0];
  const today = madridDate();
  const futureId = plan.data.sessions.find((s) => s.date > today).exercises[0]
    .techniqueId;
  const protectedSessions = structuredClone(
    plan.data.sessions.filter((s) => s.date <= today),
  );
  const futureComments = {
    ...snap.comments.data,
    comments: [{ techniqueId: futureId, comment: "Runtime future comment" }],
  };
  await call(
    bp + "comments",
    "PUT",
    { data: futureComments, sha: snap.comments.sha },
    trainer.token,
  );
  snap = await call(bp + "snapshot", "GET", undefined, b.token);
  plan = snap.plans[0];
  assert.deepEqual(
    plan.data.sessions.filter((s) => s.date <= today),
    protectedSessions,
  );
  assert.ok(
    plan.data.sessions.some(
      (s) =>
        s.date > today &&
        s.exercises.some(
          (e) =>
            e.techniqueId === futureId &&
            e.comment === "Runtime future comment",
        ),
    ),
  );
  const changed = structuredClone(snap.techniques.data);
  changed.positions[0].tecnicas[0].descripcion_del_alumno =
    "Changed after protected snapshot";
  changed.positions
    .flatMap((p) => p.tecnicas)
    .find((t) => t.id === futureId).descripcion_del_alumno =
    "Runtime future only";
  await call(
    bp + "techniques",
    "PUT",
    { data: changed, sha: snap.techniques.sha },
    b.token,
  );
  snap = await call(bp + "snapshot", "GET", undefined, b.token);
  plan = snap.plans[0];
  assert.deepEqual(
    plan.data.sessions.filter((s) => s.date <= today),
    protectedSessions,
  );
  assert.ok(
    plan.data.sessions.some(
      (s) =>
        s.date > today &&
        s.exercises.some(
          (e) =>
            e.techniqueId === futureId &&
            e.descripcion_del_alumno === "Runtime future only",
        ),
    ),
  );
  const manual = structuredClone(plan.data);
  manual.sessions[0].exercises[0].descripcion_del_alumno = "Manual";
  await call(bp + "plan", "PUT", { data: manual, sha: plan.sha }, b.token, 403);
  await call(bp + "plan", "PUT", { data: manual, sha: plan.sha }, b.token, 403);
  let catalog = await call("/api/app/catalog", "GET", undefined, trainer.token);
  const id = catalog.data.plans[0].planId;
  await call(
    "/api/app/assignment",
    "POST",
    { planId: id, alumnos: [], sha: catalog.sha },
    trainer.token,
  );
  snap = await call(bp + "snapshot", "GET", undefined, b.token);
  assert.equal(snap.plans.length, 0);
  assert.deepEqual(snap.index.data.planIds, []);
  catalog = await call("/api/app/catalog", "GET", undefined, trainer.token);
  await call(
    "/api/app/delete-competition",
    "POST",
    { planId: id, sha: catalog.sha },
    trainer.token,
  );
  snap = await call(bp + "snapshot", "GET", undefined, b.token);
  assert.equal(snap.plans.length, 0);
  assert.deepEqual(snap.deletedPlanIds, [id]);
  await call("/api/app/logout", "POST", {}, b.token);
  await call(bp + "snapshot", "GET", undefined, b.token, 401);
  console.log(
    "Aplicación en workerd + SQLite DO: altas con fixture, hash 600000 independiente, roles manuales, comentarios, competición, histórico protegido y actualización futura de textos, plan de solo lectura, CAS, desasignación, borrado y revocación OK. GitHub interceptado; sin datos reales.",
  );
} finally {
  await runtime.dispose();
}
