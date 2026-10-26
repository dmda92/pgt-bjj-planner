// Closed vocabulary: never log raw errors, stack traces, URLs, paths, headers or response bodies.
const errorNames = new Set([
  "TypeError",
  "Error",
  "AbortError",
  "TimeoutError",
  "NetworkError",
  "DOMException",
  "NotSupportedError",
  "OperationError",
  "InvalidAccessError",
  "DataError",
  "SyntaxError",
  "RangeError",
  "ReferenceError",
]);
const transportCodes = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);
export interface TransportFailure {
  reason: string;
  errorName: string;
  causeName?: string;
  transportCode?: string;
}
function fields(error: unknown): {
  name: string;
  message: string;
  code: string;
  cause: unknown;
} {
  try {
    if (!error || typeof error !== "object")
      return { name: "UnknownError", message: "", code: "", cause: undefined };
    const value = error as {
      name?: unknown;
      message?: unknown;
      code?: unknown;
      cause?: unknown;
    };
    return {
      name:
        typeof value.name === "string" && errorNames.has(value.name)
          ? value.name
          : "UnknownError",
      message: typeof value.message === "string" ? value.message : "",
      code:
        typeof value.code === "string" && transportCodes.has(value.code)
          ? value.code
          : "",
      cause: value.cause,
    };
  } catch {
    return { name: "UnknownError", message: "", code: "", cause: undefined };
  }
}
export function classifyTransportFailure(error: unknown): TransportFailure {
  const root = fields(error),
    cause = fields(root.cause),
    nested = fields(cause.cause);
  const names = [root, cause, nested];
  const messages = names.map((value) => value.message).join(" ");
  const code = names.find((value) => value.code)?.code;
  let reason = "NETWORK_OR_RUNTIME_FAILURE";
  if (
    /redirect/i.test(messages) &&
    /invalid|unsupported|not.*implement/i.test(messages)
  )
    reason = "UNSUPPORTED_REDIRECT_MODE";
  else if (
    /AbortSignal\.timeout|AbortController/i.test(messages) &&
    /not a function|not defined|undefined/i.test(messages)
  )
    reason = "ABORT_API_UNAVAILABLE";
  else if (
    /illegal invocation|invalid.*receiver|called.*incorrect.*this/i.test(
      messages,
    )
  )
    reason = "FETCH_INVALID_RECEIVER";
  else if (
    names.some((value) => value.name === "TimeoutError") ||
    code === "ETIMEDOUT"
  )
    reason = "FETCH_TIMEOUT";
  else if (names.some((value) => value.name === "AbortError"))
    reason = "FETCH_ABORTED";
  else if (
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    /dns|resolve.*host/i.test(messages)
  )
    reason = "DNS_FAILURE";
  else if (
    code?.includes("CERT") ||
    code?.includes("TLS") ||
    /certificate|\btls\b|\bssl\b/i.test(messages)
  )
    reason = "TLS_FAILURE";
  else if (code === "ECONNRESET") reason = "CONNECTION_RESET";
  else if (code === "ECONNREFUSED") reason = "CONNECTION_REFUSED";
  else if (code === "ENETUNREACH" || code === "EHOSTUNREACH")
    reason = "NETWORK_UNREACHABLE";
  return {
    reason,
    errorName: root.name,
    ...(cause.name !== "UnknownError" ? { causeName: cause.name } : {}),
    ...(code ? { transportCode: code } : {}),
  };
}
export interface GithubDiagnostic extends Partial<TransportFailure> {
  event: "pgt.github.transport_failure" | "pgt.github.redirect_rejected";
  diagnosticId: string;
  host: "api.github.com";
  operation: "repository_metadata" | "json_content";
  method: string;
  attempt: number;
  elapsedMs: number;
  retrying: boolean;
  httpStatus?: number;
}
export function logGithubDiagnostic(diagnostic: GithubDiagnostic): void {
  console.error(JSON.stringify(diagnostic));
}

export type RequestStage =
  | "dispatch"
  | "validate_origin"
  | "throttle"
  | "route"
  | "authorize_admin"
  | "parse_body"
  | "validate_body"
  | "password_key_import"
  | "password_derive_bits"
  | "password_encode"
  | "verify_private_repository"
  | "read_user_profile"
  | "write_user_profile"
  | "validate_credentials"
  | "create_session"
  | "validate_session"
  | "revoke_session"
  | "authorize_resource"
  | "read_probe_json"
  | "write_probe_json"
  | "delete_probe_json";
export interface RequestContext {
  diagnosticId: string;
  operation: string;
  method: string;
  stage: RequestStage;
  started: number;
}
export function isPbkdf2IterationLimit(error: unknown): boolean {
  const root = fields(error),
    cause = fields(root.cause),
    message = root.message + " " + cause.message;
  return (
    root.name === "NotSupportedError" &&
    /pbkdf2|iteration/i.test(message) &&
    /limit|maximum|too (?:many|large)|exceed|100.?000/i.test(message)
  );
}
export function requestContext(request: Request): RequestContext {
  const path = new URL(request.url).pathname;
  const operation =
    path === "/api/admin/test-user"
      ? "create_test_user"
      : path === "/api/admin/check"
        ? "admin_check"
        : path === "/api/auth/login"
          ? "login"
          : path === "/api/auth/logout"
            ? "logout"
            : /^\/api\/probe\/users\/[^/]+\/json$/.test(path)
              ? "probe_json"
              : "other";
  return {
    diagnosticId: crypto.randomUUID(),
    operation,
    method: ["GET", "POST", "PUT", "DELETE", "OPTIONS"].includes(request.method)
      ? request.method
      : "OTHER",
    stage: "dispatch",
    started: Date.now(),
  };
}
export function unexpectedDiagnostic(error: unknown, context: RequestContext) {
  const root = fields(error),
    cause = fields(root.cause);
  const message = root.message + " " + cause.message;
  let reason = "UNEXPECTED_RUNTIME_FAILURE";
  if (
    /pbkdf2|iteration/i.test(message) &&
    /limit|maximum|too (?:many|large)|exceed|100.?000/i.test(message)
  )
    reason = "PBKDF2_ITERATION_LIMIT";
  else if (context.stage === "password_derive_bits")
    reason = "PASSWORD_DERIVATION_FAILURE";
  else if (context.stage === "password_key_import")
    reason = "PASSWORD_KEY_IMPORT_FAILURE";
  else if (context.stage === "password_encode")
    reason = "PASSWORD_ENCODING_FAILURE";
  else if (root.name === "SyntaxError") reason = "JSON_DECODING_FAILURE";
  else if (context.stage === "parse_body") reason = "REQUEST_BODY_FAILURE";
  return {
    event: "pgt.request.unexpected_error",
    diagnosticId: context.diagnosticId,
    operation: context.operation,
    method: context.method,
    stage: context.stage,
    errorName: root.name,
    ...(cause.name !== "UnknownError" ? { causeName: cause.name } : {}),
    reason,
    elapsedMs: Math.max(0, Date.now() - context.started),
  };
}
export function logUnexpectedDiagnostic(
  error: unknown,
  context: RequestContext,
): void {
  console.error(JSON.stringify(unexpectedDiagnostic(error, context)));
}
