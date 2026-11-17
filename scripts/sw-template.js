// 오프라인용 서비스 워커 (빌드할 때 vite.config.ts 가 목록과 버전을 채워 dist/sw.js 로 만든다)
// - 사이트 파일은 설치할 때 받아 둔다 → 인터넷이 없어도 열린다 (책 내용은 IndexedDB 에 따로 보관)
// - 페이지 열기는 인터넷 먼저, 안 되면 받아 둔 페이지
// - /api/ 는 건드리지 않는다
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const APP = `app-${VERSION}`;

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(APP);
      await Promise.all(PRECACHE.map((u) => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith('app-') && k !== APP) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(async () => (await caches.match('/', { ignoreSearch: true })) ?? Response.error()));
    return;
  }
  e.respondWith(
    (async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      // 미리 받지 않은 사이트 파일(글꼴 조각 등)도 한 번 받으면 넣어 둔다
      if (res.ok && url.pathname.startsWith('/assets/')) {
        const copy = res.clone();
        e.waitUntil(caches.open(APP).then((c) => c.put(req, copy)).catch(() => {}));
      }
      return res;
    })(),
  );
});
