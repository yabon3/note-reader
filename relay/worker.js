// =========================================================
// 中継役：noteのRSSだけを取得してアプリへ渡す
// 依頼内容・IPアドレスは記録しない（console.log も置かない）
// =========================================================

const NOTE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const CACHE_SECONDS = 600;     // 同じ人のRSSはこの間使い回す（noteへの負担を減らす）
const FETCH_TIMEOUT_MS = 10000;

function allowedOrigins(env) {
  return String((env && env.ALLOWED_ORIGINS) || '').split(',').map(s => s.trim()).filter(Boolean);
}

function withCors(response, origin) {
  const headers = new Headers({
    'Content-Type': 'application/xml; charset=utf-8',
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  return new Response(response.body, { status: response.status, headers });
}

function plain(status, origin) {
  const headers = new Headers({ 'Vary': 'Origin' });
  if (origin) headers.set('Access-Control-Allow-Origin', origin);
  return new Response(null, { status, headers });
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    // ブラウザからの呼び出しは配布先のページに限る（Originのない呼び出しも断る）
    if (!allowedOrigins(env).includes(origin)) return plain(403, null);
    if (request.method === 'OPTIONS') return plain(204, origin);
    if (request.method !== 'GET') return plain(405, origin);

    const m = new URL(request.url).pathname.match(/^\/rss\/([^/]+)$/);
    if (!m || !NOTE_ID.test(m[1])) return plain(400, origin);
    const noteId = m[1];

    // 保存の鍵はRSSのURLだけ。誰の依頼かは含めない
    const cache = globalThis.caches && globalThis.caches.default;
    const cacheKey = new Request(`https://note.com/${noteId}/rss`);
    if (cache) {
      const hit = await cache.match(cacheKey);
      if (hit) return withCors(hit, origin);
    }

    let upstream;
    try {
      upstream = await fetch(`https://note.com/${noteId}/rss`, {
        headers: { 'Accept': 'application/rss+xml, application/xml' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });
    } catch (e) {
      return plain(504, origin);
    }
    if (upstream.status === 404) return plain(404, origin);
    if (!upstream.ok) return plain(502, origin);

    const body = await upstream.text();
    if (cache && ctx) {
      ctx.waitUntil(cache.put(cacheKey, new Response(body, {
        headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': `public, s-maxage=${CACHE_SECONDS}` }
      })));
    }
    return withCors(new Response(body), origin);
  }
};
