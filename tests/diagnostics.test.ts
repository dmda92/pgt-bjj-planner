import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTransportFailure } from "../worker/diagnostics.ts";
import { GithubContentsStorage } from "../worker/storage.ts";
import { ApiError } from "../worker/security.ts";

test("Diagnóstico clasifica incompatibilidad de redirect, timeout, DNS, TLS e invocación", () => {
  assert.equal(
    classifyTransportFailure(
      new TypeError("Invalid redirect value, must be one of follow or manual"),
    ).reason,
    "UNSUPPORTED_REDIRECT_MODE",
  );
  assert.equal(
    classifyTransportFailure(
      new TypeError("AbortSignal.timeout is not a function"),
    ).reason,
    "ABORT_API_UNAVAILABLE",
  );
  assert.equal(
    classifyTransportFailure(new TypeError("Illegal invocation")).reason,
    "FETCH_INVALID_RECEIVER",
  );
  assert.equal(
    classifyTransportFailure(new DOMException("timeout", "TimeoutError"))
      .reason,
    "FETCH_TIMEOUT",
  );
  assert.equal(
    classifyTransportFailure(new DOMException("abort", "AbortError")).reason,
    "FETCH_ABORTED",
  );
  assert.equal(
    classifyTransportFailure(
      new Error("fetch failed", {
        cause: Object.assign(new Error("private detail"), {
          code: "ENOTFOUND",
        }),
      }),
    ).reason,
    "DNS_FAILURE",
  );
  assert.equal(
    classifyTransportFailure(
      Object.assign(new Error("private detail"), { code: "CERT_HAS_EXPIRED" }),
    ).reason,
    "TLS_FAILURE",
  );
});
test("Clasificación nunca incluye mensajes, stacks ni códigos arbitrarios privados", () => {
  const privateValue =
    "ghp_secret-probe password-private a@example.com Authorization: Bearer value";
  const error = {
    name: privateValue,
    message: privateValue,
    code: privateValue,
    stack: privateValue,
    cause: { name: "Error", message: privateValue },
  };
  const value = JSON.stringify(classifyTransportFailure(error));
  assert.ok(!value.includes(privateValue));
  assert.ok(!value.includes("ghp_"));
  assert.ok(!value.includes("example.com"));
  assert.equal(
    classifyTransportFailure({
      get message() {
        throw Error("private");
      },
    }).errorName,
    "UnknownError",
  );
});
test("Logs de fallo están correlacionados y no exponen token, correo, URL, payload ni error crudo", async () => {
  const logs: string[] = [];
  const original = console.error;
  console.error = (value: unknown) => logs.push(String(value));
  const token = "github-token-private";
  const privateError = new Error(
    "password-private https://evil/a@example.com Authorization Bearer " + token,
  );
  try {
    await assert.rejects(
      new GithubContentsStorage(token, "main", async () => {
        throw privateError;
      }).write(
        "PGT/users_data/a@example.com/viability.json",
        { value: "payload-private" },
        "1".repeat(40),
      ),
      (e: unknown) =>
        e instanceof ApiError && e.message === "DATA_NETWORK_RETRY",
    );
    assert.equal(logs.length, 1);
    const entry = JSON.parse(logs[0]);
    assert.equal(entry.operation, "json_content");
    assert.equal(entry.attempt, 1);
    assert.equal(entry.retrying, false);
    assert.ok(entry.diagnosticId);
    for (const privatePart of [
      token,
      "password-private",
      "a@example.com",
      "payload-private",
      "Authorization",
      "https://evil",
    ])
      assert.ok(!logs[0].includes(privatePart));
  } finally {
    console.error = original;
  }
});
test("Petición usa manual y timeout; redirección se rechaza sin reenviar secretos ni registrar Location", async () => {
  let calls = 0;
  const logs: string[] = [];
  const original = console.error;
  console.error = (value: unknown) => logs.push(String(value));
  try {
    const provider = new GithubContentsStorage(
      "private-token",
      "main",
      async (_url, init) => {
        calls++;
        assert.equal(init?.redirect, "manual");
        assert.ok(init?.signal instanceof AbortSignal);
        return new Response("private-body", {
          status: 302,
          headers: { Location: "https://evil.example/private-token" },
        });
      },
    );
    await assert.rejects(
      provider.verifyPrivate(),
      (e: unknown) =>
        e instanceof ApiError && e.message === "DATA_REDIRECT_REJECTED",
    );
    assert.equal(calls, 1);
    assert.equal(JSON.parse(logs[0]).httpStatus, 302);
    assert.ok(!logs[0].includes("private-token"));
    assert.ok(!logs[0].includes("evil.example"));
    assert.ok(!logs[0].includes("private-body"));
  } finally {
    console.error = original;
  }
});
test("Fallos deterministas de runtime no se reintentan; errores transitorios comparten diagnosticId", async () => {
  const logs: string[] = [];
  const original = console.error;
  console.error = (value: unknown) => logs.push(String(value));
  try {
    let calls = 0;
    await assert.rejects(
      new GithubContentsStorage("token", "main", async () => {
        calls++;
        throw new TypeError("Invalid redirect value");
      }).verifyPrivate(),
    );
    assert.equal(calls, 1);
    assert.equal(JSON.parse(logs[0]).reason, "UNSUPPORTED_REDIRECT_MODE");
    logs.length = 0;
    await assert.rejects(
      new GithubContentsStorage("token", "main", async () => {
        throw Object.assign(new Error("private"), { code: "ECONNRESET" });
      }).verifyPrivate(),
    );
    assert.equal(logs.length, 2);
    const entries = logs.map((line) => JSON.parse(line));
    assert.equal(entries[0].diagnosticId, entries[1].diagnosticId);
    assert.deepEqual(
      entries.map((value) => value.retrying),
      [true, false],
    );
  } finally {
    console.error = original;
  }
});
