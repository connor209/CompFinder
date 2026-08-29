# Multi-quantity listings — the implementation plan

Plan, 2026-08-29. The research that decides whether this is possible is
`docs/EBAY_MULTI_QUANTITY.md`; read that first. It answers *can we* — yes on
both halves, and pictures are not frozen by a sale. **This file answers *how*,
in what order, and what breaks on the way.**

Scope, stated once: this is **the app** (`apps/app`) only. `packages/core` is
untouched, so **Last Comp is unaffected** and no `npm run check` case about
pricing changes. Nothing here is a pricing change at all — it is an inventory
change wearing a listing's clothes.

---

## The one rule the whole thing hangs on

Today a SKU is one physical card, everywhere, without exception. That is what
`stockcheck.js`, `stackpos.js`, `showstock.js` and Reconcile all quietly rely
on, and consolidating ten duplicates into one quantity-ten listing is the first
time it stops being true.

The replacement rule has to be equally short, or the same confusion comes back
in a different shape:

> **eBay's quantity on a consolidated listing IS the count of unsold copies in
> `listing_copies`, and that count is derived in exactly one place.**

Everything else follows from it. If two screens can each compute how many
copies are left, they will disagree, and the disagreement is invisible — the
same failure `stackpos.js` and `price-override.js` were both written to end.
So the queue module is not an implementation detail of this feature; it *is*
the feature, and the eBay calls are plumbing hung off it.

The same applies to the picture list. **The picture order is the pick order** —
one derivation, never two. eBay cannot tell us which physical copy a buyer
got, because from its side there is no such thing; we decide, and the honest
decision is "the copy whose scan was on screen".

---

## Phase 0 — the decisions that are not ours to make in code

Three business calls. Phases 1–3 can be built without them; **phase 7 cannot
start until they are settled**, because it ends listings and that is not
undoable.

1. **The value ceiling.** Multi-quantity is a claim that the copies are
   interchangeable. True for a NM common where the scan is illustrative; false
   for anything a buyer zooms in on. Where is the line — £3? £10? A number is
   needed, and it is a judgement about your buyers, not a technical fact.
2. **Condition bands.** Consolidate NM with NM, LP with LP, never across — the
   bands `docs/SOP_STACK_TO_LISTING.md` already uses. Confirm those are the
   bands, and that the listing description says the picture is representative.
3. **Do the existing duplicates get consolidated at all?** There are two
   products here and only one of them is risky:
   - **New listings go up multi-quantity.** Cheap, reversible, nothing is
     destroyed. This is phases 1–6.
   - **Existing duplicates are consolidated retroactively.** This is phase 7,
     it means ending nine listings, and **ending a listing throws away its
     sales history permanently**. Since concentrated sales history is the
     actual prize here (§7 of the research), doing this carelessly destroys
     the thing it is meant to build.

   Graded slabs are excluded by definition either way — a cert number is a
   quantity of one.

My recommendation: build 1–6, run it on new listings for a few weeks, and only
then decide on 7 with real evidence of whether the consolidated listings
actually rank better.

---

## The shape: two tables, one module, one new eBay call

### Migration 026 — `listing_copies` and `listing_groups`

Applied by hand in the Supabase SQL editor, like every other migration here,
and therefore **read optionally**: the code ships first and Postgres rejects a
whole statement naming a missing column, so a required read would take out the
inventory screen for everybody, consolidated listings or not. Same discipline
as `pool_name` in migration 024.

```sql
-- One row per PHYSICAL card sitting behind a consolidated listing.
create table public.listing_copies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ebay_item_id text not null,        -- the consolidated listing
  stack_card_id uuid references public.stack_cards(id) on delete set null,
  sku text,                          -- the copy's own name; it never moves
  queue_pos integer not null,        -- picture order IS pick order
  image_url text,                    -- this copy's scan (listing-photos bucket)
  sold_at timestamptz,
  order_line_item_id text,           -- the sale that consumed it
  dispatched_at timestamptz,         -- when the re-seat became safe
  reseated_at timestamptz,
  created_at timestamptz not null default now()
);
-- A replayed notification must not consume a second copy.
create unique index listing_copies_line_item_idx
  on public.listing_copies (user_id, order_line_item_id)
  where order_line_item_id is not null;

-- One row per consolidated listing: what eBay last CONFIRMED we sent it.
create table public.listing_groups (
  user_id uuid not null references auth.users(id) on delete cascade,
  ebay_item_id text not null,
  pictures_sent jsonb not null default '[]'::jsonb,
  quantity_sent integer,
  pictures_sent_at timestamptz,
  last_error text,
  primary key (user_id, ebay_item_id)
);
```

**`listing_groups` exists because `ebay_listings` cannot hold this.**
`syncUserListings()` deletes the user's rows wholesale and re-inserts them on
every sync — anything durable stored there is gone within a day. That is not
obvious from reading the table definition and it would have been found the
hard way, on the first cron run after shipping.

RLS per user on both, select-only from the browser, writes via the service
role — the pattern `ebay_listings` already sets.

### `apps/app/lib/listingqueue.js` — the one definition

Framework-free and app-import-free, so `scripts/check-listingqueue.mjs` can
load it under bare node, exactly like `stackpos.js` and `showstock.js`.

```js
seatedCopy(copies)              // head of the queue: lowest queue_pos, unsold
pictureList(copies, { max=24 }) // ordered URLs; seated first; capped
quantityFor(copies)             // count of unsold — the ONLY derivation
consumeSale(copies, { lineItemId, quantity })  // which copies a sale takes
returnCopy(copies, copyId)      // cancelled/unpaid → back to the HEAD
needsReseat(copies, group)      // pictureList() vs group.pictures_sent
```

`returnCopy` puts the copy back at the **head**, not the tail: its scan was the
one on screen, it is still the physical card in front, and the buyer who
cancelled never received it.

### `reviseListingPictures()` in `apps/app/lib/ebay.js`

`ReviseFixedPriceItem` carrying only `<ItemID>` and `<PictureDetails>`. Same
forty-line shape as `endListing` and `relistListing` directly above it —
build the XML, POST to `TRADING_URL`, parse, accept `Success`/`Warning`, throw
the `LongMessage` otherwise. `PictureDetails` is a **full replacement**, so
"re-seat the next scan" is "send the list again without the sold copy's URL".

---

## Phases, in dependency order

Phases 1–3 are provable with **no eBay traffic at all**, which is the point of
the ordering: the risky half is the last half.

| # | What | Files | Provable by |
|---|---|---|---|
| 1 | `reviseListingPictures()` | `lib/ebay.js` | shape review against the sibling calls; one manual call on a junk listing |
| 2 | Migration 026 | `supabase/migrations/026_listing_copies.sql` | applied by hand, read optionally |
| 3 | The queue module | `lib/listingqueue.js`, `scripts/check-listingqueue.mjs` | `npm run check` — table tests, no network |
| 4 | Teach the five call sites | see the table below | existing checks, extended |
| 5 | Sale detection | `app/api/ebay/notifications/route.js` + poll fallback | a real sale, or a replayed notification body |
| 6 | The re-seat worker | `app/api/cron/reseat/route.js` | idempotency: run it twice, second is a no-op |
| 7 | The consolidation tool | a panel screen, dry-run first | dry run shows exactly which listings would be ended |

### Phase 5 — the trigger, and why it needs both halves

`FixedPriceTransaction` is the Platform Notification and it names the
multi-quantity case explicitly. But **a missed notification is a wrong picture
that never self-corrects**, so the daily `syncUserSales` poll stays as the
safety net: it already writes `ebay_sales` with `line_item_id`, and the unique
index above makes reconciling from it free of double-consumption. Webhook for
speed, poll for truth.

The endpoint marks the head copy sold and **schedules** the re-seat. It does
not perform it inline. That is phase 6 and the reason is the sharpest risk
here.

### Phase 6 — re-seat on dispatch, never on the sale

eBay shows a listing's *current* picture on the buyer's order record, not the
picture at the moment of purchase. Swap the scan when the sale lands and the
buyer who bought thirty seconds ago is looking at a different card than the
one they clicked — an item-not-as-described dispute with our own listing as
the evidence against us.

Waiting until dispatch costs nothing and removes the whole class of problem.
It also handles the cancelled-order case for free: the copy goes back to the
head of the queue before anything was ever sent to eBay.

The worker recomputes `pictureList()` from `listing_copies` and calls
`reviseListingPictures` only when it differs from `listing_groups.pictures_sent`.
So a replayed notification, a double cron fire, or a retry after a timeout are
all free. It rides on the existing daily cron in `vercel.json`, or gets its own
more frequent schedule if a day proves too slow in practice.

**A failed re-seat must say so.** Everything else in this app that touches eBay
is fire-and-forget; this one isn't, because the failure is a listing showing a
card we have already posted to somebody else. `listing_groups.last_error` is
there for that, and Inventory should show it — the same reasoning as the batch
save that reports its own failure.

---

## Phase 4 — the five places that assume one SKU is one card

This is most of the work and none of it is eBay's fault.

| Where | Assumes | Becomes |
|---|---|---|
| `lib/stockcheck.js` | `bySku` → the listing for that card | a SKU may resolve to a *copy* of a consolidated listing; `isListingAvailable` already reads quantity rather than presence, so it is the closest to correct already |
| `lib/stackpos.js` | `stack_cards.sku` is one card at one position | unchanged in rule, but a pulled copy must close the numbering up when its *copy row* is consumed, not when a listing ends |
| `lib/showstock.js` | `checkRow()` reads "what we ask on eBay" per card | the group's price is the copy's price; fine, but the lookup goes through the copy row |
| `lib/showfilter.js` | rows are physical cards, searched by SKU | unchanged — copies keep their own SKUs, which is exactly why they should |
| Stacks → Reconcile | quantity 0 means the card has gone | quantity *n* means *n* cards should be in the stack; a mismatch between listing quantity and unsold copy count is the alarm |

**Two collisions the research report did not name**, both found by reading the
code rather than the eBay docs:

- **`/api/ebay/hide` zeroes the whole listing.** Checking one copy out to a
  show currently sets `Quantity` to 0 — which, on a consolidated listing,
  takes all ten copies off sale because one went in a box. Under multi-quantity
  the hide is a **decrement to `quantityFor(remaining)`** plus pulling that
  copy's scan out of the queue, and the check-in is the reverse. This route and
  `lib/checkout.js` are unavoidably in scope; there is no version of this
  feature that leaves the Show Desk alone.
- **Portfolio valuation is already right.** `Inventory.js` and `Dashboard.js`
  both value at `price_value * (quantity || 1)`, so a quantity-ten listing
  values correctly the day it appears. Worth knowing, since the instinct is to
  go and fix it.

---

## What can go wrong, and what stops it

| Risk | What stops it |
|---|---|
| Buyer sees a different card on their order | Re-seat on dispatch, not on sale (phase 6) |
| A missed notification leaves a stale scan forever | The daily poll reconciles from `ebay_sales` |
| A replay consumes two copies | `unique (user_id, order_line_item_id)` |
| Two screens disagree about how many are left | One derivation, `quantityFor()`, greped by the check |
| Consolidation destroys sales history | Phase 7 keeps the listing with the **most history / oldest item id**, never an arbitrary one, and dry-runs first |
| A consolidated listing is a false claim of interchangeability | The phase 0 scope rules — value ceiling, condition band, no slabs |
| `syncUserListings` wipes our state | State lives in `listing_groups`, not `ebay_listings` |

**The kill switch.** Every consolidated listing can be un-consolidated by
setting its quantity to 1 and ending nothing — the other copies simply go back
to being unlisted stock. That is the retreat if the buyer experience turns out
worse than the ranking gain, and it costs no history. Worth building the
one-listing-at-a-time version of it before phase 7, not after.

There is no sandbox in this codebase — `TRADING_URL` is the production host
with no switch — so phases 5–7 get proven on **a handful of genuinely low-value
cards**, not in a test harness. Building sandbox support first is a bigger job
than the feature.

## Call budget

Trading API is 5,000 calls/day by default. One revise per dispatch, plus the
existing sync, is not close to it. The constraint that actually bites is the
**Vercel deployment cap** — both projects build from this repo and 30 merges in
a day has already exhausted a day's allowance once. Let these phases accumulate
on the branch and merge in batches.

## Rough effort

- Phases 1–3 (call, migration, queue module + check): **one session.** No
  network, fully testable, and it is the part that decides whether the model is
  right.
- Phase 4 (the five call sites, including `/api/ebay/hide`): **one to two
  sessions**, and the one most likely to surprise.
- Phases 5–6 (notifications, worker): **one session**, plus real elapsed time
  waiting on actual sales to prove it.
- Phase 7 (consolidation tool): **one session**, and it should not be started
  until 5 and 6 have run clean on real sales.

## What is NOT in this plan

- **Migrating to the Sell Inventory API.** Better-shaped for this problem —
  quantity and images live on the item — and still not worth it. The app is
  Trading API throughout, and migrating existing listings into inventory items
  is a much larger job than adding one Revise call. Noted in the research, and
  the answer stays no.
- **`UploadSiteHostedPictures`.** Decommissioned 30 September 2026. We
  self-host in the public `listing-photos` bucket (migration 012), which is what
  eBay wants, so this is a thing not to start rather than a thing to fix. Do
  not mix self-hosted and EPS-hosted URLs in one listing.
- **Anything in `packages/core`.** A price for a consolidated listing is the
  same price as for a single one. Last Comp never learns this feature exists.
