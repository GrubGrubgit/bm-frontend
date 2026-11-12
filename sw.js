// BM PWA service worker: versioned app-shell + runtime cache.
// Bump VERSION with every shipped frontend change so updates apply.
// Never caches ROM bytes (*.nes / testrom.nes): packs live in IndexedDB.
const VERSION = "bm-v1";
const SHELL_CACHE = VERSION + "-shell";
const RUNTIME_CACHE = VERSION + "-runtime";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./src/app.js",
  "./src/icons/icon-192.png",
  "./src/icons/icon-512.png",
  "./src/icons/icon-maskable-512.png"
];
self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL_CACHE);
    await c.addAll(SHELL).catch(() => {});
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => {
      if (k !== SHELL_CACHE && k !== RUNTIME_CACHE) return caches.delete(k);
      return undefined;
    }));
    await self.clients.claim();
  })());
});
function isRomUrl(u) {
  return u.pathname.endsWith(".nes") || u.pathname.endsWith("testrom.nes");
}
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin) return;
  if (isRomUrl(u)) return;
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try {
        const net = await fetch(req);
        const c = await caches.open(RUNTIME_CACHE);
        c.put(req, net.clone()).catch(() => {});
        return net;
      } catch (err) {
        const c = await caches.open(SHELL_CACHE);
        const hit = await c.match("./index.html");
        if (hit) return hit;
        throw err;
      }
    })());
    return;
  }
  e.respondWith((async () => {
    const c = await caches.open(RUNTIME_CACHE);
    const hit = await c.match(req);
    if (hit) return hit;
    const net = await fetch(req);
    if (net && (net.status === 200 || net.status === 0)) c.put(req, net.clone()).catch(() => {});
    return net;
  })());
});
