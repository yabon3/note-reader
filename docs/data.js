// =========================================================
// 保存と取得（画面と service worker の両方から使う）
// 保存は IndexedDB。キーは拡張機能のバックアップと揃える
// =========================================================
import { RELAY_URL } from './config.js';
import { parseFeed, mergeArticles, findNewArticles } from './rss.js';

const dbReady = new Promise((resolve, reject) => {
  const req = indexedDB.open('note-reader', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('kv');
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
export async function dbGet(key) {
  const db = await dbReady;
  return new Promise((resolve, reject) => {
    const r = db.transaction('kv').objectStore('kv').get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function dbSet(key, value) {
  const db = await dbReady;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// 取得結果を、その時点の保存内容へ取り込む。読み出しから書き込みまでを1回の処理で行い、
// 取得中に画面で付けた既読や削除を上書きしない。戻り値は新しい記事の一覧
export async function mergeFeeds(feeds) {
  const db = await dbReady;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    const store = tx.objectStore('kv');
    const added = [];
    const r = store.get('favoriteCreators');
    r.onsuccess = () => {
      const creators = r.result || [];
      creators.forEach(c => {
        const fresh = feeds.get(c.id);
        if (!fresh) return;
        findNewArticles(c, fresh).forEach(a => added.push({ creatorName: c.name, title: a.title }));
        mergeArticles(c, fresh);
      });
      store.put(creators, 'favoriteCreators');
    };
    tx.oncomplete = () => resolve(added);
    tx.onerror = () => reject(tx.error);
  });
}

export async function fetchFeed(noteId) {
  const res = await fetch(`${RELAY_URL}/rss/${encodeURIComponent(noteId)}`);
  if (res.status === 404) { const e = new Error('見つかりません'); e.notFound = true; throw e; }
  if (!res.ok) throw new Error(`取得失敗（${res.status}）`);
  return parseFeed(await res.text());
}
