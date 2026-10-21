// Offline-first shell. The app keeps its own copy of the data (localStorage) and an action queue,
// so the shopping list works in a supermarket with no signal. API calls are never cached here.
// Bump VERSION on every deploy.
const VERSION = 'v88'; // the app's files change: bump it (0.21.0)
const CACHE = `shuki-${VERSION}`;
const ASSETS = [
  './', './app.js', './shuki.js', './hebrew.js', './wardrobe.js', './reactions.js', './night.js', './recipes.js', './style.css', './manifest.webmanifest',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
  './fonts/karantina-hebrew-700-normal.woff2', './fonts/karantina-latin-700-normal.woff2',
  './fonts/secular-one-hebrew-400-normal.woff2', './fonts/secular-one-latin-400-normal.woff2',
  './fonts/ibm-plex-sans-hebrew-hebrew-400-normal.woff2', './fonts/ibm-plex-sans-hebrew-hebrew-500-normal.woff2', './fonts/ibm-plex-sans-hebrew-hebrew-700-normal.woff2',
  './fonts/ibm-plex-sans-hebrew-latin-400-normal.woff2', './fonts/ibm-plex-sans-hebrew-latin-500-normal.woff2', './fonts/ibm-plex-sans-hebrew-latin-700-normal.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== 'shuki-photos').map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // The static host answers /index.html with a redirect to /, and a redirected response can't serve a
  // navigation, so the app shell is cached (and served) under './'.
  const key = req.mode === 'navigate' ? './' : req;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(key);
    const fresh = fetch(req).then((res) => { if (res.ok) cache.put(key, res.clone()); return res; }).catch(() => cached || Response.error());
    return cached || fresh;
  }));
});

// the app asks which version serves it, for the line at the bottom of the settings (home19, item 14)
self.addEventListener('message', (e) => { if (e.data === 'version') e.ports[0]?.postMessage({ version: VERSION }); });
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(data.title || 'שוקי', { body: data.body || '', icon: 'icons/icon-192.png', data: { url: data.url || './#chat' }, lang: 'he', dir: 'rtl' }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './#chat';
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((wins) => {
    for (const w of wins) { w.navigate(url); return w.focus(); }
    return self.clients.openWindow(url);
  }));
});
