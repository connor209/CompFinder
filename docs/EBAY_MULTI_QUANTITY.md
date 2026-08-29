# Multi-quantity listings, and seating the next scan when one sells

Research report, 2026-08-29. Question: we hold many duplicates of the same
card and each one is its own eBay listing. Other platforms consolidate those
into a single multi-quantity listing whose photo is the first available scan,
and re-seat the next scan when a copy sells. Can we do that, and is the
re-seating actually possible through the eBay API?

Nothing here touches `packages/core`. This is entirely **the app**
(`apps/app`) — eBay OAuth, inventory, stacks, the Show Desk. Last Comp is
unaffected.

## TL;DR

- **Both halves are possible.** Multi-quantity fixed-price listings are
  ordinary eBay; and after a sale eBay freezes only Title, Primary Category,
  Secondary Category, Listing Duration and Listing Type. **Pictures are not
  frozen** — `ReviseFixedPriceItem` can re-seat the gallery image on a listing
  that has already sold copies.
- **The eBay side is the easy half.** The app already sends `<Quantity>` on
  `AddFixedPriceItem` and already has `reviseItemQuantity`. What is missing is
  one call: `ReviseFixedPriceItem` with `PictureDetails`. Roughly forty lines,
  the same shape as `endListing` and `relistListing` in `apps/app/lib/ebay.js`.
- **The hard half is ours, and it is the SKU.** The whole app is built on
  *one listing = one physical card = one SKU*: `stockcheck.js` matches on it,
  `stack_cards.sku` is per-card, the Show Desk writes stickers back by it, and
  `isListingAvailable` reads a per-listing quantity. A quantity-10 listing
  makes one eBay SKU stand for ten physical cards, and every one of those
  paths needs a join it does not currently have.
- **The real prize is not fewer listings, it is sales history.** Cassini ranks
  on it, and it attaches to the item id. Ten listings with one sale each rank
  worse than one listing with ten. Consolidation concentrates that, and a GTC
  listing keeps its item id, URL, watchers and history across renewals.
- **The sharp edge is the buyer's own order record.** eBay shows the listing's
  *current* picture, not the picture at the moment of purchase. Swap the scan
  the instant a copy sells and the buyer who just bought is looking at a
  different card than the one they clicked. That is an item-not-as-described
  dispute we would lose. **Delay the re-seat until dispatch or settlement** —
  it costs nothing and removes the whole class of problem.
- **Scope it, don't apply it everywhere.** Multi-quantity is a claim that the
  copies are interchangeable. That is true of NM commons and false of anything
  a buyer picks on the scan. Consolidate within one condition band, below a
  value threshold; leave chase cards one-per-listing.

---

## 1. Can we list one card at quantity ten?

Yes, and we nearly do already.

`addFixedPriceListing()` in `apps/app/lib/ebay.js` already writes
`<Quantity>${Math.max(1, parseInt(L.quantity, 10) || 1)}</Quantity>`, and both
`ListForm` and `BulkListModal` expose a quantity input — they just default to
1, because every caller has so far had exactly one physical card in hand.

`reviseItemQuantity()` already exists too, using `ReviseInventoryStatus` — the
lightweight call that changes only price and quantity. It is the right call for
stock movements and the wrong one for pictures: it cannot carry
`PictureDetails`.

So on eBay's side, consolidating ten duplicate listings into one is: end nine
listings, revise the tenth to quantity ten. Both calls exist today.

## 2. Can the picture be changed after a copy has sold?

Yes. This is the load-bearing fact and it is documented rather than inferred.

eBay's `ReviseFixedPriceItem` reference states:

> After one item in a multi-quantity fixed-price listing has been sold, you
> cannot change the values in the Title, Primary Category, Secondary Category,
> Listing Duration, and Listing Type fields.

`PictureDetails` is not on that list, and the same page confirms the remaining
fields stay editable. Sales do not lock the images.

Four mechanical details that decide the implementation:

- **`PictureDetails` is a full replacement, not a delta.** You send the whole
  ordered list of `<PictureURL>` elements; the first is the gallery image.
  "Seating the next scan" is therefore: re-send the list with the sold copy's
  scan removed. There is no per-image endpoint.
- **24 pictures per listing.** So a listing can carry every copy's scan up to
  23–24 copies. Past that, keep only the current copy's scan on the listing and
  swap it each time — same call, shorter list.
- **Do not mix self-hosted and EPS-hosted URLs in one listing.** We self-host
  in the public `listing-photos` Supabase bucket over HTTPS (migration 012),
  which is exactly what eBay wants, so this is a rule to not break rather than
  a problem to solve. Related and worth noting on the way past:
  `UploadSiteHostedPictures` is deprecated and decommissioned **30 September
  2026** — a month away. We do not use it, so we are not affected, and we
  should not start.
- **Revisions count against the Trading API call limit** (5,000/day by
  default). One revise per sale is not close to it.

### A note on the other route

The modern REST alternative is the Sell Inventory API: an inventory item
carries `product.imageUrls` and an `availability` quantity, and
`createOrReplaceInventoryItem` pushes changes through to the published offer,
images included. It is a better-shaped model for exactly this problem —
quantity and images live on the *item*, not on the listing.

We should not switch for it. The app is Trading API throughout — auth,
`GetMyeBaySelling`, `AddFixedPriceItem`, the revise and end calls, the sync —
and migrating to the Inventory API means migrating existing listings into
inventory items, which is a much larger job than adding one Revise call.
Worth knowing it is there; not worth the detour.

## 3. How do we know a copy sold, and how fast?

`FixedPriceTransaction`, a Platform Notification, is
*"sent each time a buyer purchases an item in a single or multiple-quantity,
fixed-price listing."* That is precisely the event, and it names the
multi-quantity case explicitly.

The alternative is polling. The app already syncs sales
(`syncUserSales`, Fulfillment API) — but only from the **daily** cron in
`apps/app/app/api/cron/sync/route.js`. A day is far too coarse for this: a card
would keep showing a scan of a copy that has already been posted to someone.

So: webhook for the trigger, and keep a poll as the safety net for notification
delivery failures, since a missed notification means a wrong picture that never
self-corrects.

## 4. What eBay hands back, and what it does not

The order line item gives us the item id, the SKU and a quantity. It does
**not** say which physical copy the buyer got — because from eBay's side there
is no such thing. All ten are one SKU.

That is our decision to make, and it has to be made in exactly one place: the
copy at the head of the picture queue is the copy that sold, because it is the
one whose scan was on screen. **The picture order is the pick order.** Those
two must never be separately derived, for the same reason
`apps/app/lib/stackpos.js` exists — two screens each confidently reporting a
different card is invisible until the wrong card is in the envelope.

## 5. What this costs us on our side

This is the part the eBay documentation cannot help with, and it is most of the
work.

**One SKU now names ten cards.** Today a SKU is one individual card, all the
way from CardUploader to the listing to the sticker — that is stated in
`docs/SOP_STACK_TO_LISTING.md` and relied on by:

| Where | What it assumes |
|---|---|
| `lib/stockcheck.js` | `bySku` maps a SKU to the listing(s) for that card |
| `lib/stackpos.js` | `stack_cards.sku` is one physical card at one position |
| `lib/showstock.js` | `checkRow()` reads "what we already ask on eBay" per card |
| `lib/showfilter.js` | rows are physical cards, searched by SKU |
| Stacks → Reconcile | a listing at quantity 0 means the card has gone |

`isListingAvailable` is the one that already half-anticipates this: it reads
quantity rather than presence, and treats a missing quantity as unknown. Under
multi-quantity, quantity stops being a boolean and starts being a count of
cards still in the stack — which is arguably what it always meant.

**What is missing is a join.** Something like `listing_copies`: one row per
physical copy behind a multi-quantity listing, carrying the eBay item id, the
queue position, the scan URL, the `stack_cards` id, and a `sold_at`. That table
is what lets a sale of "one of ten" resolve to a specific card in a specific
stack at a specific position — which is the thing the Show Desk, the pull sheet
and the reconcile screen all need and none of them can currently get.

## 6. Two risks worth taking seriously

**The buyer's order record shows the current picture.** eBay does not snapshot
the gallery image at purchase. Re-seat the moment a copy sells and the buyer
who bought thirty seconds ago now sees somebody else's scan on their order.
On a 50p NM common nobody looks and nobody cares. On a card where the buyer
chose *this copy* because of the centring, that is an INAD case with the
listing itself as the evidence against us.

The fix is free: **do not re-seat on the sale, re-seat on dispatch** (or after
a settlement window). The picture stays correct for as long as the buyer is
likely to look at it, and the next copy is seated before the listing is next
seen by anyone new. It also removes the awkward case of a cancelled or
unpaid order, where the copy has to go back into the queue.

**Multi-quantity is a claim of interchangeability.** Listing ten copies at one
price says these ten are the same thing. Where they genuinely are — same
printing, same condition band, scan is illustrative — that claim is true and
the consolidation is honest. Where the scan *is* the product, it is not, and
"you will receive a card of equivalent condition" is a materially different
offer that will produce returns.

So the rule is scope, not capability:

- Consolidate **within one condition band** (NM with NM, LP with LP — the bands
  the SOP already uses), never across.
- Consolidate **below a value threshold**. The threshold is a business call, not
  a technical one; anything where a buyer would zoom in on the picture is
  above it.
- Leave graded slabs alone entirely. A slab is a specific certified object with
  a cert number on it — it is a quantity of one by definition.
- Say what the listing is. If the picture is representative rather than the
  exact card, the description has to say so, once, plainly.

## 7. The upside, restated

The listing-count reduction is the visible win, but it is the smaller one.

- **Sales history concentrates.** It attaches to the item id and it is one of
  the strongest Best Match inputs there is. A GTC listing keeps its item id,
  URL, watchers and history across renewals, so a consolidated listing
  compounds where ten separate ones each start from zero.
- **Watchers concentrate** on one page instead of being split ten ways.
- **One insertion fee instead of ten**, and headroom under the free-listing
  allowance.
- **Less to maintain.** One price revision instead of ten when the market
  moves — and `reviseItemPrice` already exists.

## 8. If we build it

Sketch, in dependency order. Nothing in `packages/core` is touched.

1. **`reviseListingPictures(accessToken, itemId, imageUrls)`** in
   `apps/app/lib/ebay.js` — `ReviseFixedPriceItem` carrying only `<ItemID>`
   and `<PictureDetails>`. Same shape as the Revise/End calls already there.
2. **Migration: `listing_copies`** — the join described in §5, RLS per user
   like every other table here, applied by hand and read optionally (migrations
   in this repo ship after the code, and Postgres rejects a whole statement
   naming a missing column).
3. **`apps/app/lib/listingqueue.js`** — the one definition of the queue: which
   copy is seated, what the picture list is, which copy a sale consumes, what
   happens to a cancelled order. Plus `scripts/check-listingqueue.mjs` with a
   grep against a second derivation, per the convention the rest of the repo
   already follows.
4. **`/api/ebay/notifications`** — Platform Notifications endpoint subscribed
   to `FixedPriceTransaction`; marks the head copy sold, and schedules the
   re-seat rather than performing it inline (see §6).
5. **A re-seat worker** — runs the pending re-seats once the dispatch or
   settlement condition is met. Idempotent: it recomputes the picture list from
   `listing_copies` and revises only if it differs from what eBay last
   confirmed, so a replayed notification is free.
6. **A consolidation tool** — takes the duplicates we already have, groups them
   by card and condition band, and does the end-nine-revise-one. This is the
   one-off that pays for the whole exercise, and it should be a dry-run-first
   screen showing exactly which listings would be ended, because ending a
   listing throws away its sales history and is not undoable.

The order matters: 1–3 are testable with no eBay traffic at all, and 6 should
not be built until 4 and 5 are proven on a handful of low-value cards.

## Sources

- [ReviseFixedPriceItem — Trading API](https://developer.ebay.com/devzone/xml/docs/reference/ebay/ReviseFixedPriceItem.html)
- [ReviseInventoryStatus — Trading API](https://developer.ebay.com/devzone/xml/docs/reference/ebay/ReviseInventoryStatus.html)
- [NotificationEventTypeCodeType — Trading API](https://developer.ebay.com/devzone/xml/docs/reference/ebay/types/NotificationEventTypeCodeType.html)
- [Platform Notifications](https://developer.ebay.com/api-docs/static/platform-notifications-landing.html)
- [Listing items with multiple pictures](https://developer.ebay.com/support/kb-article?KBid=1240)
- [Picture hosting](https://developer.ebay.com/api-docs/user-guides/static/trading-user-guide/picture-hosting.html)
- [createOrReplaceInventoryItem — Inventory API](https://developer.ebay.com/api-docs/sell/inventory/resources/inventory_item/methods/createOrReplaceInventoryItem)
