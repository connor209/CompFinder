# The quantity-listing lab: a side build, and the test it runs

This is gate 1 of `docs/ONE_PLATFORM.md`. It tests one thing before anything
else is built on it:

> **One listing per card and condition at quantity N, showing the scans of the
> copy that goes next. A sale reserves that copy and the listing moves on to
> the next copy's scans, so every buyer gets the copy they were shown.**

It is a **side build**. It has its own screen (`/panel/lab`, linked from no
menu), its own three tables (migration 039) and its own files. It does not
change a single existing file, screen or table.

## What it touches, and what it doesn't

| | |
|---|---|
| **New files only** | `apps/app/lib/lab-copies.js` (the rules), `lib/lab-store.js` (the only file naming the tables), `lib/lab-ebay.js` (creating a listing with its card condition), `app/api/lab/route.js`, `app/panel/lab/`, `supabase/migrations/039_lab_copies.sql`, `scripts/check-labcopies.mjs` |
| **Reused, unchanged** | The eBay calls in `ebay.js` (revise photos, read orders, read quantity, set quantity, end), copyqueue's `reconcile()`, and the CardUploader CSV reader |
| **Never read or written** | `stack_cards`, `stock_checkouts`, `listing_copy_state`, `ebay_listings`. `check-labcopies.mjs` fails if that changes, or if anything outside the lab imports it |

**What the rest of the app will still see: the eBay listing itself.** It is a
real listing on your account, so:

- **The nightly sync stores it like any other listing.** It shows in My
  listings, and as stock at home on the counter, the binder and the shop
  storefront. Don't ＋ Show, ＋ Stream or ＋ Deal it.
- **It has no Custom Label (SKU)**, so the nightly stack import skips it and it
  never becomes a stack card.
- **Its orders reach the pull sheet as loose picks** (no SKU, no stack card).
  Pack and ship them as normal. **Pick the card from the lab's Pick list**,
  which names the exact copy.
- **The sales reach Accounts** through the normal sales sync. They are real
  sales.

## Setting up

1. **Run the migration.** Paste `supabase/migrations/039_lab_copies.sql` into
   the Supabase SQL editor and press Run. It only adds the lab's tables.
2. **Deploy.** Merge this branch to `main` (only the app rebuilds; the public
   page skips it, since nothing under `apps/public` or `packages/core`
   changed). Or test on a Preview with **Redeploy** in the Vercel dashboard.
3. **Make the LAB pile.** Pick 3–4 cheap cards you hold 2–3 copies of, in the
   same condition: say 9 cards in all. Put them in one pile with a slip on top
   saying **LAB**.
4. **Scan and recognise them in CardUploader** with the divider set to `LAB`,
   so the SKUs are LAB1, LAB2… in pile order. Check the matches and
   conditions, then **export. Don't list them in CardUploader.** If CardUploader
   lists them too, every card is on sale twice.

## Running the test

1. Open **/panel/lab**, choose the CardUploader export under **Add copies**,
   and check the grouping: copies of one card in one condition are one row.
   Anything refused says why.
2. Type a price, press **Preview** and check it reads as a buyer will see it.
   Then **List on eBay (live)**. It asks first.
3. Open the listing on eBay from the lab, **on a phone and on a desktop**.
   Check that the photos are the first copy's and the quantity is right.
4. **When a copy sells** (a friend can buy one, then cancel or return it),
   press **↻ Check for sales**. It reserves the sold copy for that order,
   checks the next copy's scan still loads from CardUploader, then moves the
   listing on to it. Reload eBay and check the new photos are there.
5. **Pick it from the lab's Pick list.** It shows the photo, the SKU and where
   the copy is in the LAB pile. Check the card in your hand is the one the
   buyer saw on their order, then press **Picked**.
6. **Try the awkward cases on purpose:**
   - **Two sales between checks.** Buy two, one after the other, before
     pressing Check. The second is flagged **"buyer saw a different copy"**.
     That count is the real risk of the design, so measure it.
   - **An order for two.** It takes the copy on show and the next one.
   - **A cancelled order.** **Release** puts the copy back in its queue. If
     eBay's count and the queue then disagree, Check offers **Set eBay to N**.
   - **The last copy.** When it sells, nothing is left to show and the
     listing goes to quantity 0.

## eBay sale notifications

Without these, a listing only moves on when somebody presses **Check for
sales**. With them on, eBay tells the lab the moment a lab listing sells, and
the photos move on by themselves, usually within a minute.

- **Turn them on** from the lab's scorecard: **Turn on sale notifications**.
  It points eBay at `/api/lab/ebay-notify` on whatever address the page is
  open on, so use the production address, not a preview.
- **A notification is only a prompt.** The lab never trusts what one says was
  sold. It runs the same check as the button, which reads the sale from eBay's
  order API with our own token. A forged notification can at most make the lab
  look at eBay early.
- **eBay's order API can lag the notification by a few seconds**, so a check
  that can't see the sale yet waits and looks again: straight away, after 6s,
  then after 15s more. If it still can't, the next notification or a press of
  the button picks it up. Each notification leaves a `notified` line in the
  log with how many tries it took.
- **It covers every sale on the account.** eBay notifies for every
  fixed-price sale; anything that isn't a lab listing is acknowledged and
  ignored. The delivery address is set for this app's whole eBay connection.
  Nothing else in the app uses it, and CardUploader lists through its own
  keys. If eBay already has a different address, the lab says so and asks
  before replacing it.
- **The signature check needs `EBAY_DEV_ID`.** eBay signs each notification
  with your Developer ID, which the app has never needed before. Add it in
  Vercel → `comp-finder` → Settings → Environment Variables; it's the **Dev
  ID** on developer.ebay.com → Application Keys (Production). Redeploy after
  adding it. Until then, notifications still work but can't be verified, so a
  repeat for the same listing within 20 seconds is ignored.
- **The button still works**, and pressing it alongside a notification is
  safe: a copy can only be reserved once, and a reservation that loses that
  race tries again.
- **Turn off** on the same line stops the sale notifications for this
  account.

## The gate

Run it for two weeks. It passes when:

- every sale the lab reserved went out as the copy the buyer saw, or was
  flagged before it shipped;
- every photo move appeared on eBay within one check;
- the scorecard shows **0 oversold** and no unexplained errors;
- the "buyer saw a different copy" count is small enough to live with, with
  sale notifications on. That number says whether a minute's gap after a
  sale is good enough.

If it fails, the fallback in `ONE_PLATFORM.md` is the plan. Nothing else has
been touched, so there is nothing to undo but the lab.

## Undoing it

**End every listing** on the lab screen first. Then, in the Supabase SQL
editor:

```sql
drop table public.lab_events, public.lab_copies, public.lab_listings;
```

Then delete the files listed above. Nothing else depends on them.

## Checks

```
node scripts/check-labcopies.mjs
```

28 cases cover:
- grouping an export by card and condition, and what it refuses;
- the queue order;
- what a listing moves on to after a sale;
- sales taken in sale order, with the second of two sales between checks
  flagged;
- a quantity-2 order taking two copies;
- running Check twice doing nothing the second time;
- a cancelled order never taking its copy back;
- overselling being reported, never invented;
- positions in the pile;
- greps that nothing outside the lab uses it, and that it never writes the
  app's own stock tables.

It is not in `npm run check` yet, because the lab adds nothing to the shared
checks until it is confirmed.
