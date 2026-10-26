import {test} from "node:test";
import assert from "node:assert/strict";
import {pbkdf2Sync} from "node:crypto";
import {requestContext, unexpectedDiagnostic} from "../worker/diagnostics.ts";
import {passwordHash, passwordMatches} from "../worker/security.ts";
import {ProbeSecurity, type Env} from "../worker/index.ts";
import type {CloudStorageProvider} from "../worker/storage.ts";

test("Hash nativo a 600000 iteraciones coincide con oracle independiente y mantiene formato", async () => {
    const password = "synthetic-test-password",
        salt = "synthetic-known-salt";
    const stages: string[] = [];
    const hash = await passwordHash(password, salt, (stage) =>
        stages.push(stage),
    );
    const expected = pbkdf2Sync(password, salt, 600000, 32, "sha256").toString(
        "base64",
    );
    assert.ok(hash === `pbkdf2-sha256$600000$${salt}$${expected}`);
    assert.deepEqual(stages, [
        "password_key_import",
        "password_derive_bits",
        "password_encode",
    ]);
    assert.equal(await passwordMatches(password, hash), true);
    assert.equal(await passwordMatches("synthetic-wrong-password", hash), false);
});
test("Diagnóstico inesperado clasifica derivación, límites e importación sin mensajes privados", () => {
    const context = requestContext(
        new Request("https://example/api/admin/test-user", {method: "POST"}),
    );
    context.stage = "password_derive_bits";
    const privateText =
        "secret-password secret-hash secret-token Authorization: private@mail.test";
    const report = unexpectedDiagnostic(
        new DOMException(privateText, "OperationError"),
        context,
    );
    assert.equal(report.errorName, "OperationError");
    assert.equal(report.reason, "PASSWORD_DERIVATION_FAILURE");
    assert.ok(!JSON.stringify(report).includes(privateText));
    assert.equal(
        unexpectedDiagnostic(
            new DOMException(
                "PBKDF2 iteration count exceeds maximum of 100000",
                "NotSupportedError",
            ),
            context,
        ).reason,
        "PBKDF2_ITERATION_LIMIT",
    );
    context.stage = "password_key_import";
    assert.equal(
        unexpectedDiagnostic(new TypeError(privateText), context).reason,
        "PASSWORD_KEY_IMPORT_FAILURE",
    );
});
test("Excepción inesperada en alta devuelve UUID correlacionado y registra solo etapa segura", async () => {
    const records = new Map<string, unknown>();
    const storage = {
        get: async (k: string) => records.get(k),
        put: async (k: string, v: unknown) => {
            records.set(k, v);
        },
        delete: async (k: string) => records.delete(k),
        list: async () => new Map(),
    };
    const provider = {
        verifyPrivate: async () => {
            throw new Error(
                "synthetic-password synthetic-token pbkdf2-sha256$secret private@mail.test Authorization",
            );
        },
    } as unknown as CloudStorageProvider;
    const admin = "synthetic-admin-key-at-least-32-characters";
    const instance = new ProbeSecurity(
        {storage} as unknown as DurableObjectState,
        {PROBE_ADMIN_KEY: admin, ALLOWED_ORIGIN: "https://pgt.example"} as Env,
        () => provider,
    );
    const lines: string[] = [];
    const original = console.error;
    console.error = (line: unknown) => lines.push(String(line));
    try {
        const response = await instance.fetch(
            new Request("https://api.example/api/admin/test-user", {
                method: "POST",
                headers: {
                    Authorization: "Bearer " + admin,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    mail: "synthetic@example.com",
                    password: "synthetic-password",
                }),
            }),
        );
        assert.equal(response.status, 500);
        const body = (await response.json()) as {
            error: string;
            diagnosticId: string;
        };
        assert.equal(body.error, "INTERNAL_ERROR");
        assert.match(body.diagnosticId, /^[0-9a-f-]{36}$/);
        assert.equal(lines.length, 1);
        const diagnostic = JSON.parse(lines[0]);
        assert.equal(diagnostic.diagnosticId, body.diagnosticId);
        assert.equal(diagnostic.stage, "verify_private_repository");
        assert.equal(diagnostic.operation, "create_test_user");
        for (const secret of [
            "synthetic-password",
            "synthetic-token",
            "pbkdf2-sha256",
            "private@mail.test",
            "synthetic@example.com",
            admin,
            "Authorization",
        ])
            assert.ok(!lines[0].includes(secret));
    } finally {
        console.error = original;
    }
});
