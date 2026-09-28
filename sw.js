/* 후쿠오카 동선 서비스 워커
   앱 파일: 온라인이면 새것, 느리거나 오프라인이면 캐시 (오프라인에서도 열림).
   지도 타일: 한 번 본 것만 캐시 (OSM 타일 정책상 미리 대량 다운로드하지 않음). */
const APP = 'fk-app';
const TILES = 'fk-tiles';
const MAX_TILES = 3000;
const FILES = [
  './', './index.html', './app.js', './app.css', './data.js', './manifest.webmanifest',
  './vendor/leaflet.js', './vendor/leaflet.css', './vendor/jua-sub.woff2',
  './icon-180.png', './icon-192.png', './icon-512.png', './icon-maskable-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(APP)
      .then(c => c.addAll(FILES.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== APP && k !== TILES).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trimTiles(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_TILES) await Promise.all(keys.slice(0, keys.length - MAX_TILES).map(k => cache.delete(k)));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'tile.openstreetmap.org') {
    e.respondWith(
      caches.open(TILES).then(cache =>
        cache.match(req, { ignoreVary: true }).then(hit => hit || fetch(req).then(res => {
          if (res && res.ok) { cache.put(req, res.clone()).then(() => trimTiles(cache)); }
          return res;
        }).catch(() => new Response('', { status: 504 })))
      )
    );
    return;
  }

  if (url.origin !== location.origin) return;
  if (url.pathname.endsWith('/sw.js')) return;

  // 온라인이면 새 파일 먼저 (여행 중 고친 일정이 바로 보이게), 3초 안에 안 오거나 오프라인이면 캐시
  e.respondWith(
    caches.open(APP).then(cache => {
      const fresh = fetch(new Request(req.url, { cache: 'no-cache' }))
        .then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; });
      e.waitUntil(fresh.catch(() => {}));
      const cached = () => cache.match(req, { ignoreSearch: true }).then(h => h || cache.match('./index.html'));
      return Promise.race([fresh, new Promise((_, no) => setTimeout(no, 3000))])
        .catch(() => cached().then(h => h || fresh));
    })
  );
});
