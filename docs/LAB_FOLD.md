# Step 2: folding the lab into the stacks

23 Nov 2026 · plan, nothing built yet

The lab proved quantity listings on real eBay (`docs/LAB_COPIES.md`) and grew
settings, templates and an inventory view (`docs/LISTING_STUDIO.md`). Its
copies still live in their own table, `lab_copies`, which no other screen
reads. So a lab card is invisible to Stacks, its orders are loose picks on the
pull sheet, and it gets picked twice over: once in the lab, once by eye.

This step makes every lab copy **an ordinary stack card**, so Stacks, the pull
sheet and the stack checker see the physical card where it is. **Every lab
card is marked LAB everywhere it appears**, and the screens that move stock
(shows, the stream box, deals) leave lab cards alone until the lab is
confirmed. Tonight's cards are tests, not priced properly, and nothing about
this step treats them as real stock beyond what they already are: live eBay
listings that can sell.

## The rule that matters

**One record per physical card.** After this step a lab copy *is* a
`stack_cards` row, and `lab_copies` is no longer read. Mirroring the copies
into stacks while keeping `lab_copies` as well would be two opinions about
the same card, and this repo's whole history says the disagreement would be
silent.

## What a lab card looks like in `stack_cards`

Migration 042 adds columns to `stack_cards`, all nullable, all ignored by
code that doesn't know them:

| Column | Meaning | From `lab_copies` |
|---|---|---|
| `lab_listing_id` | **This card is a lab card**, and which lab listing it belongs to. The one test every screen uses. | `listing_id` |
| `scan_urls` | The copy's own scans, in order (CardUploader-hosted) | `scan_urls` |
| `reserved_line`, `reserved_order`, `reserved_at`, `reserved_mismatch` | Sold to this order unit, not yet pulled | the same |

Columns that already exist and mean the same thing are reused:
- `copy_seq` (migration 027) is the selling order.
- `pulled_at` means the card has gone.
- `sku`, `stack_id` and `position` say where the card is, through
  `stackpos.js`, the app's one rule for positions.

The lab's own pile numbering from the SKU (`pileOf`) retires. **A lab card's
stack is its pile:** stack `TEST2` for TEST2-1…TEST2-17, made if it doesn't
exist. `ebay_item_id` stays **empty** on lab cards: the old multi-copy script
(`copyqueue-run.mjs`) groups by it, and must never try to manage a lab
listing.

## Moving the existing copies

**▸ Move lab copies into stacks** on the lab page, run once:

1. For each lab copy, in pile order:
   - find or create its stack;
   - refuse a copy whose SKU is already on a stack (it's named, not
     overwritten);
   - insert its `stack_cards` row;
   - note the new row's id on the lab copy.
2. Idempotent: a copy already moved is skipped, so it can be run again after
   a failure.
3. Picked copies move as pulled, so stack history is complete.
4. The lab switches to reading `stack_cards` only once every copy has moved.
   Until then it keeps reading `lab_copies`, so nothing half-moves.

## Screen by screen

| Screen | Today | After |
|---|---|---|
| **Lab, inventory, notifications, sweep** | Read `lab_copies` | Read `stack_cards where lab_listing_id is not null`. Same rules, same tests. |
| **Stacks** | No lab cards | Lab cards in their stack at their live position, with a **LAB** badge, the listing's state (for sale / sold to … / on show) and a link to the lab listing. |
| **Pull sheet** | A lab order is a loose pick with no stack card | The order line finds its **reserved** card by `reserved_line`, then shows as an ordinary pick with the card's position and a **LAB** badge. **Commit pulls it**, replacing the lab's own Picked button. A lab order that isn't reserved yet (notification missed) says so and offers **Check for sales** rather than guessing a copy. `pullmatch.js` (front-most copy) never chooses a lab card. |
| **Reconcile** (Stacks) | — | A lab card is never offered for pulling. Its listing has no SKU, so read by SKU it would look "not listed". `cardOffSaleReason()` answers null for it, the way it already does for CardUploader variation cards. |
| **Stack checker** | — | Works on lab cards like any other. Reordering changes `position`, which is what the lab now reads. |
| **Show Desk, stream box, deals** | — | **Lab cards can't be checked out, recommended or added to a deal yet.** They're left out with the reason "lab listing". A lab card at a show would need its listing's quantity managed while it's away, which is a later step. |
| **Storefront, counter, binder** | Show the lab listings as online stock (they're real listings) | Unchanged. |
| **My listings** | Lab listings appear unmarked | A **LAB** badge on any listing that is a lab listing, so the test listings can't be mistaken for ordinary stock. Lookup by item id against `lab_listings`. |
| **Nightly stack import** | Skips lab listings (no SKU) | Unchanged. |
| **CardUploader inventory import** | — | Skips a SKU already on a stack, as now, so a lab card is never stacked twice. |

## What's marked, and how

- **LAB** is one small badge, defined once and used on every screen, linked
  to the lab listing.
- The tooltip and the lab page both say what it means: *"Listed by the lab
  (quantity listing, photo of the copy that goes next). Being tested; not
  yet part of shows, the stream box or deals."*
- The test is always `lab_listing_id` on the card, never a name or SKU
  pattern.

## Tonight's test listings

They're live eBay listings at £2.49, so they can sell, and selling them still
works end to end. Before or after the move, the inventory view's bulk
**£ Set price** (each card's sold-comps price, or one figure) or **End
listings** sorts them out. Nothing in this step changes their prices.

## Checks

- **`check-labcopies.mjs`** re-pointed at `stack_cards`, with the existing
  110-odd cases kept.
- **A new `check-labstacks.mjs`:**
  - the move is idempotent and refuses a SKU already stacked;
  - a lab card is never off sale in Reconcile;
  - the pull sheet takes the RESERVED card and never the front-most;
  - an unreserved lab order is never guessed;
  - a lab card is never checked out, recommended or dealt;
  - `copyqueue` never sees a lab card.
- **A grep** that every reader of `stack_cards` that moves stock has decided
  about lab cards, the same discipline `check-streamstock.mjs` keeps for the
  stream box.

## Order, and what each step changes

1. **Migration 042 and the move.** The lab reads `stack_cards`. Nothing else
   changes yet.
2. **Pull sheet, Reconcile and Stacks.** This is the first change to shared
   screens, and the one with the most risk.
3. **The exclusions** on Show Desk, the stream box and deals, plus the LAB
   badge in My listings.

Each ships on its own and is tested before the next. `npm run check` passes
at every step.

## Questions before building

1. **Tonight's listings:** keep them live through the move, or end them first
   and start the fold with clean test listings?
2. **Lab Pick list:** once the pull sheet picks lab cards, should the lab's
   own Pick list go, or stay as a second view of the same reserved cards (no
   separate Picked button)?
3. **Stack names:** a pile becomes a stack named after its SKU prefix (TEST,
   TEST2). Fine, or should lab stacks get a prefix of their own (e.g.
   `LAB-TEST2`) so they sort together on Stacks?
