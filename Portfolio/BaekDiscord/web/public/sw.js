/* DevHub 관제 service worker.
 * - navigations: network first, offline fallback page
 * - /_next/static and /icons: cache first (immutable assets)
 * - never caches /runner/* (live API/WS) or /api/* (auth, cron, webhooks)
 * - notification action buttons (y⏎ / ⏎ / Esc) are relayed to the open dashboard, which sends
 *   them to the session as input (the page owns the runner socket, the worker does not)
 */
const VERSION = "devhub-v3";
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGE_CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL, "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isBypassed(url) {
  return url.pathname.startsWith("/runner/") || url.pathname.startsWith("/api/") || url.pathname === "/runner";
}

function isStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest";
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (isBypassed(url)) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(PAGE_CACHE).then((cache) => cache.put(req, copy)).catch(() => undefined);
          }
          return res;
        })
        .catch(async () => (await caches.match(req)) || (await caches.match(OFFLINE_URL)) || Response.error()),
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy)).catch(() => undefined);
            }
            return res;
          }),
      ),
    );
  }
});

self.addEventListener("notificationclick", (event) => {
  const n = event.notification;
  const data = n.data || {};
  const action = event.action || "";
  n.close();
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const dashboard = all.find((c) => new URL(c.url).pathname.startsWith("/control")) || all[0];
      if (dashboard) {
        if (action && data.sessionId) dashboard.postMessage({ type: "devhub:notification-action", sessionId: data.sessionId, action });
        if ("focus" in dashboard && !action) await dashboard.focus();
      } else if (!action) {
        await self.clients.openWindow("/control");
      }
    })(),
  );
});
