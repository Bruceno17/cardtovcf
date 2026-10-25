/* CardToVCF Web — Service Worker：快取全部資源，離線可用。路徑皆為相對，適用任何子目錄。 */
const VERSION = 'cardtovcf-v1.0.0';
const ASSETS = [
  './',
  'index.html',
  'manifest.json',
  'css/app.css',
  'js/app.js',
  'js/parser.js',
  'js/vcard.js',
  'js/store.js',
  'js/ocr.js',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/favicon-32.png',
  'vendor/tesseract/tesseract.min.js',
  'vendor/tesseract/worker.min.js',
  'vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js',
  'vendor/tesseract/core/tesseract-core-lstm.wasm.js',
  'vendor/tesseract/lang/chi_tra.traineddata.gz',
  'vendor/tesseract/lang/eng.traineddata.gz'
];

async function precache() {
  const cache = await caches.open(VERSION);
  await cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'precache') {
    event.waitUntil(precache().then(async () => {
      for (const c of await self.clients.matchAll()) c.postMessage({ type: 'precached' });
    }));
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    // 頁面：先網路（拿到新版），失敗才用快取；其他資源：先快取。
    if (req.mode === 'navigate') {
      try {
        const fresh = await fetch(req);
        if (fresh.ok) cache.put('index.html', fresh.clone());
        return fresh;
      } catch (e) {
        return (await cache.match('index.html')) || (await cache.match('./')) || Response.error();
      }
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (e) {
      return Response.error();
    }
  })());
});
