// Self-hosted version of the counter (same API as the Cloudflare Worker): node server.mjs
// Environment: PORT (default 8790), ADMIN_KEY (required to read stats), DATA_FILE (default ./data.json), TRUST_PROXY=1 behind a proxy.
import http from 'node:http';
import fs from 'node:fs';
import { Stats, RateLimiter, cleanHit, CORS, sameKey, keyFrom } from './core.mjs';

export function createServer({ adminKey = '', dataFile = '', trustProxy = false } = {}) {
  let saved;
  try { if (dataFile) saved = JSON.parse(fs.readFileSync(dataFile, 'utf8')); } catch { /* first run */ }
  const stats = new Stats(saved);
  const limiter = new RateLimiter(120, 60_000);
  let timer = null;
  const persist = () => {
    if (!dataFile || timer) return;
    timer = setTimeout(() => { timer = null; fs.writeFile(dataFile + '.tmp', JSON.stringify(stats), err => { if (!err) fs.rename(dataFile + '.tmp', dataFile, () => {}); }); }, 400);
  };
  const send = (res, status, body, type = 'application/json') => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...CORS });
    res.end(body == null ? undefined : typeof body === 'string' ? body : JSON.stringify(body));
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') return send(res, 204, null);

    if (url.pathname === '/hit' && req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 4096) req.destroy(); });
      req.on('end', () => {
        let hit = null;
        try { hit = cleanHit(JSON.parse(body)); } catch { /* bad body */ }
        const ip = (trustProxy && req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket.remoteAddress || 'anon';
        if (hit && limiter.allow(ip)) { stats.hit(hit); persist(); }
        send(res, 204, null);
      });
      return;
    }
    if (url.pathname === '/stats' || url.pathname === '/reset') {
      if (!adminKey) return send(res, 503, { error: 'ADMIN_KEY is not set' });
      if (!sameKey(keyFrom(req.headers), adminKey)) return send(res, 401, { error: 'wrong key' });
      if (url.pathname === '/reset') { stats.reset(url.searchParams.get('id') || ''); persist(); return send(res, 200, { ok: true }); }
      return send(res, 200, stats.snapshot(Number(url.searchParams.get('since')) || 0));
    }
    if (url.pathname === '/') return send(res, 200, 'Hash Widget stats: online', 'text/plain');
    send(res, 404, { error: 'not found' });
  });
  server.stats = stats;
  return server;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('server.mjs')) {
  const port = Number(process.env.PORT) || 8790;
  createServer({ adminKey: process.env.ADMIN_KEY || '', dataFile: process.env.DATA_FILE || './data.json', trustProxy: process.env.TRUST_PROXY === '1' })
    .listen(port, () => console.log(`Hash Widget stats on http://localhost:${port}  (ADMIN_KEY ${process.env.ADMIN_KEY ? 'set' : 'NOT set: stats are locked'})`));
}
