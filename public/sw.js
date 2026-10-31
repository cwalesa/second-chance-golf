// Offline cache: the game is fully local, so cache the app shell and serve it when offline.
const CACHE = 'scg-jewel-v6';
self.addEventListener('install', (e) => {
  e.waitUntil(fetch('./precache.json').then((r) => { if (!r.ok) throw new Error('Precache unavailable'); return r.json(); }).then((files) => caches.open(CACHE).then((c) => c.addAll(files))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('scg-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        if (res.ok && new URL(e.request.url).origin === location.origin) caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || (e.request.mode === 'navigate' ? caches.match('./') : Response.error()))),
  );
});
