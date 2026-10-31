// =========================================================
// アプリを閉じている間の確認と通知
// =========================================================
import { dbGet, fetchFeed, mergeFeeds } from './data.js';
import { summarizeNew } from './rss.js';

export const SYNC_TAG = 'check-articles';
export const NOTIFY_TAG = 'new-articles';
const FETCH_CONCURRENCY = 6;

export async function checkNewArticles(registration) {
  const creators = (await dbGet('favoriteCreators')) || [];
  const queue = [...creators];
  const feeds = new Map();
  async function worker() {
    while (queue.length) {
      const c = queue.shift();
      try {
        const feed = await fetchFeed(c.noteId);
        if (feed.articles.length) feeds.set(c.id, feed.articles);
      } catch (e) { /* 次の確認でまた取りに行く */ }
    }
  }
  await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker));

  const added = await mergeFeeds(feeds);
  if (added.length === 0) return;
  // 前の通知が残っていれば、件数を足して置き換える
  const [prev] = await registration.getNotifications({ tag: NOTIFY_TAG });
  const data = summarizeNew(added, prev && prev.data);
  await registration.showNotification(`新着 ${data.count}件`, {
    body: data.lines.join('\n'),
    tag: NOTIFY_TAG,
    icon: 'icons/icon-192.png',
    data
  });
}
