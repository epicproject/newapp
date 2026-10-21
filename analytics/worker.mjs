// Cloudflare Worker + Durable Object: the shared, atomic counter behind the Monitor.
// Deploy:  npx wrangler login && npx wrangler secret put ADMIN_KEY && npx wrangler deploy   (see README.md)
import { Stats, RateLimiter, cleanHit, CORS, sameKey, keyFrom } from './core.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS } });
const empty = (status = 204) => new Response(null, { status, headers: CORS });

/** One global instance holds every counter, so two clicks at the same moment can never overwrite each other. */
export class Counter {
  constructor(state) {
    this.state = state;
    this.stats = null;
    this.limiter = new RateLimiter(120, 60_000);
  }

  async load() {
    if (!this.stats) this.stats = new Stats(await this.state.storage.get('stats'));
  }

  async fetch(request) {
    await this.load();
    const url = new URL(request.url);
    if (url.pathname === '/hit') {
      let hit = null;
      try { hit = cleanHit(JSON.parse(await request.text())); } catch { /* bad body */ }
      if (!hit) return empty(204);                                    // never reveal validation details to strangers
      if (!this.limiter.allow(request.headers.get('x-visitor') || 'anon')) return empty(204);
      this.stats.hit(hit);
      await this.state.storage.put('stats', this.stats.toJSON());
      return empty(204);
    }
    if (url.pathname === '/stats') return json(this.stats.snapshot(Number(url.searchParams.get('since')) || 0));
    if (url.pathname === '/reset') {
      this.stats.reset(url.searchParams.get('id') || '');
      await this.state.storage.put('stats', this.stats.toJSON());
      return json({ ok: true });
    }
    return json({ error: 'not found' }, 404);
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return empty(204);
    const url = new URL(request.url);
    const stub = env.COUNTER.get(env.COUNTER.idFromName('main'));

    if (url.pathname === '/hit' && request.method === 'POST') {
      // forward only what the counter needs; the visitor address is used for rate limiting and never stored
      const headers = new Headers({ 'x-visitor': request.headers.get('CF-Connecting-IP') || 'anon' });
      return stub.fetch('https://counter/hit', { method: 'POST', body: await request.text(), headers });
    }
    if (url.pathname === '/stats' || url.pathname === '/reset') {
      if (!env.ADMIN_KEY) return json({ error: 'ADMIN_KEY is not set on this Worker (npx wrangler secret put ADMIN_KEY)' }, 503);
      if (!sameKey(keyFrom(request.headers), env.ADMIN_KEY)) return json({ error: 'wrong key' }, 401);
      const target = new URL('https://counter' + url.pathname);
      url.searchParams.forEach((v, k) => target.searchParams.set(k, v));
      return stub.fetch(target, { method: 'POST' });
    }
    if (url.pathname === '/') return new Response('Hash Widget stats: online', { headers: { 'Content-Type': 'text/plain', ...CORS } });
    return json({ error: 'not found' }, 404);
  },
};
