import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFeed, mergeArticles, findNewArticles, summarizeNew, parseCreatorInput, collectArts, safeUrl
} from '../docs/rss.js';

test('findNewArticles: 持っていない記事だけ。記事0件の人は対象外', () => {
  const fresh = [{ articleId: 'n1' }, { articleId: 'n2' }];
  assert.deepEqual(findNewArticles({ latestArticles: [{ articleId: 'n1' }] }, fresh), [{ articleId: 'n2' }]);
  assert.deepEqual(findNewArticles({ latestArticles: [] }, fresh), []);
  assert.deepEqual(findNewArticles({}, fresh), []);
});

test('summarizeNew: 前の通知に件数を足し、新しい順に3行まで', () => {
  const added = [{ creatorName: 'A', title: '1' }, { creatorName: 'B', title: '2' }];
  assert.deepEqual(summarizeNew(added), { count: 2, lines: ['A：1', 'B：2'] });
  assert.deepEqual(summarizeNew(added, { count: 5, lines: ['C：3', 'D：4', 'E：5'] }), {
    count: 7, lines: ['A：1', 'B：2', 'C：3']
  });
});

const FEED = `<?xml version="1.0"?><rss><channel>
<title>テスト &amp; 名前</title><link>https://note.com/abc</link>
<item><title>記事 &lt;1&gt;</title>
<media:thumbnail>https://assets.st-note.com/a.png?width=800</media:thumbnail>
<link>https://note.com/abc/n/n111</link><guid>https://note.com/abc/n/n111</guid>
<pubDate>Sat, 31 Oct 2026 10:00:00 +0900</pubDate></item>
<item><title><![CDATA[記事&2]]></title>
<media:thumbnail url="https://assets.st-note.com/b.png"/>
<link>https://note.com/abc/n/n222</link><guid>https://note.com/abc/n/n222</guid>
<pubDate>Fri, 30 Oct 2026 10:00:00 +0900</pubDate></item>
<item><title>記事IDなし</title><link>https://example.com/x</link></item>
</channel></rss>`;

test('parseFeed: 名前・記事・サムネイルの2形式・実体参照', () => {
  const { name, articles } = parseFeed(FEED);
  assert.equal(name, 'テスト & 名前');
  assert.equal(articles.length, 2);
  assert.deepEqual(articles[0], {
    articleId: 'n111', title: '記事 <1>', url: 'https://note.com/abc/n/n111',
    thumbnailUrl: 'https://assets.st-note.com/a.png?width=800', publishAt: 'Sat, 31 Oct 2026 10:00:00 +0900'
  });
  assert.equal(articles[1].title, '記事&2');
  assert.equal(articles[1].thumbnailUrl, 'https://assets.st-note.com/b.png');
});

test('mergeArticles: 既読を引き継ぎ、新着だけ未読で数える', () => {
  const c = { latestArticles: [{ articleId: 'n111', isRead: true }] };
  const n = mergeArticles(c, [{ articleId: 'n222' }, { articleId: 'n111' }]);
  assert.equal(n, 1);
  assert.deepEqual(c.latestArticles.map(a => a.isRead), [false, true]);
});

test('parseCreatorInput', () => {
  assert.equal(parseCreatorInput('https://note.com/abc'), 'abc');
  assert.equal(parseCreatorInput('https://note.com/abc/n/n111?x=1'), 'abc');
  assert.equal(parseCreatorInput('@abc_1'), 'abc_1');
  assert.equal(parseCreatorInput('abc-1'), 'abc-1');
  assert.equal(parseCreatorInput('面白い記事 https://note.com/abc/n/n1'), 'abc');
  assert.equal(parseCreatorInput('https://note.com/hashtag/foo'), null);
  assert.equal(parseCreatorInput('https://example.com/abc'), null);
  assert.equal(parseCreatorInput('二語 です'), null);
  assert.equal(parseCreatorInput('../x'), null);
  assert.equal(parseCreatorInput(''), null);
});

test('safeUrl: https以外は通さない', () => {
  assert.equal(safeUrl('https://note.com/a'), 'https://note.com/a');
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl(null), null);
});

const CREATORS = [
  { id: 1, name: 'B', category: '教育', latestArticles: [
    { articleId: 'n1', title: 'Alpha', isRead: false, publishAt: 'Sat, 31 Oct 2026 10:00:00 +0900' },
    { articleId: 'n2', title: 'beta', isRead: true, publishAt: 'Thu, 29 Oct 2026 10:00:00 +0900' }
  ] },
  { id: 2, name: 'A', latestArticles: [
    { articleId: 'n3', title: 'gamma', isRead: false, publishAt: 'Fri, 30 Oct 2026 10:00:00 +0900' }
  ] }
];
const ids = arts => arts.map(a => a.articleId);

test('collectArts: 絞り込み・カテゴリ・検索・並び順', () => {
  const none = new Map();
  assert.deepEqual(ids(collectArts(CREATORS, none, { filter: 'unread' })), ['n1', 'n3']);
  assert.deepEqual(ids(collectArts(CREATORS, none, { filter: 'read' })), ['n2']);
  assert.deepEqual(ids(collectArts(CREATORS, none, { filter: 'all', category: '未分類' })), ['n3']);
  assert.deepEqual(ids(collectArts(CREATORS, none, { filter: 'all', creatorId: '1' })), ['n1', 'n2']);
  assert.deepEqual(ids(collectArts(CREATORS, none, { filter: 'all', query: 'ALPHA' })), ['n1']);
  assert.deepEqual(ids(collectArts(CREATORS, none, { filter: 'all', sort: 'date:asc' })), ['n2', 'n3', 'n1']);
  assert.deepEqual(ids(collectArts(CREATORS, none, { filter: 'all', sort: 'creator:asc' })), ['n3', 'n1', 'n2']);
});

test('collectArts: RSSから消えた記事もスターなら残る', () => {
  const starred = new Map([
    ['n1', { articleId: 'n1', creatorId: 1 }],
    ['old', { articleId: 'old', title: '古い', creatorId: 1, publishAt: 'Mon, 05 Oct 2026 10:00:00 +0900' }]
  ]);
  const arts = collectArts(CREATORS, starred, { filter: 'starred' });
  assert.deepEqual(ids(arts), ['n1', 'old']);
  assert.equal(arts[0].isRead, false);
  assert.equal(arts[1].isRead, true);
});
