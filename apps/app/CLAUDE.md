# apps/app — the app, a.k.a. Pro

The business tool: eBay OAuth, inventory, batch runs, scanning, the Show Desk.
Vercel project `comp-finder`. **Read the root `CLAUDE.md` first**, and read
`packages/core/CLAUDE.md` before changing anything about how a price is
worked out — this directory decides what happens to a price, not what it is.

`npm run dev` / `npm run build`, from the repo root.

## A batch run is saved, and a saved run is frozen

A run of the app's Batch screen costs one SoldComps request per card and
several minutes. It used to live only in React state, and **a slug change
remounts the panel** — so opening a deep dive from a result (`/panel/search`)
threw the whole run away. Fifty-nine cards, priced, gone on one click, with no
way back except paying for all fifty-nine again.

`price_checks` was never the answer to that. It keeps one flat row per priced
card — title, query, price, confidence, two counts — deliberately without the
comps, because the History page is a plain SELECT. It says what we priced a
card at. It cannot say why.

Migration 023 adds `price_batches` + `price_batch_items`: the run, with the
**full recommendation including `included[]` and `excluded[]`**, the filters it
ran under, and the CardUploader CSV verbatim so the eBay upload export still
works days later. Both tables are named in exactly one file,
`apps/app/lib/batch-store.js`, and `check-batchsave.mjs` greps to keep it that
way.

- **Re-opening a run spends nothing upstream.** The comps are the ones it was
  priced from, not a fresh lookup — that is what makes it a record of a price
  decision rather than a live quote, and it is why re-opening is free.
- **A saved run is re-opened by URL** — `/panel/batch/<id>`. In the URL rather
  than in state precisely because state is the thing that gets lost: a run
  identified by its URL survives the next deep dive and comes back on the Back
  button.
- **There are two copies and one serialiser.** Supabase is the saved run;
  `sessionStorage` under `cf-batch-live` covers the gap between finishing a run
  and it being saved, and the case where migration 023 hasn't been applied.
  Both go through `batchRows()`/`restoreResults()`, because two serialisers
  would disagree eventually and the disagreement is invisible — a run that
  re-opens with its prices but not the comps behind them still looks fine.
- **A comp is stored cut down to what the results screen renders** (price,
  postage, sold date, listing link, location, exclusion reason). A run is
  around a megabyte of comps as it is.
- **Retention is 30 days**, set by `RETENTION_DAYS` in `batch-store.js` and by
  the column default in migration 023 — the check asserts they agree. The rows
  are fat and their value decays fast: a run is a working document you list off
  over a few days, not an archive. Expired runs are swept when the saved-runs
  list loads, rather than by a cron that can quietly stop working.
- **A save that fails says so, and can be retried.** Everything else on this
  screen is fire-and-forget; this isn't, because the promise is that the run
  can be got back and the failure would otherwise only surface at the moment it
  was needed. **Save this run** saves whatever is on screen on demand — which
  is what makes a failed automatic save recoverable rather than terminal, and
  covers the run that was navigated away from before it finished.
- **One bad comp must not cost the run.** The first version deleted the whole
  batch if any chunk of rows failed to insert, so a single unstorable character
  in one of several thousand scraped titles took an 89-card run with it. Rows
  go in small chunks, a failed chunk is retried row by row, and a row that
  still won't store keeps its price without its comps and says so. Titles are
  cleaned of what Postgres rejects (`storableText`): a NUL byte is refused
  outright in text and jsonb, and a lone surrogate — half a character pair,
  left where a title was cut mid-emoji — isn't valid UTF-8 on the wire.
- **An empty saved-runs list says it is empty.** It used to hide itself, so
  "nothing saved yet" and "the save failed" looked identical: an empty screen.

Migration 023 has to be applied in Supabase. Until it is, the panel says so on
the run it couldn't save, and the sessionStorage copy still carries the run
across the panel — but not across a reload.

## A price you set beats a price we worked out

The engine answers from comps. Sometimes you know something it cannot — the
card is signed, every comp is the reverse holo, a customer has already agreed a
number, or SoldComps came back with nothing and the card still has to go in a
box with a price on it. **Every price in the app is now editable**: on the
Batch rows (table and cards alike), on a Quick Search deep dive, and on the
Show Desk, where the sticker itself can be typed.

`apps/app/lib/price-override.js` owns what the number means, and three rules
hold it together:

- **The recommendation is never edited.** `finalPence` stays exactly what the
  engine produced and `overridePence` sits beside it. That is what makes an
  override one click to undo, and it is what keeps a corpus honest —
  `recurse-batch.mjs` re-prices a downloaded run and compares against
  `finalPence`, so a hand-typed number overwriting it would poison the only
  measurement we have of whether a rule change helped.
- **Everything that spends money reads `effectivePence()`, never
  `finalPence`.** The eBay upload CSV, the bulk lister, the sticker ladder, the
  saved run and the price history all go through it. A caller that reads
  `finalPence` is not a cosmetic bug — the screen shows your £40, the file
  uploaded to eBay carries the app's £12.49, and nothing anywhere says they
  disagree. `check-override.mjs` greps the money-out paths for exactly that.
  The two places that legitimately keep the engine's figure are the ones making
  a statement about the MARKET rather than about a price: "sellers asking above
  recent sold", and the "under" badge on a cheap live listing.
- **An override is loud.** Every screen marks it and says what it replaced,
  every export carries both numbers, and the note (one sentence, one
  definition) travels with it. A price nobody can tell was typed by hand is
  indistinguishable from one the tool stands behind, and knowing which is which
  is the whole proposition.

Three more things worth knowing:

- **A card the app could not price still takes one.** That is the strongest
  case for typing a number, so `withOverride(null, pence)` builds a minimal rec
  around it, marked `dataSource: "override"` and carrying no comps — because
  there were none.
- **An overridden row leaves the review queue.** The queue asks "do you agree
  with this?", and a row carrying your own number has answered.
- **A price you set is never held back from a sticker**, which is what the hold
  is asking for rather than an exception to it. It still goes through the cash
  ladder: what you type on the Batch screen is an eBay price. What you type on
  the Show Desk is the label itself, so that one is NOT rounded — rounding a
  number somebody typed onto a sticker is the app arguing with the person
  holding the pen.

**Three copies of a run all have to hear about it**, because the one you list
from is whichever you reach for next: React state, the `cf-batch-live`
sessionStorage copy, and the saved run in Supabase. The saved run is patched
row by row (`updateItemRec`) rather than re-saved — saving creates a NEW run,
and an afternoon of corrections would leave a saved-runs list of near-identical
megabyte copies with no way to tell which one you were listing from.

**Price history gets a NEW row, not a correction**, and that is forced as well
as right: `price_checks` grants select, insert and delete and no UPDATE policy
(`supabase/schema.sql`), so an update would quietly change nothing — the worst
possible outcome for a record. It is also the truer account, since
`buildHistoryIndex()` reads the most recent row per card and "last priced"
should become your number the moment you set it. No migration: the engine's
figure rides in the existing `note` column, which the History screen already
shows.

## A show sticker is not a listing price

The Show Desk checks stock out to a show (migration 016), and those open
`stock_checkouts` rows are the show stock list — so the pool needs no table of
its own. **"🏷 Price this pool" on the Show Desk goes to
`/panel/batch?pool=show`**, which prices everything that is away and hands the
prices back as sticker prices. In the URL, not in state, for the same reason a
saved run is: state is the thing a remount throws away.

`apps/app/lib/showstock.js` owns both rules, and `packages/core` is untouched —
a price for a table at a show has no business changing what Last Comp tells a
stranger their card is worth.

**Graded stickers are the exception, and the reasoning is in
`packages/core/CLAUDE.md` under "A slab is not the card underneath it"** — a
slab starts from what we already ask for it on eBay rather than from the cash
ladder. That rule is written down beside the engine because the engine is what
had to learn the card being priced could itself be a slab; what it does to a
sticker is decided here.

- **The ladder is cash, not charm.** `finalPence` sits on a 50p ladder off a
  £2.49 floor because that is what an eBay listing wants; nobody hands 50p
  pieces across a table. Stickers round to £1 to £20, £5 to £100, £10 above,
  ties up. £2.49 and £2.99 landing on neighbouring rungs is intended. The
  resolution loss at the bottom is real: below about £2 everything collapses to
  £1, which is right for a show table and wrong for bulk — that wants a "3 for
  £5" tub, not a label each.
- **What we already ask on eBay is on screen, one click from being the
  sticker.** Read through `checkRow()`, the same lookup the results table uses,
  so there is no second SKU match to drift. A listed price adopted this way
  rounds to the POUND (`toPoundPence`), never down the cash ladder: the ladder
  is for figures we derived, and £22.49 becoming £20 because the rungs step in
  fives would give away £2.49 nobody agreed to. "not listed" means we don't
  know — checking a card out by ENDING its listing rather than zeroing the
  quantity drops the row from `ebay_listings` on the next sync.
- **A sold card is still a row in `ebay_listings`, so "★ Recommend show stock"
  has to check the quantity.** eBay's out-of-stock control leaves a sold
  fixed-price listing in the ActiveList with the quantity zeroed — same item
  id, same price, still "active" to the API. Ranking live stack cards by
  listing price therefore put cards that had already sold at the TOP of the
  shortlist, since the expensive ones are the ones that sell. `stockcheck.js`
  owns the one definition (`isListingAvailable`), a missing quantity is
  UNKNOWN rather than zero, and the count left out is on screen with what to
  do about it. Stacks → **Reconcile** had the same blind spot for the same
  reason and now calls those rows "out of stock" — which, for anything that
  sold more than 90 days ago, is the only evidence there is, since
  `ebay_sales` doesn't reach back that far.
- **Any sticker can be set by hand, and a hand-set price beats a hold.** The
  gate below is a default, not a verdict — someone holding the card knows more
  than the comps do. Typing a price on a held row is what makes it printable,
  which matters because the alternative is carrying that card to the table with
  no sticker on it. Whole pounds only: `labelPrice()` rounds to the pound, so
  accepting £7.50 would quietly print £8. Overrides are keyed by position in
  the run, flow to both the label file and the write-back, and a saved run
  re-opened at the show rehydrates the prices it wrote — a reprint has to say
  what the first print said.
- **A thin price is HELD, not printed.** Low or no confidence, or a price built
  from active listings, gets no sticker. Everywhere else a bad price is
  absorbed or editable; this one is stuck to a card and carried to a table,
  where the only correction is peeling it off in front of a customer. Nothing
  is held quietly — the count and the reason are both on screen.
- **A sticker can also be typed at the desk.** ✎ £ on a Show Desk row sets or
  clears `sticker_pence` directly — for the card added to the box after the
  run, or a price you have changed your mind about with the table in front of
  you. Neither is worth re-pricing 43 cards for. Same rule as the box in the
  sticker panel, deliberately: whole pounds, refused rather than rounded, and
  not put through the ladder, because a sticker typed anywhere is the label
  rather than an eBay price. A price overridden on a RESULT is the other thing
  and is laddered like any other — see the override section above.
- **Stickers are written back on a click, not silently**, onto the checkout
  they came from, matched by SKU rather than row order — the results list gets
  filtered and re-sorted, and a sticker on the wrong card is a card sold for
  the wrong money. Held rows are skipped rather than written null, so a card
  keeps a good sticker from an earlier run. `£ Sold` then pre-fills from it.
- **Migration 024** adds `sticker_pence` to `stock_checkouts` and `pool_name`
  to `price_batches`. `pool_name` is read and written OPTIONALLY: migrations
  here are applied by hand, so the code always ships first, and Postgres
  rejects a whole statement that names a missing column — a required one would
  take out the saved-runs list and every save with it, show-related or not.

## A SKU is a name; a position is an address

`apps/app/lib/stackpos.js` owns the one rule for where a card physically is.
`stack_cards.position` is a stable SORT KEY, not the number you count to — the
displayed position is the **live rank** among cards actually present, and both
pulled and checked-out cards close the numbering up behind them.

The confusion is built in and worth understanding rather than papering over.
Stacks were seeded from eBay SKUs where `A50` meant "Stack A, position 50", so
on a fresh stack the SKU and the position agree **exactly** — which makes it
very natural to read the SKU as the position. They part company permanently the
first time anything is pulled, because a SKU is a name and never moves.

The rule had been written out three times — the finder and the stack list in
`Stacks.js`, the pick order in `PullSheet.js` — before the Show Desk needed a
fourth. That is why it now lives in one file with a grep behind it: two screens
each showing a confident number that differ by one is invisible on screen and
sends you to the wrong card.

## The label file, and why it is a real .xlsx

`apps/app/lib/labelexport.js` writes what the Nimbot app imports: **two
columns, `Price` then `Name`**, one row per card, and it generates a label per
row. The format is the printer's, not ours — `check-labels.mjs` pins the names
and the ORDER as literals, because getting them the wrong way round doesn't
fail loudly, it prints a hundred labels with the price where the name goes.

**A workbook, not a CSV, so Excel never opens the file.** That is also what
keeps a card number like `4/99` from being silently rewritten to `Apr-99` on
the way through — see `repairExcelDateMangling` in `lib/carduploader.js`. There
is no dependency: a workbook is a ZIP of five small XML parts, stored
uncompressed needs no deflate, and SheetJS is deprecated on npm while exceljs
is a megabyte in a client bundle. Entries are stored and timestamps pinned to
1980, so the same rows always produce the same bytes and the check can read the
sheet XML straight out of them.

**Prices are text cells, and always whole pounds.** The cash ladder only lands
on multiples of 100, so "£3" rather than "£3.00" — three characters saved on a
small label, and it reads as cash rather than a listing price. A numeric cell
would need a currency format and would print a bare "3".

**A long name loses its NAME before it loses its NUMBER.** `labelName()` drops
bracketed asides, cuts everything after the collector number (a TCG title puts
the set, rarity and condition after it), then strips noise words — and only
truncates as a last resort. When it must truncate a title that has a number, it
keeps the number and cuts the name: `Iron Hands… 070/162`, not `Iron Hands ex…`.
The customer is looking at the card itself, so the text on the sticker is mostly
there for us, and the number is what matches a stray label back to a card.

The width is a **preference about stationery**, remembered in `localStorage` —
Short 20, Medium 30, Long 44 characters — and the sticker panel lists the cut
text with a count of how many were shortened, so a wrong choice is visible
before a hundred labels come off the roll.
