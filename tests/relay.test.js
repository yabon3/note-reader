import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../relay/worker.js';

const ORIGIN = 'https://example.github.io';
const env = { ALLOWED_ORIGINS: ORIGIN };
const ctx = { waitUntil() {} };
const call = (path, { origin = ORIGIN, method = 'GET' } = {}) => worker.fetch(
  new Request(`https://relay.test${path}`, { method, headers: origin ? { Origin: origin } : {} }), env, ctx
);

function mockFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return handler(url); };
  return { calls, restore() { globalThis.fetch = original; } };
}

test('許可したページからのRSS取得を中継し、利用者の情報を送らない', async () => {
  const m = mockFetch(() => new Response('<rss/>', { status: 200, headers: { 'Set-Cookie': 'a=b' } }));
  try {
    const res = await call('/rss/abc_1');
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '<rss/>');
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
    assert.equal(res.headers.get('Set-Cookie'), null);
    assert.equal(m.calls[0].url, 'https://note.com/abc_1/rss');
    assert.deepEqual(Object.keys(m.calls[0].init.headers), ['Accept']);
  } finally { m.restore(); }
});

test('断るもの：他のページ・Originなし・RSS以外の道・不正なID・GET以外', async () => {
  const m = mockFetch(() => new Response('x'));
  try {
    assert.equal((await call('/rss/abc', { origin: 'https://evil.example' })).status, 403);
    assert.equal((await call('/rss/abc', { origin: null })).status, 403);
    assert.equal((await call('/api/v3/notes/n1')).status, 400);
    assert.equal((await call('/rss/abc/n/n1')).status, 400);
    assert.equal((await call('/rss/%2e%2e%2fapi')).status, 400);
    assert.equal((await call('/rss/abc', { method: 'POST' })).status, 405);
    assert.equal(m.calls.length, 0);
  } finally { m.restore(); }
});

test('noteの失敗をそのまま画面が扱える形で返す', async () => {
  let status = 404;
  const m = mockFetch(() => new Response('', { status }));
  try {
    assert.equal((await call('/rss/abc')).status, 404);
    status = 500;
    assert.equal((await call('/rss/abc')).status, 502);
  } finally { m.restore(); }
  const down = mockFetch(() => { throw new Error('down'); });
  try {
    assert.equal((await call('/rss/abc')).status, 504);
  } finally { down.restore(); }
});
