// node --test            (core + self-host server)
// WORKER_URL=http://127.0.0.1:8791 ADMIN_KEY=test-key node --test   (also runs the same API checks against `wrangler dev`)
import test from 'node:test';
import assert from 'node:assert/strict';
import { Stats, RateLimiter, cleanHit, sameKey, keyFrom, LIMITS } from './core.mjs';
import { createServer } from './server.mjs';

test('cleanHit accepts real widget ids and rejects junk', () => {
  // a media clip with ads has a long id, and its ad events add a suffix
  assert.equal(cleanHit({ id: 'z.' + 'A'.repeat(900) + '.ad-pre-skip', k: 'click', h: 'x.com' }).k, 'click');
  assert.deepEqual(cleanHit({ id: '#059i148~Buy%20now~LMi4uKilgdXU_Ijs3KjY_dDk1N3UpMjUq', k: 'click', h: 'Example.COM' }),
    { id: '059i148~Buy%20now~LMi4uKilgdXU_Ijs3KjY_dDk1N3UpMjUq', k: 'click', h: 'example.com' });
  assert.equal(cleanHit({ id: 'z.HY1BDoIwEAC_Ysbr-wr', k: 'view', h: 'a.b:8080' }).h, 'a.b:8080');
  assert.equal(cleanHit({ id: 'abc', k: 'view', h: 'https://evil.com/path?x=1' }).h, 'unknown');   // never keep a full URL
  for (const bad of [null, 'x', {}, { id: '', k: 'click' }, { id: 'a b', k: 'click' }, { id: 'a<b>', k: 'click' }, { id: 'a', k: 'delete' }, { id: 'a'.repeat(1501), k: 'click' }])
    assert.equal(cleanHit(bad), null, JSON.stringify(bad));
});

test('Stats counts clicks and views per widget and per host', () => {
  const s = new Stats();
  s.hit({ id: 'A', k: 'view', h: 'shop.com' }, 1000);
  s.hit({ id: 'A', k: 'click', h: 'shop.com' }, 2000);
  s.hit({ id: 'A', k: 'click', h: 'blog.org' }, 3000);
  s.hit({ id: 'B', k: 'click', h: 'blog.org' }, 4000);
  const snap = s.snapshot(0, 5000);
  assert.deepEqual(snap.total, { clicks: 3, views: 1, widgets: 2 });
  assert.equal(snap.widgets[0].id, 'A');                                                    // most clicks first
  assert.deepEqual(snap.widgets[0].hosts, { 'shop.com': { clicks: 1, views: 1 }, 'blog.org': { clicks: 1, views: 0 } });
  assert.equal(snap.widgets[0].lastClick, 3000);
  assert.equal(snap.seq, 4);
  assert.deepEqual(s.snapshot(2).events.map(e => e.seq), [3, 4]);                            // only what the monitor has not seen
  s.reset('A'); assert.equal(s.snapshot().total.widgets, 1); assert.ok(!s.snapshot().events.some(e => e.id === 'A'));   // its feed entries go too
  s.reset(); assert.equal(s.snapshot().total.widgets, 0);
});

test('memory stays bounded', () => {
  const s = new Stats();
  for (let i = 0; i < LIMITS.maxWidgets + 50; i++) s.hit({ id: 'w' + i, k: 'view', h: 'x.com' }, i);
  assert.equal(Object.keys(s.widgets).length, LIMITS.maxWidgets);
  assert.ok(s.widgets['w' + (LIMITS.maxWidgets + 49)]);                                      // newest kept
  assert.equal(s.widgets.w0, undefined);                                                     // oldest dropped
  for (let i = 0; i < 300; i++) s.hit({ id: 'one', k: 'click', h: `h${i}.com` }, 10_000 + i);
  assert.ok(Object.keys(s.widgets.one.hosts).length <= LIMITS.maxHosts + 1);                 // + the "other" bucket
  assert.ok(s.events.length <= LIMITS.maxEvents);
});

test('rate limiter, key compare and header parsing', () => {
  const r = new RateLimiter(3, 1000);
  assert.deepEqual([1, 2, 3, 4].map(() => r.allow('ip', 0)), [true, true, true, false]);
  assert.equal(r.allow('ip', 1500), true);                                                   // new window
  assert.equal(r.allow('other', 0), true);
  assert.ok(sameKey('secret', 'secret')); assert.ok(!sameKey('secret', 'secreT')); assert.ok(!sameKey('', ''));
  assert.equal(keyFrom({ authorization: 'Bearer abc ' }), 'abc');
  assert.equal(keyFrom(new Headers({ 'x-admin-key': 'k1' })), 'k1');
});

// The same checks run against the self-host server and, when WORKER_URL is set, the real Worker (via wrangler dev).
async function apiChecks(t, base, key) {
  const post = (body, h = {}) => fetch(base + '/hit', { method: 'POST', headers: { 'Content-Type': 'text/plain', ...h }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const stats = (since = 0, k = key) => fetch(`${base}/stats?since=${since}`, { headers: k ? { Authorization: 'Bearer ' + k } : {} });
  const id = 'api' + Math.random().toString(36).slice(2, 8);

  await t.test('hits are accepted silently, junk is ignored', async () => {
    assert.equal((await post({ id, k: 'view', h: 'site.com' })).status, 204);
    assert.equal((await post({ id, k: 'click', h: 'site.com' })).status, 204);
    assert.equal((await post({ id, k: 'click', h: 'site.com' })).status, 204);
    assert.equal((await post('not json')).status, 204);
    assert.equal((await post({ id: '<script>', k: 'click' })).status, 204);
  });
  await t.test('stats need the admin key', async () => {
    assert.equal((await stats(0, '')).status, 401);
    assert.equal((await stats(0, 'wrong-key')).status, 401);
    const r = await stats();
    assert.equal(r.status, 200);
    const data = await r.json();
    const w = data.widgets.find(x => x.id === id);
    assert.equal(w.clicks, 2); assert.equal(w.views, 1);
    assert.deepEqual(w.hosts['site.com'], { clicks: 2, views: 1 });
    assert.ok(!data.widgets.some(x => x.id.includes('script')));
    assert.ok(data.events.filter(e => e.id === id).length === 3);
  });
  await t.test('live cursor returns only new events, CORS lets the builder read it', async () => {
    const before = (await (await stats()).json()).seq;
    await post({ id, k: 'click', h: 'site.com' });
    const r = await stats(before);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    const data = await r.json();
    assert.equal(data.events.length, 1); assert.equal(data.events[0].k, 'click');
    const pre = await fetch(base + '/stats', { method: 'OPTIONS', headers: { Origin: 'https://epicproject.github.io', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
    assert.ok(pre.status === 204 || pre.status === 200);
    assert.match(pre.headers.get('access-control-allow-headers') || '', /authorization/i);
  });
  await t.test('reset needs the key and removes the widget', async () => {
    assert.equal((await fetch(`${base}/reset?id=${id}`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`${base}/reset?id=${id}`, { method: 'POST', headers: { Authorization: 'Bearer ' + key } })).status, 200);
    assert.ok(!(await (await stats()).json()).widgets.some(x => x.id === id));
  });
}

test('self-host server', async t => {
  const server = createServer({ adminKey: 'test-key' });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await apiChecks(t, base, 'test-key');
    await t.test('without ADMIN_KEY the stats stay locked', async () => {
      const locked = createServer({});
      await new Promise(r => locked.listen(0, '127.0.0.1', r));
      const r = await fetch(`http://127.0.0.1:${locked.address().port}/stats`, { headers: { Authorization: 'Bearer anything' } });
      assert.equal(r.status, 503);
      locked.close();
    });
    await t.test('rate limit: a flood from one address is capped', async () => {
      const flood = createServer({ adminKey: 'k' });
      await new Promise(r => flood.listen(0, '127.0.0.1', r));
      const fb = `http://127.0.0.1:${flood.address().port}`;
      for (let i = 0; i < 150; i++) await fetch(fb + '/hit', { method: 'POST', body: JSON.stringify({ id: 'spam', k: 'click', h: 'x.com' }) });
      const data = await (await fetch(fb + '/stats', { headers: { Authorization: 'Bearer k' } })).json();
      assert.equal(data.widgets.find(w => w.id === 'spam').clicks, 120);
      flood.close();
    });
  } finally { server.close(); }
});

test('cloudflare worker (wrangler dev)', { skip: !process.env.WORKER_URL }, async t => {
  await apiChecks(t, process.env.WORKER_URL, process.env.ADMIN_KEY || 'test-key');
});
