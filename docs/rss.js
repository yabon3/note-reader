// =========================================================
// RSSの読み取り・登録入力の解釈・記事の絞り込み（画面に依存しない部分）
// RSSの読み取りと取り込みは拡張機能の service-worker.js と同じ考え方
// =========================================================

export const ARTICLES_PER_CREATOR = 24;
export const UNCATEGORIZED = '未分類';
const NOTIFY_LINES = 3;

const EXCLUDED_PATHS = new Set([
  'recommends','following','contests','hashtag','search',
  'settings','notifications','notes','circles','magazines',
  'creators','events','topics','explore','discover',
  'trending','official','help','terms','privacy'
]);

function decodeEntities(t) {
  return t.replace(/&(amp|lt|gt|quot|apos|#39|#x27);/g, (_, e) => (
    { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#x27': "'" }[e]
  ));
}
function extractTag(xml, tagName) {
  const m = xml.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return m ? m[1].trim() : '';
}
function textOf(raw) {
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return cdata ? cdata[1] : decodeEntities(raw);
}

// RSSの本文 → { name, articles }。記事が読めなければ articles は空
export function parseFeed(xml) {
  const head = xml.split('<item>')[0];
  const name = textOf(extractTag(head, 'title'));
  const articles = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null && articles.length < ARTICLES_PER_CREATOR) {
    const item = match[1];
    const guid = extractTag(item, 'guid');
    const link = extractTag(item, 'link');
    const idMatch = guid.match(/\/n\/([a-zA-Z0-9]+)$/) || link.match(/\/n\/([a-zA-Z0-9]+)$/);
    const url = link || guid;
    if (!idMatch || !url) continue;

    const thumb = item.match(/<media:thumbnail[^>]*>([^<]*)<\/media:thumbnail>/i);
    const thumbAttr = item.match(/<media:thumbnail[^>]*url=["']([^"']+)["']/i);
    articles.push({
      articleId: idMatch[1],
      title: textOf(extractTag(item, 'title')) || 'タイトル不明',
      url,
      thumbnailUrl: (thumb && thumb[1].trim()) || (thumbAttr && thumbAttr[1]) || null,
      publishAt: extractTag(item, 'pubDate')
    });
  }
  return { name, articles };
}

// 取得結果を取り込む。isRead は今の値を引き継ぎ、新しい記事は未読
export function mergeArticles(creator, fresh) {
  const readMap = new Map((creator.latestArticles || []).map(a => [a.articleId, a.isRead]));
  const newCount = fresh.filter(a => !readMap.has(a.articleId)).length;
  creator.latestArticles = fresh.map(a => ({ ...a, isRead: readMap.get(a.articleId) || false }));
  return newCount;
}

// 通知の対象になる新しい記事。記事を1件も持っていない人（取り込んだ直後など）は対象にしない
export function findNewArticles(creator, fresh) {
  const known = creator.latestArticles || [];
  if (known.length === 0) return [];
  const ids = new Set(known.map(a => a.articleId));
  return fresh.filter(a => !ids.has(a.articleId));
}

// 通知の中身。prev は前の通知の分（{ count, lines }）
export function summarizeNew(added, prev) {
  const lines = added.map(a => `${a.creatorName}：${a.title}`);
  return {
    count: added.length + (prev ? prev.count : 0),
    lines: [...lines, ...(prev ? prev.lines : [])].slice(0, NOTIFY_LINES)
  };
}

// 貼り付けられた文字列（URL・ID・@ID・共有の文章）→ noteのID。読めなければ null
export function parseCreatorInput(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  const url = text.match(/https?:\/\/(?:www\.)?note\.com\/([^\s/?#]+)/i);
  const id = url ? url[1] : (/\s/.test(text) ? '' : text.replace(/^@/, ''));
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || EXCLUDED_PATHS.has(id.toLowerCase())) return null;
  return id;
}

export function safeUrl(u) {
  return /^https:\/\//i.test(String(u || '')) ? u : null;
}

export function categoryOf(c) { return c.category || UNCATEGORIZED; }

export function listCategories(creators) {
  return [...new Set(creators.map(categoryOf))];
}

// 表示する記事を集める
// view: { filter:'unread'|'all'|'read'|'starred', category, creatorId, query, sort:'date:desc' など }
export function collectArts(creators, starred, view) {
  const q = (view.query || '').trim().toLowerCase();
  const inScope = c => view.creatorId != null ? String(c.id) === String(view.creatorId)
    : view.category != null ? categoryOf(c) === view.category : true;

  let arts = [];
  const byId = new Map();
  creators.forEach(c => (c.latestArticles || []).forEach(a => {
    const art = { ...a, creatorId: c.id, creatorName: c.name, category: categoryOf(c) };
    byId.set(a.articleId, art);
    if (inScope(c)) arts.push(art);
  }));

  if (view.filter === 'starred') {
    // 古くなってRSSから消えた記事もスターなら残す
    arts = [...starred.values()].map(s => byId.get(s.articleId) || { ...s, isRead: true })
      .filter(a => {
        const c = creators.find(c => String(c.id) === String(a.creatorId));
        return c ? inScope(c) : (view.creatorId == null && view.category == null);
      });
  } else if (view.filter === 'unread') arts = arts.filter(a => !a.isRead);
  else if (view.filter === 'read') arts = arts.filter(a => a.isRead);

  if (q) arts = arts.filter(a => (a.title || '').toLowerCase().includes(q));

  const [key, dir] = (view.sort || 'date:desc').split(':');
  const sign = dir === 'asc' ? 1 : -1;
  const time = a => new Date(a.publishAt).getTime() || 0;
  const tie = (a, b) => time(b) - time(a);
  const cmp = key === 'creator' ? (a, b) => sign * String(a.creatorName).localeCompare(String(b.creatorName), 'ja') || tie(a, b)
    : key === 'category' ? (a, b) => sign * String(a.category).localeCompare(String(b.category), 'ja') || tie(a, b)
    : (a, b) => sign * (time(a) - time(b));
  return arts.sort(cmp);
}

export function fmtDate(s, now = new Date()) {
  const d = new Date(s);
  if (isNaN(d)) return '';
  const min = (now - d) / 60000;
  if (min < 60) return `${Math.max(1, Math.floor(min))}分前`;
  if (min < 1440) return `${Math.floor(min / 60)}時間前`;
  if (min < 10080) return `${Math.floor(min / 1440)}日前`;
  return d.getFullYear() === now.getFullYear()
    ? `${d.getMonth() + 1}/${d.getDate()}`
    : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
