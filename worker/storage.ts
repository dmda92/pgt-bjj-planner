import { reject } from "./security.ts";
import {
  classifyTransportFailure,
  logGithubDiagnostic,
} from "./diagnostics.ts";
export interface CloudRecord<T = Record<string, unknown>> {
  data: T;
  sha: string;
}
export interface CloudStorageProvider {
  verifyPrivate(): Promise<void>;
  read<T = Record<string, unknown>>(
    path: string,
  ): Promise<CloudRecord<T> | null>;
  write(
    path: string,
    data: unknown,
    expectedSha: string | null,
  ): Promise<string>;
  remove(path: string, expectedSha: string): Promise<void>;
  list?(
    directory: string,
  ): Promise<{ name: string; type: string; sha?: string }[]>;
}
const ROOT = "https://api.github.com/repos/dmda92/pgt-bjj-data";
export function safePath(path: string): string {
  if (
    !path.startsWith("PGT/") ||
    path.length > 400 ||
    !path.endsWith(".json") ||
    path
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          /[\\%?#\x00-\x1f]/.test(part),
      )
  )
    return reject(400, "PATH_FORBIDDEN");
  return path.split("/").map(encodeURIComponent).join("/");
}
function version(sha: string): void {
  if (!/^[0-9a-f]{40}$/.test(sha)) reject(400, "SHA_INVALID");
}
function encoded(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (bytes.length > 65536) return reject(413, "JSON_TOO_LARGE");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
export class GithubContentsStorage implements CloudStorageProvider {
  private token: string;
  private branch: string;
  private transport: typeof fetch;
  private beforeMutation?: () => Promise<void>;
  // Wrap the native global function: calling a stored fetch as this.transport(...)
  // gives it the storage instance as receiver and workerd rejects that invocation.
  constructor(
    token: string,
    branch = "main",
    transport: typeof fetch = (input, init) => fetch(input, init),
    beforeMutation?: () => Promise<void>,
  ) {
    this.token = token;
    this.branch = branch;
    this.transport = transport;
    this.beforeMutation = beforeMutation;
    if (!/^[a-zA-Z0-9_-]+$/.test(branch)) reject(500, "BRANCH_INVALID");
  }
  private async request(
    url: string,
    init: RequestInit = {},
  ): Promise<Response> {
    if (!this.token) return reject(503, "DATA_TOKEN_NOT_CONFIGURED");
    const method = init.method || "GET";
    if (method !== "GET") await this.beforeMutation?.();
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.token}`);
    headers.set("Accept", "application/vnd.github+json");
    headers.set("X-GitHub-Api-Version", "2026-03-10");
    headers.set("User-Agent", "PGT-viability-worker");
    let response: Response;
    const diagnosticId = crypto.randomUUID();
    const context = {
      diagnosticId,
      host: "api.github.com" as const,
      operation:
        url === ROOT
          ? ("repository_metadata" as const)
          : ("json_content" as const),
      method,
    };
    // Only retry idempotent reads, bounded delay; never replay an ambiguous mutation blindly.
    for (let attempt = 0; ; attempt++) {
      const started = Date.now();
      try {
        // workerd rejects redirect:'error' before sending the request. Manual preserves
        // our no-redirect policy without forwarding credentials to another destination.
        response = await this.transport(url, {
          ...init,
          headers,
          redirect: "manual",
          signal: AbortSignal.timeout(15000),
        });
      } catch (error) {
        const failure = classifyTransportFailure(error);
        const retrying =
          method === "GET" &&
          attempt === 0 &&
          ![
            "UNSUPPORTED_REDIRECT_MODE",
            "ABORT_API_UNAVAILABLE",
            "FETCH_INVALID_RECEIVER",
          ].includes(failure.reason);
        logGithubDiagnostic({
          event: "pgt.github.transport_failure",
          ...context,
          ...failure,
          attempt: attempt + 1,
          elapsedMs: Math.max(0, Date.now() - started),
          retrying,
        });
        if (retrying) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          continue;
        }
        return reject(503, "DATA_NETWORK_RETRY");
      }
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        logGithubDiagnostic({
          event: "pgt.github.redirect_rejected",
          ...context,
          attempt: attempt + 1,
          elapsedMs: Math.max(0, Date.now() - started),
          retrying: false,
          httpStatus: response.status,
        });
        return reject(503, "DATA_REDIRECT_REJECTED");
      }
      if (method === "GET" && response.status >= 500 && attempt === 0) {
        await response.body?.cancel();
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      break;
    }
    const reset = Number(response.headers.get("x-ratelimit-reset") || 0);
    const wait = Number(response.headers.get("Retry-After") || 0);
    if (
      response.status === 429 ||
      (response.status === 403 &&
        (wait > 0 || response.headers.get("x-ratelimit-remaining") === "0"))
    )
      return reject(
        429,
        "GITHUB_RATE_LIMIT",
        Math.max(1, wait, Math.ceil(reset - Date.now() / 1000)),
      );
    if (response.status === 401)
      return reject(503, "DATA_TOKEN_INVALID_OR_EXPIRED");
    if (response.status === 403)
      return reject(503, "DATA_TOKEN_PERMISSION_OR_SECONDARY_LIMIT");
    if (response.status === 409 || response.status === 422)
      return reject(409, "DATA_CONFLICT_OR_VALIDATION");
    if (!response.ok && response.status !== 404)
      return reject(503, `DATA_SERVICE_${response.status}`);
    return response;
  }
  async verifyPrivate(): Promise<void> {
    const response = await this.request(ROOT);
    if (response.status === 404)
      return reject(503, "DATA_REPO_NOT_FOUND_OR_TOKEN_DENIED");
    const metadata = (await response.json()) as {
      private?: boolean;
      full_name?: string;
    };
    if (
      metadata.private !== true ||
      metadata.full_name !== "dmda92/pgt-bjj-data"
    )
      reject(503, "DATA_REPO_MUST_BE_PRIVATE");
  }
  async list(
    directory: string,
  ): Promise<{ name: string; type: string; sha?: string }[]> {
    if (
      !/^PGT\/(users_data|users_data\/[a-zA-Z0-9@._+-]+(?:\/training_plans)?)$/.test(
        directory,
      ) ||
      directory.includes("..")
    )
      return reject(400, "PATH_FORBIDDEN");
    const response = await this.request(
      `${ROOT}/contents/${directory.split("/").map(encodeURIComponent).join("/")}?ref=${this.branch}`,
    );
    if (response.status === 404) return [];
    const values = (await response.json()) as { name: string; type: string }[];
    if (!Array.isArray(values)) return reject(502, "REMOTE_DIRECTORY_INVALID");
    return values.map((v) => ({
      name: v.name,
      type: v.type,
      sha: (v as { sha?: string }).sha,
    }));
  }
  async read<T = Record<string, unknown>>(
    path: string,
  ): Promise<CloudRecord<T> | null> {
    const response = await this.request(
      `${ROOT}/contents/${safePath(path)}?ref=${this.branch}`,
    );
    if (response.status === 404) return null;
    const file = (await response.json()) as {
      type?: string;
      encoding?: string;
      content?: string;
      sha?: string;
      size?: number;
    };
    if (
      file.type !== "file" ||
      file.encoding !== "base64" ||
      !file.sha ||
      !file.content ||
      Number(file.size) > 65536
    )
      return reject(502, "REMOTE_JSON_INVALID");
    version(file.sha);
    try {
      const binary = atob(file.content.replace(/\s/g, ""));
      if (binary.length > 65536) reject(413, "REMOTE_JSON_TOO_LARGE");
      const data = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          Uint8Array.from(binary, (c) => c.charCodeAt(0)),
        ),
      ) as T;
      return { data, sha: file.sha };
    } catch {
      return reject(502, "REMOTE_JSON_INVALID");
    }
  }
  async write(
    path: string,
    data: unknown,
    expectedSha: string | null,
  ): Promise<string> {
    if (expectedSha !== null) version(expectedSha);
    const response = await this.request(`${ROOT}/contents/${safePath(path)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "PGT: persist JSON",
        content: encoded(data),
        branch: this.branch,
        ...(expectedSha !== null ? { sha: expectedSha } : {}),
      }),
    });
    if (response.status === 404)
      return reject(503, "DATA_WRITE_DENIED_OR_BRANCH_MISSING");
    const value = (await response.json()) as { content?: { sha?: string } };
    if (!value.content?.sha) return reject(502, "DATA_WRITE_NOT_CONFIRMED");
    version(value.content.sha);
    return value.content.sha;
  }
  async remove(path: string, expectedSha: string): Promise<void> {
    version(expectedSha);
    const response = await this.request(`${ROOT}/contents/${safePath(path)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "PGT: remove probe JSON",
        sha: expectedSha,
        branch: this.branch,
      }),
    });
    if (response.status === 404) return reject(409, "DATA_ALREADY_REMOVED");
  }
}
