# Platform review: four people looking at the app

26 Nov 2026 · the business app (`apps/app`). Last Comp and `packages/core` are
out of scope and untouched.

The question was what is redundant, what should be made uniform, and what it
takes for the lab to become the hub. A review from the code alone tends to
list everything at the same volume, so this one is read four times, as four
different people, and the changes that came with it are the ones that more
than one of them would hit first.

## The short version

The app is two apps sharing a menu. The older screens (Batch, Imports, My
listings, Quick Search, the bulk listing pop-up) and the lab price, store,
filter, list and draw cards in separate ways, and most of the real bugs are
in the gaps between them. That is good news for the lab-as-hub plan: nobody
needs new features first. The work is moving the lab onto the rules the rest
of the app already enforces, then retiring the duplicates.

## 1. The daily user

*Prices batches, lists, picks and packs, every day. Knows every screen,
trusts the numbers, and stops reading anything that looks routine.*

What costs them, in order:

- **A reverse holo and a plain copy became ONE lab listing.** The lab grouped
  copies by name, number, set, condition and language only, and read the
  printing only from CardUploader's Finish column, which is blank on most
  reverse holos. A buyer is shown one printing and sent the other. This is
  the most expensive thing in the review. **Fixed.**
- **Lab price changes left no trace.** Inventory's bulk price went straight
  to eBay: no second confirm on a drastic change and no row in the change log,
  so the eBay activity screen could neither show nor revert it. My listings
  had both. **Fixed:** one rule, `lib/price-change.js`.
- **Two ways to do the same job, priced differently.** Quick Search prices
  with the engine; the lab and Bulk pricing (on house rules) price with the
  house rules and your card rules. The same card can read two figures on two
  screens. *Not changed here; see "Next".*
- **Counts that are quietly wrong.** The portfolio snapshot, Dashboard, Bulk
  pricing's stock check and My listings paged `ebay_listings` without a total
  order, so on a few thousand listings some were read twice and others never.
  Dashboard also read costs in one select, which stops at 1,000 rows.
  **Fixed.**
- **Arbitrage still read "60 HP" as Heavily Played**, a fifth hand-written
  condition reader. **Fixed:** it delegates to core, and a check fails on a
  sixth.

## 2. The occasional user

*Does a stack every week or two. Doesn't remember where things are and reads
every label literally.*

- **Nothing on a screen said where you were.** The shell shows no title. The
  lab had tabs; Pricing (four screens), eBay (seven) and Cardmarket (two) had
  nothing, so every move was a trip to the side menu. **Fixed:** every module
  with more than one screen carries the same tab strip (`SectionTabs.js`,
  the lab's own header generalised) and a line saying what the screen is for.
- **"Batch" meant two things.** Pricing → Batch was a priced run (saved as
  "runs"); Lab → Batches is a CardUploader upload. **Fixed:** the first is
  now **Bulk pricing**, described as "not a lab batch".
- **Tabs and titles disagreed.** The lab's Overview tab opened a page titled
  "Lab". **Fixed** ("Lab overview"). The Batches tab's empty state still says
  "Add copies"; it only shows on a database without migration 047.
- **The lab was the seventh module.** **Fixed:** second, after the Dashboard.
- **Still to do:** 57 native `confirm()` and 6 `prompt()` dialogs; status
  messages drawn six ways in four colours; three tables and about seven list
  styles; about twenty money formatters, some showing a missing price as "—"
  and some as "£0.00". See "Uniform".

## 3. A customer of the system

*Pays for it, runs their own shop on it. Assumes their data is theirs and the
app behaves the same everywhere.*

- **Three nightly jobs ran for anyone when `CRON_SECRET` was unset**, across
  every account: the listings sync, the price pull and the lab sale sweep.
  The pricing queue refused in the same situation. **Fixed:** one rule
  (`lib/cron-auth.js`), refuse. **Set `CRON_SECRET` on `comp-finder` before
  merging.**
- **The old listing form probably sent an invalid condition.** ListForm and
  BulkListModal put the descriptor value (400010) in `<ConditionID>`, where
  the trading-card category takes 4000 plus descriptor 40001, and offered a
  Damaged grade eBay doesn't have. **Fixed:** one table and one writer
  (`lib/ebay-condition.js`) for every listing path. *Not yet tried against
  live eBay.*
- **"Migration pending" is guessed from error text** in about 35 places, and
  most would show a permissions refusal as a missing migration, telling a
  customer to run SQL they have already run. *Next.*
- **Open endpoints.** `/api/cards/search` (spends the pokemontcg key) and
  `/api/mtg/search` are unauthenticated on purpose, for typeahead speed.
  That's fine for one shop, but not for a product sold to others. *Next:
  rate-limit them, or require a session token.*

## 4. Someone we are pitching to

*Sees it for twenty minutes. Judges it on whether it looks like one product
with one idea.*

- **The idea is strong and is not on screen.** "One listing per card, every
  copy behind it, the buyer gets the copy in the photo" is the pitch, and it
  lived in the seventh menu entry. It is now second, and the lab Overview
  already says it in a sentence.
- **It looks like two products.** The lab's tables, buttons and messages
  (`li-*`, styled from JavaScript) look nothing like the rest
  (`globals.css`), and lab Overview and Settings follow neither. The tab strip
  is the first shared piece; the rest is below.
- **Demo risk.** Nothing here can be demoed without a real eBay account and a
  real SoldComps key. The stream relay's demo lots are the only offline demo
  in the repo. A seeded demo account is worth more in a pitch than any single
  feature.

## What this PR changed

| Change | Who it's for | Files |
|---|---|---|
| A reverse holo is its own lab listing | daily | `lib/lab-copies.js`, check-labdraft |
| Lab price changes guarded and logged | daily, customer | `lib/price-change.js`, `api/lab`, `api/ebay/revise-price`, LabInventory, check-pricechange |
| Nightly jobs refuse without `CRON_SECRET` | customer | `lib/cron-auth.js`, three routes, check-cronauth |
| One eBay condition table and writer | customer | `lib/ebay-condition.js`, `lib/ebay.js`, ListForm, BulkListModal, check-ebaycondition |
| Paged reads in a total order | daily | portfolio, Dashboard, Panel, Inventory, set-index |
| Arbitrage's condition from core | daily | Arbitrage, check-corebrowser |
| Section tabs on every multi-screen module | occasional, pitch | `SectionTabs.js`, LabHeader, Panel, globals.css |
| Lab second in the menu; "Bulk pricing"; "Lab overview" | occasional, pitch | Panel, LabCopies |
| Dead code: the lab Overview's hidden second Add copies, ThemeToggle | — | LabCopies, ThemeToggle |
| Stale statuses in ONE_PLATFORM, LISTING_STUDIO, MULTI_QUANTITY | — | docs |

## Redundant now, or once the lab takes over

**Can go now:** done in this PR (the dead lab intake path, ThemeToggle).

**Can go once `check-migrations.mjs` confirms the database is current:**
- the pre-047 one-slot lab draft;
- in-tab pricing (pre-048);
- the tile fallback (pre-049);
- the old Toploaders stack;
- `moveLabCopies` and the `lab_copies` table (pre-042);
- the `withPool`, `poolNameColumn` and `dropExtra` fallbacks;
- saved runs with 6- and 12-month windows.

**Can go once the lab covers them:**

| Old screen | What the lab still lacks |
|---|---|
| Bulk pricing (Batch) | pasted titles, photo identify, graded and Damaged cards, editing a card's fields, "already listed / last priced" across all listings, writing price history, 👍/👎 on every row |
| Imports | a decision: `card_imports` or `lab_batches` holds an uploaded file (today both do) |
| My listings | non-lab listings, a live market re-check (the lab's figure is frozen at listing), shows, deals and stream (blocked for lab cards by design) |
| BulkListModal, ListForm | nothing; they go with Bulk pricing |
| CardUploader inventory import and pick-list match | until the last CardUploader listing sells; meanwhile one divider can become both `KA` and `LAB-KA` |

**Quick Search stays**, but should price with the house rules and your card
rules so it agrees with the lab.

## Uniform: rules written more than once

**Behaviour that disagrees today:**
- **typed price:** `effectivePence()` vs the lab's `pricePence`. The override and £0.00 checks don't cover the lab.
- **ladders:** three, so the lab's "comps −20%" can go under a game's floor.
- **condition tables:** about seven.
- **CSV parsers:** two, and one doesn't strip a BOM.
- **SKU keys:** compared with and without trimming in the stock and away indexes.
- **the `soldcomps` cache key:** has no page field.

**Same rule copied, no behaviour change:**
- five card-identity keys;
- four search-query builders;
- three comp de-dup keys;
- three exclusion-reason label maps;
- about twenty money formatters and eight price parsers;
- about thirty-five migration-missing detectors in five styles;
- sign-in boilerplate on 29 routes.

## Uniform: the screens

**A shared kit in `app/panel/ui/`, built one piece at a time:**
- tab strip (done);
- page header;
- data table on `.itbl`;
- toolbar (search, chips, select, sort, segmented);
- `useSelection` and one bulk bar, with one meaning of "all";
- modal and sheet;
- confirm dialog;
- notice and toast;
- loading and empty states;
- button;
- card thumbnail with one placeholder;
- `lib/money.js`;
- `lib/api.js`;
- a preferences helper with one key style.

Port the lab onto it first, since it is becoming the hub. Move the classic
screens across as they are touched.

**One vocabulary:** run (a pricing pass) and batch (a lab upload); listing
(on eBay), copy (a physical card) and inventory (where cards are); stack as
the umbrella, with box, divider, binder and pile as kinds of stack.

## Next, in order

1. **Make the lab use the rules the rest of the app already checks.** Typed
   price through `effectivePence()`, £0.00 through `exportGuard()`, the house
   ladder, one condition table and one CSV parser. That way the existing
   checks cover the lab.
2. **One migration-missing helper** (`lib/db-missing.js`: missing relation and
   missing column by error code, plus remember-and-retry), replacing the
   thirty-five.
3. **Quick Search on the house rules.**
4. **The UI kit, lab first.**
5. **Close the lab's gaps in the table above**, then retire Bulk pricing,
   Imports, BulkListModal and ListForm.
6. **Trim CLAUDE.md.** It is 3,900 lines; move the feature essays to `docs/`
   and keep the rules.

## Decisions for you

- **Which store holds an uploaded file:** `card_imports` or `lab_batches`.
- **Graded and Damaged cards:** do they belong in the lab, or stay on another
  path? eBay has no ungraded grade below Heavily played.
- **A seeded demo account for pitching:** worth building?

## Addendum, same day: removed

Decided after the review: **Bulk pricing, Imports and Arbitrage are removed**,
with the lab left untouched. That retires the first rows of "Can go once the
lab covers them" outright, rather than waiting for the lab to cover them, and
takes the Show Desk's "Price this pool" / "Price these" with it (stickers are
set with ✎ £ or eBay price → sticker). The Imports decision above is settled
by it: an uploaded file lives in `lab_batches`. CLAUDE.md's "Bulk pricing,
Imports and Arbitrage were removed" lists what went and what stayed.
