const CACHE = "pgt-app-v1";
const ASSETS = /* PGT_ASSETS */ ["/", "/manifest.webmanifest", "/icon.svg"];
self.addEventListener("install", (event) =>
    event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS))),
);
self.addEventListener("activate", (event) =>
    event.waitUntil(
        (async () => {
            for (const key of await caches.keys())
                if (key.startsWith("pgt-app-") && key !== CACHE)
                    await caches.delete(key);
            await self.clients.claim();
        })(),
    ),
);
self.addEventListener("message", (event) => {
    if (event.data === "ACTIVATE_UPDATE") self.skipWaiting();
});
self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);
    if (
        url.origin !== self.location.origin ||
        url.pathname.startsWith("/api/") ||
        event.request.method !== "GET"
    )
        return;
    event.respondWith(
        (async () => {
            const cache = await caches.open(CACHE);
            if (event.request.mode === "navigate") {
                try {
                    return await fetch(event.request);
                } catch {
                    return await cache.match("/");
                }
            }
            return (await cache.match(event.request)) || fetch(event.request);
        })(),
    );
});
