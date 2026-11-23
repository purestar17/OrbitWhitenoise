// Service worker: makes the app installable and usable offline.
// Bump VERSION when app files change so users get the new version.
const VERSION = 'orbit-v25';
const SHELL = [
  './', 'index.html', 'css/app.css', 'css/scenes.css', 'css/landscape.css',
  'js/main.js', 'js/loop.js', 'js/engine.js', 'js/model.js', 'js/landscape.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'sounds/manifest.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // fonts etc. go straight to the network
  if (/\.(mp4|webm|mov)$/i.test(url.pathname)) return; // videos stream with range requests; leave them to the browser cache

  // App code and the sound list: network first, so updates show up; cache when offline.
  if (req.mode === 'navigate' || /\.(html|js|css|json|webmanifest)$/.test(url.pathname)) {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then((r) => r || caches.match('index.html'))),
    );
    return;
  }

  // Audio and images: cache first (they are large and rarely change).
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    })),
  );
});
