import { checkNewArticles, SYNC_TAG } from './background.js';

// 画面のファイルだけを手元に置く。記事の取得（中継役・note）には触らない
const CACHE = 'note-reader-v5';
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
  // ブラウザの一時保存を通さず、同じ版のファイルを一度にそろえる
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 手元の版だけを返す。1ファイルずつ更新すると古い画面と新しい処理が混ざるので、
// 更新は CACHE の番号を上げた新しい service worker が丸ごと入れ替える
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async cache => (
    (await cache.match(e.request, { ignoreSearch: true })) || fetch(e.request)
  )));
});
