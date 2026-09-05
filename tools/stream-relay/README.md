# stream-relay

The local server between the app and OBS, for eBay Live auctions.

```
npm run stream                                          # from the repo root
STREAM_ALLOW_ORIGIN=https://your-app.vercel.app npm run stream
STREAM_PORT=4456 npm run stream                         # if 4455 is taken
```

- `http://127.0.0.1:4455/` — the host's desk (what is on air, what is next)
- `http://127.0.0.1:4455/overlay` — point an OBS **Browser Source** here

No dependencies, on purpose: this has to start on a laptop in a venue with no
`npm install` behind it. It does import `apps/app/lib/livestream.js`, which is
the one definition of what may be broadcast — so run it from a checkout of the
repo with the root install done.

**It never builds a lot**, only accepts or refuses one. The rules, the eBay
Live policy reading behind them, and the HTTP contract for a second producer
are in [`docs/LIVE_STREAM.md`](../../docs/LIVE_STREAM.md).
`scripts/check-livestream.mjs` pins all of it.
