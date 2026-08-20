// Caddie service worker: stale-while-revalidate for same-origin GETs, so the
// whole trainer works offline after one visit (there is no content to
// download — the generator IS the content).
// The deploy pipeline stamps 74a7022 with the commit SHA so every release
// gets its own cache and stale copies are swept on activate.
const CACHE = 'caddie-74a7022';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) =>
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  ));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(e.request);
      const refresh = fetch(e.request)
        .then((res) => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        })
        .catch(() => hit);
      return hit ?? refresh;
    })
  );
});
