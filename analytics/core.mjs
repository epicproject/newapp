// Click / view counter for Hash Widgets. Pure logic: no network, no storage.
// Used by the Cloudflare Worker (worker.mjs), the self-host Node server (server.mjs) and the tests.

export const LIMITS = { maxWidgets: 500, maxHosts: 40, maxEvents: 200, idMax: 1500 };

// A widget id is the part after "#": base64url / short-code characters only.
const ID_RE = /^[A-Za-z0-9_.~%\-]{1,1500}$/;
// Where the widget is embedded: just a host name (never a full URL, never a visitor's address).
const HOST_RE = /^[a-z0-9.\-]{1,80}(:\d{1,5})?$/;

/** Returns {id, k, h} for a valid hit, else null. */
export function cleanHit(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id ?? '').replace(/^#/, '');
  const k = raw.k === 'click' || raw.k === 'view' ? raw.k : null;
  if (!k || !ID_RE.test(id)) return null;
  let h = String(raw.h ?? '').toLowerCase();
  if (!HOST_RE.test(h)) h = 'unknown';
  return { id, k, h };
}

export class Stats {
  constructor(saved) {
    this.seq = saved?.seq || 0;
    this.widgets = saved?.widgets || {};
    this.events = saved?.events || [];
  }

  /** Records one view or click. Keeps memory bounded: old widgets/hosts are dropped, never unbounded growth. */
  hit({ id, k, h }, now = Date.now()) {
    let w = this.widgets[id];
    if (!w) {
      w = this.widgets[id] = { clicks: 0, views: 0, first: now, last: now, lastClick: 0, hosts: {} };
      const ids = Object.keys(this.widgets);
      if (ids.length > LIMITS.maxWidgets) {            // drop the least recently used widget
        const oldest = ids.reduce((a, b) => (this.widgets[a].last <= this.widgets[b].last ? a : b));
        if (oldest !== id) delete this.widgets[oldest];
      }
    }
    if (k === 'click') { w.clicks++; w.lastClick = now; } else w.views++;
    w.last = now;
    if (!w.hosts[h] && Object.keys(w.hosts).length >= LIMITS.maxHosts) h = 'other';
    const hs = (w.hosts[h] ||= { clicks: 0, views: 0 });
    hs[k === 'click' ? 'clicks' : 'views']++;
    this.events.push({ seq: ++this.seq, t: now, id, k, h });
    if (this.events.length > LIMITS.maxEvents) this.events.splice(0, this.events.length - LIMITS.maxEvents);
  }

  /** Everything the monitor needs. [since] = last event seq the caller already has. */
  snapshot(since = 0, now = Date.now()) {
    const widgets = Object.entries(this.widgets).map(([id, w]) => ({ id, ...w }))
      .sort((a, b) => b.clicks - a.clicks || b.views - a.views || b.last - a.last);
    return {
      now, seq: this.seq,
      total: { clicks: widgets.reduce((s, w) => s + w.clicks, 0), views: widgets.reduce((s, w) => s + w.views, 0), widgets: widgets.length },
      widgets,
      events: this.events.filter(e => e.seq > since),
    };
  }

  /** Forget one widget, or everything when [id] is empty. */
  reset(id) {
    if (id) { delete this.widgets[id]; this.events = this.events.filter(e => e.id !== id); }
    else { this.widgets = {}; this.events = []; }
  }

  toJSON() { return { seq: this.seq, widgets: this.widgets, events: this.events }; }
}

/** Fixed-window limiter, e.g. 120 hits per minute per visitor address (kept in memory only). */
export class RateLimiter {
  constructor(max = 120, windowMs = 60_000) { this.max = max; this.windowMs = windowMs; this.map = new Map(); }
  allow(key, now = Date.now()) {
    if (this.map.size > 5000) for (const [k, v] of this.map) if (now - v.start > this.windowMs) this.map.delete(k);
    const e = this.map.get(key);
    if (!e || now - e.start >= this.windowMs) { this.map.set(key, { start: now, n: 1 }); return true; }
    return ++e.n <= this.max;
  }
}

export const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, x-admin-key', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Max-Age': '86400' };

/** Constant-time string compare (admin key). */
export function sameKey(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !a.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Reads the admin key from "Authorization: Bearer <key>" or "X-Admin-Key". */
export function keyFrom(headers) {
  const get = n => (typeof headers.get === 'function' ? headers.get(n) : headers[n.toLowerCase()]) || '';
  const m = /^Bearer\s+(.+)$/i.exec(get('authorization'));
  return m ? m[1].trim() : get('x-admin-key').trim();
}
