import {test} from "node:test";
import assert from "node:assert/strict";
import {pbkdf2Sync} from "node:crypto";
import {passwordHash, passwordMatches} from "../worker/security.ts";
import {isPbkdf2IterationLimit} from "../worker/diagnostics.ts";

test("Fallback conserva PBKDF2 SHA256/600000/256, formato y contraseñas Unicode", async () => {
    const original = crypto.subtle.deriveBits;
    crypto.subtle.deriveBits = async () => {
        throw new DOMException(
            "PBKDF2 iteration count exceeds maximum of 100000",
            "NotSupportedError",
        );
    };
    try {
        const password = "contraseña-sintética-日本語",
            salt = "synthetic-known-salt";
        const actual = await passwordHash(password, salt);
        const expected = pbkdf2Sync(password, salt, 600000, 32, "sha256").toString(
            "base64",
        );
        assert.ok(actual === `pbkdf2-sha256$600000$${salt}$${expected}`);
        assert.equal(await passwordMatches(password, actual), true);
        assert.equal(await passwordMatches("contraseña-equivocada", actual), false);
    } finally {
        crypto.subtle.deriveBits = original;
    }
});
test("Fallos criptográficos distintos del límite no se ocultan con fallback", async () => {
    const original = crypto.subtle.deriveBits;
    const failure = new DOMException(
        "synthetic operation failure",
        "OperationError",
    );
    crypto.subtle.deriveBits = async () => {
        throw failure;
    };
    try {
        await assert.rejects(
            passwordHash("synthetic-password"),
            (error) => error === failure,
        );
    } finally {
        crypto.subtle.deriveBits = original;
    }
    assert.equal(
        isPbkdf2IterationLimit(
            new DOMException("unsupported hash", "NotSupportedError"),
        ),
        false,
    );
    assert.equal(
        isPbkdf2IterationLimit(new Error("PBKDF2 maximum iterations")),
        false,
    );
});
