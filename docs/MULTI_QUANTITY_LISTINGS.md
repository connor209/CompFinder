# One listing, several copies — and how to test it before trusting it

**Status: not built.** This is the design, the parts of it that are already
here, and — the actual question — how to test each part without finding out on
a customer.

The method: one eBay listing at quantity 3 backed by three physical copies of
the same card, each with its **own scan**, its **own stack position** and its
own internal SKU. A copy sells; the listing's picture becomes the next copy's
scan; the app tells you which stack to walk to and how far to count.

---

## The one fact the whole design hangs on

**eBay reports the LISTING's SKU on a sale, never the copy's.** A multi-quantity
listing has one item id and one Custom Label. When `syncUserSales` brings back
a line item, it says *this listing sold two*, and there is nothing in it that
distinguishes copy 1 from copy 2.

So the ordering is **ours**, not eBay's. The app owns a queue per listing, the
head of the queue is the copy currently photographed and the copy to pull next,
and a sale consumes from the head. Nothing about that is inferable after the
fact, which means the queue has to be recorded as it happens rather than
reconstructed — and it means the buyer's receipt is our word for which card
went in the envelope.

That has a consequence worth deciding on deliberately rather than discovering:
**the buyer bought the card in the photo.** Photographing each copy separately
is an admission that the copies differ. If they differ enough to be worth
separate scans, then a two-at-once sale hands the second buyer a card whose
scan they never saw. Two honest positions:

- **Pool only copies that are genuinely interchangeable** (same condition
  grade, no distinguishing wear) and treat the rotating scan as courtesy rather
  than contract; or
- **Say so in the listing** — "photo is of a representative copy; all copies
  are NM" — which is the standard multi-quantity convention and is what most
  volume sellers do.

Rotating a per-copy scan while implying the photo is *the* card is the one
version of this that generates returns.

---

## What is already here

| Piece | Where | State |
|---|---|---|
| A physical copy with its own SKU and position | `stack_cards` (migration 008) | ✅ several rows may already share one `ebay_item_id` — nothing stops it |
| "Where do I walk, and how far do I count" | `liveRanks` / `locationsBySku` in `apps/app/lib/stackpos.js` | ✅ pulled and checked-out copies already close the numbering up, which is exactly what consuming the head of a queue needs |
| Per-copy scans on a public URL eBay can fetch | `listing-photos` bucket (migration 012), upload flow in `ListForm.js` | ✅ one path per file already |
| Sale detection with quantity | `ebay_sales` (migration 007), `syncUserSales` | ✅ `line_item_id` is the primary key |
| Quantity revision | `reviseItemQuantity` in `apps/app/lib/ebay.js` | ✅ |
| **Picture revision** | — | ❌ **missing.** `ReviseInventoryStatus` does price and quantity only |
| The queue itself — order within a listing, and each copy's scan | — | ❌ missing: `stack_cards` has no `copy_seq` and no `scan_url` |

Three constraints the existing code imposes on any design:

- **`syncUserListings` deletes and re-inserts every `ebay_listings` row
  wholesale.** Nothing may hang off those rows' identity. The queue lives in
  `stack_cards`, keyed by `ebay_item_id`.
- **`isListingAvailable` already knows a quantity-0 listing is a card that has
  gone**, and a missing quantity is silence rather than a zero
  (`apps/app/lib/stockcheck.js`). A queue that empties must drive quantity to 0
  through that same rule, not invent a second one.
- **A copy at a show is not a copy you can post.** `checked_out_at` has to take
  a copy out of the queue *and* off the listing's quantity, or the desk sells
  it twice.

---

## The mechanics, and the two that will bite

**Swapping the picture needs `ReviseFixedPriceItem`, not
`ReviseInventoryStatus`** — `<Item><ItemID/><PictureDetails><PictureURL/>…`.
`PictureURL` **replaces the whole set**, so every revision sends the full list
in the order you want them shown.

**eBay caches images by URL.** Overwriting the bytes at the same storage path
and re-revising will change nothing visible — eBay serves what it already
fetched. Each copy's scan therefore needs its **own distinct URL**, which the
`listing-photos` bucket gives you for free as long as nothing upserts over a
path. Anything that reuses a path (`upsert: true`, a `latest.jpg` convention)
breaks this silently and looks like the revise call failing.

**Drive the queue off `ebay_sales` line items, not off a quantity delta.** The
delta is tempting — `syncUserListings` already brings `quantity` and
`extra.quantitySold` back — and it is wrong twice over: it cannot tell a sale
from your own revision, and it is not idempotent, so a re-sync double-consumes.
A line item is keyed by `line_item_id` and carries its own `quantity`; consume
against a recorded set of line items already applied and a replayed sync is a
no-op by construction.

---

## How to test it — four rungs, cheapest first

### 1. Offline, pure logic — `scripts/check-copyqueue.mjs`

Where everything in this repo gets tested, and where the failures that actually
cost cards live. A framework-free `apps/app/lib/copyqueue.js` with a check
script over table cases, in `npm run check`. The cases that matter:

- one sale of quantity 1 consumes the head, and the next scan becomes the
  listing picture;
- **one sale of quantity 2 consumes two copies** — and names both, because the
  pull sheet has to send you to two places;
- **the same `line_item_id` replayed consumes nothing** (the idempotence rule
  above — this is the one that quietly eats stock);
- line items arriving out of date order still consume in queue order;
- a copy checked out to a show is not offered as next, and the listing quantity
  drops with it;
- the queue running empty drives quantity to **0**, never negative, and issues
  no picture revision;
- a returned copy goes back — and where in the order;
- the picture list handed to eBay is the full set, head first, with distinct
  URLs.

Costs nothing, runs in milliseconds, no eBay account involved. Every rule above
is decidable here, and this rung is where the design gets settled.

### 2. Replay against your own real sales, read-only

A `scripts/replay-copyqueue.mjs` in the shape of the existing audit scripts:
read your real `ebay_sales` rows for listings that already ran at quantity > 1,
re-derive what the queue *would* have said, and print the picture swaps and
pull instructions it would have issued. **Writes nothing, calls no eBay
endpoint.** This is the "does it survive real data" test — messy line items,
multi-quantity orders, cancellations, the sync gaps — and it is free.

### 3. eBay Sandbox — for the write calls only

Answers exactly two questions and nothing else:

1. Does `ReviseFixedPriceItem` change `PictureDetails` on a **fixed-price
   listing that already has sales**? (Revising a listing with sales is
   restricted for some fields; pictures are generally allowed, and "generally"
   is not good enough to build on.)
2. What does eBay do when the last copy goes and quantity is revised to 0 —
   does the out-of-stock control hold the item id, as `reviseItemQuantity`'s
   comment says it does when enabled?

Note the cost: **`apps/app/lib/ebay.js` hardcodes production hosts**
(`api.ebay.com`) in six places — OAuth, Trading, Browse, Fulfillment, Account.
Sandbox needs a host switch (`EBAY_ENV=sandbox` → `api.sandbox.ebay.com`), a
separate sandbox app keyset, and sandbox seller *and* buyer accounts to make an
order exist. That is a day's work and it is worth it only for those two
questions. Sandbox will **not** tell you about revision rate limits, image-cache
behaviour, or how the gallery thumbnail updates in search results.

### 4. One live canary — the only rung that actually answers it

One real listing. A card you hold three of and would not mind losing money on.
Distinct scans per copy. **Driven by hand the first time** — you press revise,
you reload the listing page, you look.

What to watch, because none of it is visible from the API:
- does the **main picture** change on the live listing page, and how long does
  the **gallery thumbnail in search results** take to follow (it lags);
- does a revision mid-listing reset anything you care about — watchers,
  Promoted Listings, the item's position in search;
- what the listing looks like to a buyer mid-rotation, especially if the
  description references the photo;
- whether the order confirmation still ties back to the right stack row on your
  side.

Only after that does anything get automated.

---

## The test that decides whether the method is worth having at all

The rungs above test whether it *works*. They do not test whether it is
**better**, and the honest answer is that it might not be:

- **One listing at quantity 3 gets one listing's worth of exposure**, not
  three. Three separate listings occupy three slots in a buyer's search
  results; one occupies one. For a card with steady demand that is fine — for a
  slow-moving card, three shots at being seen is the whole game.
- Promoted Listings, Best Offer and watchers all apply **per listing**.
- Against that: one listing accumulates all the sales history and watchers,
  needs one price revision instead of three, and one photo rotation instead of
  three relists.

That is an empirical question and this repo already has a discipline for those
— *measure before adding a pricing rule*. The same applies here. Take ~20 cards
held in triplicate, list half as **3 × quantity 1** and half as **1 × quantity
3**, leave them 30 days, and compare days-to-first-sale, total sold and final
price. Twenty cards is enough to see a large effect and not enough to see a
small one, which is the right resolution for a decision this size.

Run that before building rung 1, not after. If three singles win, none of the
rest of this is worth writing.

---

## If it goes ahead: migration 027

```sql
alter table public.stack_cards
  add column if not exists copy_seq integer,   -- order within one listing; the
                                              -- head is the pictured copy and
                                              -- the next one to pull
  add column if not exists scan_url text;      -- this copy's own scan, distinct
                                              -- URL per copy (eBay caches by URL)

create table if not exists public.listing_copy_events (
  -- Which line items have already consumed the queue. The idempotence rule
  -- above lives here rather than in code: a replayed sync must be a no-op even
  -- if the code forgets.
  ...
);
```

Applied by hand like every migration here, so **the code ships first and treats
both as optional** — the pattern `wants-store.js` and `batch-store.js` already
follow. A pending migration degrades to today's behaviour (one copy per
listing); it does not take the Inventory screen down.
