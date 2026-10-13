import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { isPbkdf2IterationLimit } from "./diagnostics.ts";
export class ApiError extends Error {
  status: number;
  retryAfter?: number;
  constructor(status: number, code: string, retryAfter?: number) {
    super(code);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
export function reject(
  status: number,
  code: string,
  retryAfter?: number,
): never {
  throw new ApiError(status, code, retryAfter);
}
export function normalizedMail(value: unknown): string {
  if (typeof value !== "string") return reject(400, "MAIL_INVALID");
  const result = value.trim().toLowerCase();
  if (
    result.length > 180 ||
    result.includes("..") ||
    !/^[a-z0-9][a-z0-9._+-]{0,63}@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,24}$/.test(
      result,
    )
  )
    return reject(400, "MAIL_INVALID");
  return result;
}
export function equal(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
export function opaqueToken(): string {
  return base64(crypto.getRandomValues(new Uint8Array(32)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
export async function fingerprint(value: string): Promise<string> {
  return base64(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  );
}
export type PasswordStage =
  "password_key_import" | "password_derive_bits" | "password_encode";
export async function passwordHash(
  value: unknown,
  salt = opaqueToken(),
  onStage?: (stage: PasswordStage) => void,
): Promise<string> {
  if (typeof value !== "string" || value.length < 12 || value.length > 128)
    return reject(400, "PASSWORD_LENGTH_12_128");
  onStage?.("password_key_import");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(value),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  onStage?.("password_derive_bits");
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          hash: "SHA-256",
          salt: new TextEncoder().encode(salt),
          iterations: 600000,
        },
        key,
        256,
      ),
    );
  } catch (error) {
    // Some deployed Workers cap native PBKDF2 iterations. Keep the identical KDF,
    // salt encoding, work factor and output length; never lower iterations.
    if (!isPbkdf2IterationLimit(error)) throw error;
    const passwordBytes = new TextEncoder().encode(value),
      saltBytes = new TextEncoder().encode(salt);
    try {
      bytes = await pbkdf2Async(sha256, passwordBytes, saltBytes, {
        c: 600000,
        dkLen: 32,
        asyncTick: 10,
      });
    } finally {
      passwordBytes.fill(0);
      saltBytes.fill(0);
    }
  }
  onStage?.("password_encode");
  try {
    return `pbkdf2-sha256$600000$${salt}$${base64(bytes)}`;
  } finally {
    bytes.fill(0);
  }
}
export async function passwordMatches(
  value: unknown,
  stored: string,
  onStage?: (stage: PasswordStage) => void,
): Promise<boolean> {
  const [kind, rounds, salt, hash, ...extra] = stored.split("$");
  if (
    kind !== "pbkdf2-sha256" ||
    rounds !== "600000" ||
    !salt ||
    !hash ||
    extra.length
  )
    return false;
  return equal(await passwordHash(value, salt, onStage), stored);
}
export function ownResource(sessionMail: string, requestedMail: string): void {
  if (normalizedMail(sessionMail) !== normalizedMail(requestedMail))
    reject(403, "OTHER_USER_FORBIDDEN");
}
export async function jsonBody(
  request: Request,
  maxBytes = 16384,
): Promise<Record<string, unknown>> {
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    return reject(415, "JSON_REQUIRED");
  const reader = request.body?.getReader();
  if (!reader) return reject(400, "BODY_REQUIRED");
  const parts: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > maxBytes) {
      await reader.cancel();
      reject(413, "BODY_TOO_LARGE");
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  try {
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (!value || typeof value !== "object" || Array.isArray(value))
      reject(400, "JSON_OBJECT_REQUIRED");
    return value as Record<string, unknown>;
  } catch {
    return reject(400, "JSON_INVALID");
  }
}
export function onlyFields(
  value: Record<string, unknown>,
  fields: string[],
): void {
  if (Object.keys(value).some((key) => !fields.includes(key)))
    reject(400, "UNEXPECTED_FIELD");
}
