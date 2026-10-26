/** Exact origins only. Never infer trust from Host, request URL or a suffix. */
export function allowedOrigins(env: { ALLOWED_ORIGIN?: string; ALLOWED_ORIGINS?: string }): Set<string> {
    const origins = new Set<string>();
    for (const raw of [env.ALLOWED_ORIGIN, env.ALLOWED_ORIGINS]) {
        for (const value of (raw || "").split(",").map((s) => s.trim()).filter(Boolean)) {
            try {
                const url = new URL(value);
                if ((url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) && url.origin === value && !url.username && !url.password)
                    origins.add(value);
            } catch { /* Invalid entries grant no access. */
            }
        }
    }
    return origins;
}
