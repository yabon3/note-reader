import { checkNewArticles, SYNC_TAG } from './background.js';

// 画面のファイルだけを手元に置く。記事の取得（中継役・note）には触らない
const CACHE = 'note-reader-v3';
const SHELL = [
  './', 'index.html', 'style.css', 'app.js', 'rss.js', 'data.js', 'background.js', 'config.js', 'privacy.html',
  'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'
];

// アプリを閉じている間の確認。画面を見ているときは画面側の更新に任せる
self.addEventListener('periodicsync', e => {
  if (e.tag !== SYNC_TAG) return;
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => {
    if (list.some(c => c.visibilityState === 'visible')) return;
    return checkNewArticles(self.registration);
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => (
    list.length ? list[0].focus() : self.clients.openWindow('./')
  )));
});

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 手元の分をすぐ返し、裏で新しい版を取っておく（次の起動で最新になる）
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(e.request, { ignoreSearch: true });
    const update = fetch(e.request).then(res => {
      if (res.ok) cache.put(e.request.url.split('?')[0], res.clone());
      return res;
    });
    if (hit) { update.catch(() => {}); return hit; }
    return update;
  }));
});
