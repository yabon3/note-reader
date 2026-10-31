// 手元の確認用：画面（8790）と中継役（8787）を別々のオリジンで動かす
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../relay/worker.js';

const WEB_PORT = 8790;
const RELAY_PORT = 8787;
const WEB_ROOT = fileURLToPath(new URL('../docs', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json'
};

http.createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = normalize(join(WEB_ROOT, path === '/' ? 'index.html' : path));
  if (!file.startsWith(WEB_ROOT + sep)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch (e) {
    res.writeHead(404).end();
  }
}).listen(WEB_PORT, () => console.log(`web http://localhost:${WEB_PORT}`));

const env = { ALLOWED_ORIGINS: `http://localhost:${WEB_PORT}` };
http.createServer(async (req, res) => {
  const out = await worker.fetch(
    new Request(`http://localhost:${RELAY_PORT}${req.url}`, { method: req.method, headers: req.headers }),
    env,
    { waitUntil() {} }
  );
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
}).listen(RELAY_PORT, () => console.log(`relay http://localhost:${RELAY_PORT}`));
