# Hash Widget Monitor: live click / view counter

Every Hash Widget reports **one view** when it is shown and **one click** when it is tapped, with the widget ID and the website
that embeds it. The **Monitor** button (top right of the builder) shows the totals live.
Works for widgets on any website **and** for the Android Epic App (it uses the same IDs, host `android-app`).

GitHub Pages is static, so counting needs one small server. Two ways (same API, pick one):

## A) Cloudflare Worker (free, nothing to keep running)

```
cd analytics
npx wrangler login                    # opens the browser once
npx wrangler secret put ADMIN_KEY     # choose a long secret; only you need it
npx wrangler deploy                   # prints https://hash-widget-stats.<you>.workers.dev
```

## B) Your own PC / VPS

```
cd analytics
ADMIN_KEY=your-secret PORT=8790 node server.mjs     # data is kept in data.json
```
(needs a public https address if widgets are used on other people's sites, e.g. a Cloudflare Tunnel.)

## Turn it on

1. In `url/index.html` set `var ANALYTICS_URL = 'https://hash-widget-stats.<you>.workers.dev';` and push it to GitHub.
2. For the Android app add `"analytics": "https://hash-widget-stats.<you>.workers.dev"` at the top level of `screens.json` (https only).
3. Open the builder, click **Monitor**, paste the server address and your admin key. Done: counts update every ~1.5 s.

## What is stored (privacy)

Per widget ID: number of views, clicks, last click time, and counts per embedding **website name** (e.g. `shop.com`, never a full URL).
No cookies, no IP addresses, no user IDs. The visitor address is used only for a rate limit (120 hits/min) and is never saved.
Limits keep it bounded: 500 widgets, 40 websites per widget, last 200 events.
Reading stats needs your admin key; anyone can *send* hits (they are validated and rate limited), so counts can be inflated by someone
who knows the address. Treat them as analytics, not as proof for payments.

## API

| Call | Auth | Purpose |
|---|---|---|
| `POST /hit` body `{"id","k":"click"\|"view","h":"site.com"}` | none | record (always answers 204) |
| `GET /stats?since=<seq>` | `Authorization: Bearer <key>` | totals, per-widget numbers, events after `seq` |
| `POST /reset?id=<id>` (no id = everything) | key | forget one widget / all |

## Tests

`node --test test.mjs` (logic + self-host server). To also test the real Worker runtime:
`npx wrangler dev --local --port 8791 --var ADMIN_KEY:test-key` then
`WORKER_URL=http://127.0.0.1:8791 ADMIN_KEY=test-key node --test test.mjs`.
