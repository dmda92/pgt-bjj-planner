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
import fs from 'node:fs';
try {
 const mail='pgt_test_recovery_runtime@example.com',root='PGT/users_data/'+mail;
 const auth=await call('/api/app/register','POST',{mail,password,confirm:password,nombre:'PGT_TEST',apellidos:'Runtime'},'',201);
 const read=p=>{const r=files.get(p);return r?{data:JSON.parse(Buffer.from(r.content,'base64').toString()),sha:r.sha}:null;};
 const t=read(root+'/tecnics.json'),original=structuredClone(t.data);t.data.positions=[];
 await call('/api/app/users/'+mail+'/techniques','PUT',{data:t.data,sha:t.sha},auth.token);
 const comp={planId:crypto.randomUUID(),fecha_comienzo:'2026-10-17',fecha_torneo:'2026-12-17',dias_de_entrenamiento:[1,2,3,4,5,6,7],alumnos:[mail],ejercicios_por_sesion:100,tiempo_por_tecnica_segundos:1,descanso_entre_ciclos_segundos:1,descanso_entre_tecnicas_segundos:1};
 files.set('PGT/master_data/plans.json',{sha:'9'.repeat(40),content:Buffer.from(JSON.stringify({schemaVersion:1,revision:1,updatedAt:new Date().toISOString(),plans:[comp],deletedPlanIds:[]})).toString('base64')});
 const snapshot=()=>call('/api/app/users/'+mail+'/snapshot','GET',undefined,auth.token);
 const empty=await snapshot();assert.equal(empty.planIssues[0].code,'NO_TRAINABLE_TECHNIQUES');assert.equal(empty.plans.length,0);assert.equal(empty.profile.data.mail,mail);
 const source={...original,positions:[{...original.positions[0],tecnicas:original.positions[0].tecnicas.slice(0,1)}]};
 await call('/api/app/users/'+mail+'/techniques','PUT',{data:source,sha:read(root+'/tecnics.json').sha},auth.token);
 const generated=await snapshot();assert.deepEqual(generated.planIssues,[]);assert.equal(generated.plans[0].data.sessions.length,61);
 const path=root+'/training_plans/plan_'+comp.planId+'.json',old=structuredClone(files.get(path));
 const update=async(text,sha=read(root+'/tecnics.json').sha)=>{const data=read(root+'/tecnics.json').data;data.positions[0].tecnicas[0].descripcion_del_alumno=text;return call('/api/app/users/'+mail+'/techniques','PUT',{data,sha},auth.token);};
 const long='PGT_TEST_LARGO_á🙂 https://example.com/video '.repeat(50);
 const large=await update(long);assert.equal(large.planIssues[0].code,'PLAN_TOO_LARGE');assert.ok(large.planIssues[0].size.bytes>16000000);assert.deepEqual(files.get(path),old);
 const blocked=await snapshot();assert.equal(blocked.planIssues[0].code,'PLAN_TOO_LARGE');assert.equal(blocked.techniques.data.positions[0].tecnicas[0].descripcion_del_alumno,long);
 await call('/api/app/login','POST',{mail,password});
 // Explicit HTTP check: the request helper asserts 409 rather than masking it.
 const data=read(root+'/tecnics.json').data;
 await call('/api/app/users/'+mail+'/techniques','PUT',{data,sha:'0'.repeat(40)},auth.token,409);
 await update('PGT_TEST_REDUCIDO');const recovered=await snapshot();assert.deepEqual(recovered.planIssues,[]);assert.ok(recovered.plans[0].data.sessions.flatMap(s=>s.exercises).every(e=>e.descripcion_del_alumno==='PGT_TEST_REDUCIDO'));
 const stable=structuredClone(files.get(path));await snapshot();assert.deepEqual(files.get(path),stable);
 await call('/api/app/training-day?date=2026-10-17','GET',undefined,auth.token,403);
 const teacherMail='pgt_test_day_teacher@example.com';
 const teacher=await call('/api/app/register','POST',{mail:teacherMail,password,confirm:password,nombre:'PGT_TEST',apellidos:'Trainer'},'',201);
 const profilePath='PGT/users_data/'+teacherMail+'/user_data.json',teacherProfile=read(profilePath);teacherProfile.data.perfil='entrenador';
 files.set(profilePath,{sha:'e'.repeat(40),content:Buffer.from(JSON.stringify(teacherProfile.data)).toString('base64')});
 const day=await call('/api/app/training-day?date=2026-10-17','GET',undefined,teacher.token);
 assert.equal(day.groups.length,1);assert.equal(day.groups[0].students[0].mail,mail);
 assert.ok(files.has(root+'/training_plans/structure_'+comp.planId+'.json'));
 assert.equal(JSON.stringify(day).includes('PGT_TEST_REDUCIDO'),false);
 assert.deepEqual(files.get(path),stable);
 const again=await call('/api/app/training-day?date=2026-10-17','GET',undefined,teacher.token);assert.deepEqual(again,day);
 console.log('workerd: trainer-only daily report, derived index, repeat read, no source mutations PASS.');
 console.log(`workerd: BUG-001 empty catalogue recoverable; BUG-005 ${large.planIssues[0].size.bytes} bytes rejected, catalogue downloadable, correction/CAS/idempotency verified. GitHub transport isolated.`);
} finally {await runtime.dispose();}
