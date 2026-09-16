// Service Worker：离线可玩（PWA）。
// 策略：全部同源 GET 一律网络优先，成功即顺手入缓存，失败（离线）回退缓存 ——
// 在线时永远跑最新产物，断网时才是 SW 的舞台。缓存优先会让开发迭代吃到旧
// 编译产物（R61 实测踩坑：改了 scenario.ts 浏览器还在跑旧 js）。
// 零构建：本文件是手写静态资源，不经任何打包。

const CACHE = 'bbl-v2';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit ?? (req.mode === 'navigate' ? caches.match('index.html') : undefined))
      )
  );
});
