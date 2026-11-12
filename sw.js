const CACHE_NAME = 'estudio-v1'; // aumente este número a cada atualização dos arquivos
const CORE_ASSETS = [
  './', './index.html', './style.css', './app.js', './manifest.json',
  './fonts/oswald-latin-500-normal.woff2', './fonts/oswald-latin-700-normal.woff2',
  './fonts/inter-latin-400-normal.woff2', './fonts/inter-latin-600-normal.woff2',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(CORE_ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  // Só arquivos do próprio app; a agenda (outro domínio) sempre vai direto à rede.
  if (new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req)
      .then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => cached || caches.match('./index.html')))
  );
});
