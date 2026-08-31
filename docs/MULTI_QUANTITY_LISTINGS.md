# One listing, several copies — and how to test it

The method: one eBay listing at quantity 3 backed by three physical copies of
the same card, each with its **own scan**, its **own stack position** and its
own internal SKU. A copy sells; the listing's picture becomes the next copy's
scan; the app tells you which stack to walk to and how far to count.

**Status: the logic is built and tested, the writes are built and untested
against live eBay, there is no screen for it yet.** What that gets you is a
process you can run by hand, end to end, on one listing — which is the only
thing worth having before the method has proved it is worth having.

---

## The one fact the whole design hangs on

**eBay reports the LISTING's SKU on a sale, never the copy's.** A multi-quantity
listing has one item id and one Custom Label. A sale says *this listing sold
two* and carries nothing that distinguishes copy 1 from copy 2.

So the ordering is **ours**. `apps/app/lib/copyqueue.js` defines it once:
`copy_seq`, then when the copy was added, then the row id — the last of those
so that two reads of the same data can never disagree about which copy is at
the head, because the head is the card in the photograph.

That has a consequence to decide on deliberately rather than discover: **the
buyer bought the card in the photo.** Photographing each copy separately is an
admission that the copies differ. Two honest positions — pool only copies that
are genuinely interchangeable and treat the rotating scan as courtesy, or say
in the listing that the photo is of a representative copy. Rotating a per-copy
scan while implying the photo is *the* card is the version that generates
returns.

---

## It is a reconciliation, not a ledger

The first design here consumed sale line items against the queue and kept an
event log, so a replayed sync could not double-consume. **Reading
`PullSheet.js` killed that**, and the replacement is much smaller.

The pull sheet already matches unshipped orders to stack cards, you tick what
you picked, and Commit marks them pulled. **The card leaving the box is the
consumption** — already recorded, and recorded by the person holding it. So
nothing in `copyqueue.js` consumes anything. The desired state of a listing is
a pure function of which copies are still in the box:

```
quantity = how many copies are sellable right now
picture  = the head copy's scan
```

Compare with what eBay shows, revise the difference. Running it twice does
nothing the second time. A missed run costs staleness and nothing else. There
is no log to fall out of step with reality — an event ledger would have been a
second opinion about stock, and the disagreement would have been silent.

**One thing still cannot be derived.** eBay *rehosts* every picture you upload,
so a listing's image URL comes back as `i.ebayimg.com/…` and never as the
storage URL you sent — there is no comparison to make. `listing_copy_state`
(one row per listing) records which copy the listing was last revised to show,
and records nothing else. Delete the whole table and the worst that happens is
one redundant revision per listing.

---

## What got built

| | Where |
|---|---|
| The queue, the desired state, the reconcile, the pull plan | `apps/app/lib/copyqueue.js` |
| 24 table cases over all of it | `scripts/check-copyqueue.mjs`, in `npm run check` |
| The picture + quantity revision | `reviseFixedPriceListing()` in `apps/app/lib/ebay.js` |
| `copy_seq`, `scan_url`, `listing_copy_state` | `supabase/migrations/027_listing_copies.sql` |
| The pull sheet, now correct for multi-copy listings | `apps/app/app/panel/PullSheet.js` |
| Dry-run and one-listing apply | `scripts/copyqueue-run.mjs` |

### Two bugs this found in code that already shipped

Both were invisible while every listing was a single card, and both are a card
short or a card wrong the first time one isn't:

- **A line item carries a quantity, and the pull sheet ignored it.**
  `fetchPendingOrders` has always returned `quantity`; the sheet made one pick
  row per line item. One order for two copies pulled one card, and the sheet
  looked complete. Each unit is now its own row, its own tick and its own card
  — `commit()` keys on card id, so they commit as the two cards they are.
- **Which of several same-SKU copies got pulled was arbitrary.**
  `unpulledBySku` was first-wins over an unordered `select *`. Arbitrary is the
  thing this whole design removes: the copy that goes must be the copy in the
  photograph. It is a queue now, in `copyqueue.js`'s order.

There is also a subtler one the check caught during the build: the "where to
walk" label was per SKU, because `locationsBySku` keeps one label per SKU —
right everywhere else, since a SKU has always named one card, and here it sent
you to the same card twice for a quantity-2 order. It is per copy now, using
the same `stackpos.js` rule.

---

## Running the process by hand

**1. Apply migration 027** in the Supabase SQL editor. Until you do, everything
below still runs: the queue orders itself by when each copy was added, quantity
reconciliation works, and no picture change is ever proposed.

**2. Get three copies of one card behind one listing.** Three `stack_cards`
rows sharing an `ebay_item_id` and the listing's SKU. Nothing new is needed —
that was always allowed.

**3. Give each copy a scan.** Upload to the `listing-photos` bucket and put the
public URL on the row's `scan_url`. **One URL per copy, never overwritten in
place** — eBay caches pictures by URL, so re-uploading different bytes to a
path it has already fetched changes nothing visible, and looks exactly like the
revise call failing.

**4. Set `copy_seq`** 1, 2, 3 if you care which goes first. Skip it and they go
in the order they were scanned.

**5. Look at what it would do.**

```
NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
  node scripts/copyqueue-run.mjs
```

Dry. Prints every listing holding more than one copy, the queue in order, which
copy is pictured and next to pull, and what it would change.

**6. Send one.**

```
… EBAY_CLIENT_ID=… EBAY_CLIENT_SECRET=… \
  node scripts/copyqueue-run.mjs --item 1234567890 --apply
```

`--apply` requires `--item`, and a whole-inventory apply is not offered. The
first live test is one listing you chose.

**7. Then look at the listing page**, because none of the next part is visible
from the API:

- does the **main picture** actually change, and how long does the **gallery
  thumbnail in search results** take to follow (it lags — this is the one most
  likely to surprise you);
- does the revision cost anything you care about — watchers, Promoted Listings
  placement, position in search;
- what the listing looks like to a buyer mid-rotation, especially if the
  description references the photo.

**8. Sell one, pull it on the pull sheet, and run the script again.** That is
the whole loop. The pull sheet should offer you copy 1 at its live stack
position; after Commit, the script should propose quantity 2 and copy 2's scan.

---

## What is still untested, and by what

- **`ReviseFixedPriceItem` changing pictures on a listing that already has
  sales.** Revising a listing with sales is restricted for some fields;
  pictures are generally allowed, and "generally" is not something to build on.
  Step 6 above answers it for real. eBay Sandbox would answer it earlier, but
  `apps/app/lib/ebay.js` hardcodes production hosts in six places, so sandbox
  needs a host switch, a separate keyset and sandbox seller *and* buyer
  accounts — a day's work to answer one question that one live listing answers
  for the price of a cheap card.
- **eBay's revision allowance.** Not documented usefully and not observable
  from sandbox. One rotation per sale is a low rate; it is worth watching the
  first time a listing turns over quickly.
- **Quantity 0 and the out-of-stock control.** `reviseItemQuantity` documents
  that it needs the seller setting enabled. The reconcile drives an empty queue
  to 0 and touches no pictures; whether eBay holds the item id depends on that
  setting.

---

## The test that decides whether the method is worth having at all

Everything above tests whether it *works*. None of it tests whether it is
**better**, and it might not be:

- **One listing at quantity 3 gets one listing's worth of exposure**, not
  three. Three separate listings occupy three slots in a buyer's search
  results. For a card with steady demand that is fine; for a slow mover, three
  shots at being seen is the whole game.
- Promoted Listings, Best Offer and watchers all apply **per listing**.
- Against that: one listing accumulates all the history and watchers, needs one
  price revision instead of three, and one photo rotation instead of three
  relists. And the admin saving is real — three copies is one listing to
  manage, not three.

That is an empirical question, and this repo already has a discipline for those
— *measure before adding a pricing rule*. Take ~20 cards held in triplicate,
list half as **3 × quantity 1** and half as **1 × quantity 3**, leave them 30
days, compare days-to-first-sale, total sold and final price. Twenty cards is
enough to see a large effect and not enough to see a small one, which is the
right resolution for a decision this size.

The build above is what makes that experiment cheap to run rather than the
thing that assumes its answer.

---

## If it earns a screen

Nothing here has a UI, on purpose — a screen for a method that has not proved
itself is the expensive half. When it does earn one, the pieces are already
shaped for it: `copyqueue.js` is framework-free and takes a Supabase client the
way `wants-store.js` does, `reconcile()` returns reasons written to be read by
a person, and the reconcile being idempotent means a button can be pressed
twice without anyone having to think about it.

The two things a screen would add that the script cannot: uploading a scan
against a copy (today that is a bucket upload and a column edit by hand), and
setting `copy_seq` by dragging. Both are pure convenience — neither changes any
rule above.
