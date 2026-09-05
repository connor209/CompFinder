# Live stream: auctioning off the scans

Cards go up on eBay Live from the photographs already on their listings, with
a host talking through each lot. The card itself stays in its stack until it
sells.

The point is handling. Every card here is already pulled once, scanned,
conditioned, SKU'd and priced. Pulling all of them again to wave each one at a
lens — and then filing them back — is the same work twice, on the one evening
you are also trying to talk to a room.

```
My listings ──＋ Stream──▶ relay (127.0.0.1:4455) ──SSE──▶ /overlay  → OBS browser source
                             │
                             └──────────────────────────▶ /        → the host's desk
```

## Running one

```
npm run stream                       # the relay; leave it up for the stream
```

Then, once:

- **OBS** → Sources → **Browser** → URL `http://127.0.0.1:4455/overlay`,
  1920×1080. Put it in the scene where the card should sit. It has a
  transparent background, so it composites over your camera.
- **A second window** on `http://127.0.0.1:4455/` — the host's desk. What is on
  air, how long it has left, what is next, and the controls.
- In the app, **My listings** → **🔴 Live stream mode**. The strip says whether
  the relay is up and repeats the OBS URL.

The relay only accepts requests from origins it knows. `http://localhost:3000`
and `http://127.0.0.1:3000` are built in; for the deployed app, start it with
the origin:

```
STREAM_ALLOW_ORIGIN=https://comp-finder.vercel.app npm run stream
```

It prints what it accepts on startup. A `＋ Stream` button that does nothing is
almost always this, and the relay's own log is the fastest way to see it.

Then: price a card (**Check price**), press **＋ Stream**, and it joins the
queue. Auto-advance is ~30 seconds a lot; <kbd>space</kbd> holds, arrows move,
and the desk has the same controls for a mouse.

## What eBay actually requires

Read off eBay's own eBay Live policy pages, 2026-09. Worth re-reading before
any change to the format, because two of the rules below are the reason this
module is shaped the way it is.

- **A stream must stay hosted and active.** eBay ends one automatically after
  60 minutes of inactivity (case breaks excepted), and flags a stream as
  abandoned when the host is not visible or speaking for several minutes, when
  the screen is empty or shows a placeholder, or when there is no real product
  discussion. **A fully automated, hostless stream is not viable** — which
  rules out the version of this idea with nobody in the chair. A live host
  presenting pre-scanned photographs is squarely fine.
- **The camera-framing rules that require the item in frame are scoped to pack
  rips, case breaks and unboxings.** They do not reach presenting singles that
  are already graded and photographed.
- **What is shown live must match the listing**, sellers may not change what is
  on offer mid-stream, and no false or misleading claim may be made about
  condition, authenticity or value.

Two of those are load-bearing here:

**The pictures are the listing's pictures.** Not a scan store of our own, not
catalogue art. `fetchItemPictures()` asks eBay for the item's own
`PictureDetails.PictureURL` set when the lot is queued, and the overlay cycles
them in the listing's order. It costs one GetItem call per lot, which is
affordable exactly here — a lot is queued by hand, seconds before a host talks
over it for half a minute — and would not be anywhere else in this app.

**Standby renders nothing at all.** The overlay is transparent and draws
nothing between lots, rather than a holding card. An empty or placeholder
screen is one of eBay's stated markers for an abandoned stream, and the honest
picture between lots is the host on camera.

## The real exposure is disputes, not policy

Selling without ever showing the physical card live gives up the "the buyer
watched me handle this exact card" defence in an item-not-as-described case.

That is much reduced here, because every card is individually SKU'd against
its own scan and its own stack position, so what was sent is traceable to what
was photographed. Two residual risks are worth naming rather than dismissing:

- **Condition drift.** A card scanned months ago and handled since is being
  sold on an old photograph. The scan is evidence of the card's condition on
  the day it was scanned, not today.
- **Buyer pushback**, which is not the same thing as being wrong. Some buyers
  simply expect to see the card on camera, and a sound process does not change
  how it feels.

Showing the listing's own pictures is the mitigation that costs nothing: a
buyer disputing the card afterwards is looking at the same photographs the
stream showed them.

## The rules the code holds

All of them live in `apps/app/lib/livestream.js`, and
`scripts/check-livestream.mjs` pins every one.

- **A lot is an allow-list**, built key by key — the same discipline as
  `counterRow()` in `showcounter.js` and for a harder reason. The counter is
  one customer across a table; this is a broadcast, and a broadcast is
  recorded. The SKU is the clearest exclusion: it is a stack name plus a
  position, so it says out loud how deep the stock runs.
- **A held price is never broadcast as a figure.** `stickerFor()` in
  `showstock.js` is the gate: low or no confidence, or a price built from
  asking prices rather than sales, gets no number on air. eBay's rule about
  misleading claims about value is the same rule this repo already runs on its
  own stickers, and every reason to hold one back is stronger in front of a
  camera. A held lot goes out with **no value line at all** — not a hedge, not
  a blank box where the last lot had a number.
- **The figure is the engine's, not the sticker's.** `stickerFor()` decides
  *whether*; `effectivePence()` supplies *what*. The first version read both
  off the sticker and put "£85 recent sold" on air for an £84 card, because the
  sticker rounds onto a cash ladder for a table. That is a false statement about
  value in eBay's sense, made by rounding.
- **Nothing is held quietly.** The reason goes to the host, in prose, at the
  moment the lot is queued — the person about to talk over it for thirty
  seconds is who needs it. It never goes to the relay or the overlay.
- **The relay never builds a lot.** It accepts or refuses. `sanitiseLot()` is
  a bouncer: it strips a figure from a lot marked held, drops any field nobody
  allowed, and refuses a lot outright rather than half-rendering one. Two ends
  written on different days need the rule at both.
- **A lot with no pictures is refused**, and the refusal says so in prose.
- **127.0.0.1 only.** The machine running OBS is on hall or hotel wifi. Bound
  to every interface, the relay serves the queue, the stock and the prices to
  everyone else in the building. The origin allow-list is the same rule one
  layer up: without it, any page open in that browser can read the queue.

## Things that will bite

- **Chrome's Private Network Access.** A page on `https://` asking anything of
  a loopback server gets a preflight, and without
  `Access-Control-Allow-Private-Network: true` it is blocked with nothing
  useful in the console. The relay answers it. (Loopback is a *potentially
  trustworthy* origin, so this is not blocked as mixed content — but Safari
  does not implement that the same way, which is one more reason the producer
  is a laptop next to the OBS machine.)
- **The queue is in memory and dies with the relay.** A queue is a session:
  the lots in it are the next twenty minutes, they are re-added in seconds, and
  a queue restored after a crash is a list of cards that may already have sold.
  Same reasoning as `DEAL_TTL_MS`, shorter fuse.
- **The queue does not wrap.** Running off the end parks the stream on nothing
  rather than restarting the list, because a stream that quietly began again is
  a stream auctioning the same card twice. A lot queued after that airs
  immediately — and it airs *that* lot, not the front of the queue, which was
  the first version's bug.
- **Server-Sent Events, not a WebSocket.** The traffic is one-directional and
  the controls are ordinary POSTs, so a socket buys nothing and costs either a
  dependency or a hand-rolled frame parser. What `EventSource` adds is the
  thing that matters in a hall: it reconnects on its own, forever, with no
  code. OBS routinely opens a browser source before the relay is running.
- **The relay imports from `apps/app/lib`**, so it must be run from a checkout
  of this repo with `npm install` done. It has no dependencies of its own,
  deliberately — it has to start on a laptop in a venue.

## A second producer, later

Nothing about the relay knows where a lot came from. Anything that can POST
this can feed the stream:

```
POST http://127.0.0.1:4455/queue
{ "lot": { "id": "1234567890", "name": "Gengar VMAX 020/198",
           "condition": "Near Mint", "valuePence": 8400, "valueText": "£84",
           "valueLabel": "Recent sold", "valueHeld": false,
           "images": ["https://i.ebayimg.com/…/s-l1600.jpg", …] } }
```

A browser extension reading the item number off an open eBay listing page is
the obvious one, and it is the shape the original brief for this module
described. It was not built first for one reason: the name, condition and
value are not on that page in a form worth trusting — they are in Supabase,
behind the app's own login. An extension would need its own auth to resolve a
SKU into a lot, which is a second auth surface for data the app already has
open. If that changes, the contract above is the whole of what it has to
satisfy, and `sanitiseLot()` will refuse anything that doesn't.
