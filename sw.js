// Keeps the web app working offline once it has been opened online.
//
// Each build registers this worker as `sw.js?v=<build>&engine=<variant>`, so a
// release installs a new worker with its own cache. The page passes the
// engine directory its browser loads (the build holds one per kind of
// browser), and the install caches everything a launch needs before the
// worker takes over: an open page keeps running the release it loaded, and
// the next launch or reload gets the new one whole, then the old cache goes.

const PARAMS = new URL(self.location).searchParams;
const VERSION = PARAMS.get('v') || 'dev';
const ENGINE = PARAMS.get('engine') === 'chromium' ? 'canvaskit/chromium/' : 'canvaskit/';
const PREFIX = 'qiraat-';
const CACHE = PREFIX + VERSION;

// What every launch needs, besides the fonts listed in FontManifest.json.
const CORE = [
  './',
  'flutter_bootstrap.js',
  'main.dart.js',
  ENGINE + 'canvaskit.js',
  ENGINE + 'canvaskit.wasm',
  'manifest.json',
  'favicon.png',
  'icons/Icon-192.png',
  'icons/Icon-512.png',
  'assets/AssetManifest.bin.json',
  'assets/FontManifest.json',
  'assets/assets/data/farshiyat.json',
];

const scoped = (path) => new URL(path, self.registration.scope).href;

// Checks with the server rather than trusting the browser's own cache, which
// may still hold the last release's files; unchanged files cost a 304.
const fresh = (url) => fetch(new Request(url, { cache: 'no-cache' }));

async function fontUrls() {
  const manifest = await (await fresh(scoped('assets/FontManifest.json'))).json();
  return manifest.flatMap((family) =>
    family.fonts.map((font) => scoped('assets/' + font.asset)),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const urls = [...CORE.map(scoped), ...(await fontUrls())];
      await cache.addAll(urls.map((url) => new Request(url, { cache: 'no-cache' })));

      // Anything else the last release had cached, fetched again from this
      // release, so the update works offline as fully as the old one did. A
      // file this release no longer has is skipped; no network fails the
      // install, and the old release keeps working until the next try.
      const core = new Set(urls);
      for (const name of await caches.keys()) {
        if (name === CACHE || !name.startsWith(PREFIX)) continue;
        const old = await caches.open(name);
        for (const request of await old.keys()) {
          if (core.has(request.url)) continue;
          const response = await fresh(request.url);
          if (response.ok) await cache.put(request.url, response);
        }
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name !== CACHE && name.startsWith(PREFIX)) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

// The page lists the files it loaded, in case it used one the install
// didn't expect (say, a Flutter upgrade moved the engine).
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'cache') return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const url of event.data.urls) {
        if (new URL(url).origin !== self.location.origin) continue;
        if (await cache.match(url, { ignoreSearch: true })) continue;
        try {
          const response = await fetch(url);
          if (response.ok) await cache.put(url, response);
        } catch (_) {
          // Offline right now; the next visit lists it again.
        }
      }
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  // The page itself comes from the network when there is one, so a new
  // release is noticed; offline, or on a network too slow to answer, from
  // the cache.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cached = await caches.match(scoped('./'), { cacheName: CACHE });
        const network = fetch(request);
        if (!cached) return network;
        const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), 4000));
        return Promise.race([network.catch(() => cached), timeout]);
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    })(),
  );
});
