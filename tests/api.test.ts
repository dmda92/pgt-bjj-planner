import { test } from "node:test";
import assert from "node:assert/strict";
import { ProbeSecurity, type Env } from "../worker/index.ts";
import type { CloudStorageProvider, CloudRecord } from "../worker/storage.ts";
import {
  normalizedMail,
  passwordHash,
  passwordMatches,
  fingerprint,
} from "../worker/security.ts";
const admin = "admin-probe-example-32-characters-long";
function fixture(origins = "https://pgt.example") {
  const transient = new Map<string, unknown>();
  const business = new Map<string, CloudRecord>();
  let writes = 0,
    privateChecks = 0;
  const auxiliary = {
    get: async (key: string) => transient.get(key),
    put: async (key: string, value: unknown) => {
      transient.set(key, value);
    },
    delete: async (key: string) => transient.delete(key),
    list: async (options?: { prefix?: string }) =>
      new Map(
        [...transient].filter(([key]) => key.startsWith(options?.prefix || "")),
      ),
  };
  const provider: CloudStorageProvider = {
    verifyPrivate: async () => {
      privateChecks++;
    },
    read: async <T>(key: string) =>
      (business.get(key) as CloudRecord<T> | undefined) ?? null,
    write: async (key, data, expected) => {
      assert.equal(business.get(key)?.sha ?? null, expected);
      writes++;
      const sha = writes.toString(16).padStart(40, "0");
      business.set(key, { data: data as Record<string, unknown>, sha });
      return sha;
    },
    remove: async (key, expected) => {
      assert.equal(business.get(key)?.sha, expected);
      business.delete(key);
    },
  };
  const env = {
    PROBE_ADMIN_KEY: admin,
    ALLOWED_ORIGINS: origins,
    DATA_BRANCH: "main",
  } as Env;
  const instance = new ProbeSecurity(
    { storage: auxiliary } as unknown as DurableObjectState,
    env,
    () => provider,
  );
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    token?: string,
    origin?: string,
  ) =>
    instance.fetch(
      new Request("https://api.example" + path, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(origin ? { Origin: origin } : {}),
        },
        body: body && method !== "GET" ? JSON.stringify(body) : undefined,
      }),
    );
  return {
    call,
    business,
    transient,
    instance,
    writes: () => writes,
    checks: () => privateChecks,
  };
}
test("Normalización y validación de correo impide rutas ambiguas", () => {
  assert.equal(normalizedMail(" A@Example.com "), "a@example.com");
  for (const value of [
    "a/xx@example.com",
    "../a@example.com",
    "a%2f@example.com",
    null,
    "a..b@example.com",
  ])
    assert.throws(() => normalizedMail(value));
});
test("Hash robusto con sal distinta, verificable y contraseña incorrecta rechazada", async () => {
  const first = await passwordHash("a-strong-test-password");
  const second = await passwordHash("a-strong-test-password");
  assert.notEqual(first, second);
  assert.equal(await passwordMatches("a-strong-test-password", first), true);
  assert.equal(await passwordMatches("a-wrong-test-password", first), false);
  await assert.rejects(passwordHash("short"));
});
test("CORS, administración y APIs genéricas se bloquean antes de tocar GitHub", async () => {
  const f = fixture();
  assert.equal(
    (
      await f.call(
        "/api/admin/check",
        "POST",
        {},
        admin,
        "https://evil.example",
      )
    ).status,
    403,
  );
  assert.equal((await f.call("/api/admin/check", "POST", {})).status, 403);
  assert.equal((await f.call("/api/github?path=any")).status, 404);
  assert.equal(f.checks(), 0);
});
test("Payload de alta no puede elevar rol; administración no sobrescribe perfiles", async () => {
  const f = fixture();
  assert.equal(
    (
      await f.call(
        "/api/admin/test-user",
        "POST",
        {
          mail: "a@example.com",
          password: "poc-long-password",
          perfil: "entrenador",
        },
        admin,
      )
    ).status,
    400,
  );
  assert.equal(f.writes(), 0);
  assert.equal(
    (
      await f.call(
        "/api/admin/test-user",
        "POST",
        { mail: "a@example.com", password: "poc-long-password" },
        admin,
      )
    ).status,
    201,
  );
  assert.equal(
    (
      await f.call(
        "/api/admin/test-user",
        "POST",
        { mail: "a@example.com", password: "poc-long-password" },
        admin,
      )
    ).status,
    409,
  );
  assert.equal(f.writes(), 1);
});
test("Login, CRUD JSON por SHA, no-op sin commits, acceso cruzado y logout", async () => {
  const f = fixture();
  assert.equal(
    (
      await f.call(
        "/api/admin/test-user",
        "POST",
        { mail: "a@example.com", password: "poc-long-password" },
        admin,
      )
    ).status,
    201,
  );
  const login = await f.call("/api/auth/login", "POST", {
    mail: "a@example.com",
    password: "poc-long-password",
  });
  assert.equal(login.status, 200);
  const data = (await login.json()) as { token: string };
  assert.ok(!JSON.stringify(data).includes("pbkdf2"));
  const token = data.token;
  const path = "/api/probe/users/a@example.com/json";
  assert.equal((await f.call(path, "GET", undefined, token)).status, 404);
  const created = await f.call(
    path,
    "PUT",
    { value: "initial", sha: null },
    token,
  );
  assert.equal(created.status, 200);
  const record = (await created.json()) as { sha: string };
  assert.equal(
    (await f.call(path, "PUT", { value: "updated", sha: record.sha }, token))
      .status,
    200,
  );
  assert.equal(
    (await f.call(path, "PUT", { value: "incorrect", sha: record.sha }, token))
      .status,
    409,
  );
  const current = (await (
    await f.call(path, "GET", undefined, token)
  ).json()) as { sha: string; data: { value: string } };
  assert.equal(current.data.value, "updated");
  const count = f.writes();
  assert.equal(
    (await f.call(path, "PUT", { value: "updated", sha: current.sha }, token))
      .status,
    200,
  );
  assert.equal(f.writes(), count);
  for (const method of ["GET", "PUT", "DELETE"])
    assert.equal(
      (
        await f.call(
          "/api/probe/users/b@example.com/json",
          method,
          { value: "attack", sha: null },
          token,
        )
      ).status,
      403,
    );
  assert.equal(
    (await f.call(path, "DELETE", { sha: current.sha }, token)).status,
    200,
  );
  assert.equal(
    (await f.call("/api/auth/logout", "POST", {}, token)).status,
    200,
  );
  assert.equal((await f.call(path, "GET", undefined, token)).status, 401);
});
test("Sesión caducada no puede leer y se conserva exclusividad de datos auxiliares", async () => {
  const f = fixture();
  const token = "a".repeat(43);
  f.transient.set("session:" + (await fingerprint(token)), {
    mail: "a@example.com",
    expiresAt: Date.now() - 1,
  });
  assert.equal(
    (
      await f.call(
        "/api/probe/users/a@example.com/json",
        "GET",
        undefined,
        token,
      )
    ).status,
    401,
  );
  assert.equal(f.checks(), 0);
  assert.equal(f.business.size, 0);
});
test("Límite de frecuencia proporciona Retry-After sin nuevas llamadas remotas", async () => {
  const f = fixture();
  let response: Response | undefined;
  for (let i = 0; i < 31; i++) response = await f.call("/api/unknown");
  assert.equal(response!.status, 429);
  assert.ok(Number(response!.headers.get("Retry-After")) > 0);
  assert.equal(f.checks(), 0);
});


test("Origin mismatch reproduces GET success vs login/write rejection independently of payload", async () => {
  const f = fixture("https://replace-with-your-worker.workers.dev");
  const read = await f.call("/api/app/catalog", "GET");
  assert.equal(read.status, 401);
  const checks = f.checks();
  for (const path of ["/api/app/login", "/api/app/logout", "/api/app/users/a@example.com/profile"]) {
    const res = await f.call(path, "POST", { peso: -1 }, "", "https://pgt.example");
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as any).error, "ORIGIN_FORBIDDEN");
  }
  assert.equal(f.checks(), checks);
});

test("Exact Worker/Pages origins admit preflight and login before/after logout, hostile origins blocked", async () => {
  const f = fixture("https://pgt.example, https://pgt.pages.dev");
  for (const origin of ["https://pgt.example", "https://pgt.pages.dev"]) {
    const preflight = await f.call("/api/app/login", "OPTIONS", undefined, undefined, origin);
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), origin);
    assert.match(preflight.headers.get("Access-Control-Allow-Headers")!, /Authorization/);
    for (const path of ["/api/app/login", "/api/app/logout"]) {
      const res = await f.call(path, "POST", {mail:"missing@example.com", password:"synthetic-password"}, undefined, origin);
      assert.notEqual(((await res.json()) as any).error, "ORIGIN_FORBIDDEN");
      assert.equal(res.headers.get("Access-Control-Allow-Origin"), origin);
    }
  }
  for (const origin of ["null", "https://pgt.example.evil.test", "https://preview.pgt.pages.dev", "http://pgt.example", "https://evil.test"]) {
    const res = await f.call("/api/app/login", "OPTIONS", undefined, undefined, origin);
    assert.equal(res.status, 403);
    assert.equal(res.headers.has("Access-Control-Allow-Origin"), false);
  }
});
