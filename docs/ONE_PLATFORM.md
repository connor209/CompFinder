# One platform: CompFinder runs the business

23 Nov 2026 · @Connor

## Summary

After intake, CompFinder becomes the one place the business is run.
CardUploader is used once per stack, for card recognition only. CardCropper
stays on the scanner PC and feeds CompFinder directly, with no CSV in between.

Each eBay listing is **one card in one condition, at quantity N**, backed by
the N physical copies we hold. The listing shows **the photos of the copy that
goes next**, and that copy is reserved the moment it sells. So every buyer
gets the copy they were shown. The other copies stay out of sight until it is
their turn.

It is done when three things have gone: the daily CardUploader pick-list
export, prices typed in a second time, and pressing Pick in two systems. A new
team member must also be able to take a stack from scanner to listed using
only the screens, without the SOP open.

## Today

Three tools hand work to each other by file, and two of them keep their own
inventory. CardUploader has no API and no price import, so every crossing is a
person moving a file or typing a value again.

| Step | Tool | How it crosses to the next |
|---|---|---|
| Scan 150 cards into one folder | Scanner | Folder |
| Split into 3 stacks of 50, crop close-ups | CardCropper | Folders on disk |
| Upload each stack, set the divider (KA), SKUs KA1–KA50 | CardUploader | Manual upload |
| Recognition, then a manual check | CardUploader | — |
| Condition, by hand or with an agent | CardUploader / agent | Retyped or CSV |
| Price, with batch pricing or an agent | CompFinder / agent | CSV out |
| Type prices in, add to inventory, list to eBay | CardUploader | Retyped |
| Export the pick list, daily | CardUploader | CSV into CompFinder |
| Pick and pack against the real pick list | CompFinder | — |

What this costs every day:

- **Two inventories.** CardUploader sells copies under its own variation SKU
  (`CS-P3NSJY_…`), shared by every copy of a card in one condition. Only its
  export says which copy (KA12 or IR19) went with which order, so CompFinder
  cannot pick without it.
- **Prices typed twice.** They are worked out in CompFinder or by an agent,
  then typed into CardUploader one by one.
- **Pick pressed twice.** CardUploader keeps a card listed until Pick is
  pressed there as well.
- **Fragile files.** Every CSV is a chance to open it in Excel and turn `4/99`
  into `Apr-99`.

## Target

CompFinder is the home for everything after the scan. CardUploader is visited
once per stack, never daily. CardCropper does its imaging on the scanner PC and
writes straight into CompFinder.

The only manual crossings left are uploading a stack's scans to CardUploader
and dropping its export back onto the stack.

| When | Where | What |
|---|---|---|
| Per stack | CardCropper | Check breaks; stacks and condition scores go to CompFinder |
| Per stack | CardUploader | Recognise, check, export |
| Per stack | CompFinder | Condition, price, list, shelve |
| Daily | CompFinder | Pick, pack, ship, returns |

## How a listing works

This is the decision everything else rests on, so it gets its own section.

**One listing = one card + one condition.** Condition is a listing-level fact
on eBay, so an NM copy and an LP copy can never share a listing. Three NM
Umbreons and one LP Umbreon are two listings: quantity 3 and quantity 1.

**The listing shows the copy at the head of the queue.** Copies of one card
and condition form a queue, ordered by `copy_seq`, then by when the copy was
scanned, then by row id. `apps/app/lib/copyqueue.js` is the one definition. The
listing's photos are the head copy's own scans, never a stock image and never
several copies at once. Several scans on one listing tell a buyer that several
cards exist and nothing about which one they get.

**A sale reserves the head copy, and the photo moves on at once.** eBay reports
only the listing's SKU on a sale, never which copy, so the assignment is ours.
When the order sync sees a sale, it does three things:

1. It takes the head copy and reserves it for that order line.
2. It drops that copy from the queue.
3. It revises the listing to the next copy's photos and the new quantity, in
   one `ReviseFixedPriceItem` call.

The copy is reserved at **sale time, not at pick time**. Otherwise the listing
keeps showing a copy that has already been bought until the morning pick, and
a second buyer that evening buys the same photo and is sent a different card.
This is the one change to how `copyqueue.js` behaves today: it only treats a
copy as gone once it is pulled or away at a show.

**Pick sends you to the reserved copy.** Every order line names a physical
copy, and its location comes from its live position (`stackpos.js`). The pull
sheet never chooses a copy by a rule of its own. A second ordering (for
example, "front-most in walk order", which `pullmatch.js` uses for
CardUploader listings) would sometimes choose a different copy from the one in
the photo. `check-copyqueue.mjs` must fail if one appears.

**A multi-quantity order.** The first unit is the copy in the photo, and the
rest are the next copies in the queue. The listing says so:

> Photo shows the copy you will receive. If you buy more than one, the others
> are further copies of the same card in the same condition.

**SKUs.**
- The listing's **Custom Label** names the card and condition.
- **KA12** is the copy's own name, given at intake. It never moves and is never
  sent to eBay.
- **Where KA12 is** is its live position in its stack, which changes as cards
  in front of it are pulled.

**The photos are CardUploader's.** Every copy's scans are the ones
uploaded to CardUploader for recognition, at the URLs its export gives. We
keep no copies of our own for now. eBay copies a picture into its own hosting
when it is added to a listing, so a live listing does not depend on
CardUploader. Only the next revision does, because it needs the next copy's
scan URL to still load.

**eBay caches pictures by URL.** Every copy's scan gets its own URL and is
never overwritten in place. `listing_copy_state` records which copy each
listing was last revised to show, because eBay rehosts every picture and the
URL it returns cannot be compared with ours.

## Experience principles

Intuitive means someone new can take a stack from scanner to listed using only
the screens. Each principle is a rule a screen can be checked against.

1. **The stack on the desk is the unit.** Everything is organised by stack
   (260820-001) and divider (KA), with the same name as the slip on top of the
   physical pile. Nobody hunts for a batch, a file or a run.
2. **Every stack shows where it is and what comes next.** One status line per
   stack: Scanned → Recognised → Conditioned → Priced → Listed → Shelved. The
   stack page has one main button, and it is always the next step.
3. **No files between our tools.** CardCropper and CompFinder share one
   database, so no CSV is downloaded or uploaded between them. The only file
   left is CardUploader's export, which is dropped onto its stack and matched
   automatically.
4. **Show the card, not just its data.** Every row shows the front thumbnail
   beside its name, set and number, so a wrong match or a swapped pair is seen,
   not deduced.
5. **Show only what needs a decision.** Screens lead with the exceptions
   (low-confidence price, HOLD, a possible crease, a failed match, a £0.00) and
   let the rest go through with one confirm.
6. **See it as the buyer will before it goes live.** Listing opens a preview of
   each eBay page as it will look: the head copy's photos, the quantity, the
   condition and the price. Nothing reaches eBay without that step, and a bulk
   action only ever touches rows on screen.
7. **One set of words everywhere.** Stack, copy, location, grade, listing and
   queue mean the same thing on every screen, in the SOP and on the labels.
8. **The right device for the job.** Intake is designed for the desktop beside
   the scanner; pick and pack for a phone in one hand.
9. **Errors say what to do.** "KA14 has no back scan — rescan it into
   260820-001", not "import failed".

**How it is tested.** Before building, time one stack and count the screens
and files it touches today. After each phase, a person who has not used the
new flow processes a stack without help or the SOP, and anything they ask
about is a bug.

## User journeys

Four journeys cover the business: intake (per stack, desktop), listing (per
stack, desktop), pick and pack (daily, phone) and returns.

### Intake: a 150-card run becomes three stacks ready to list

1. **Scan** the run into the day's folder, as today.
2. **Check the breaks in CardCropper.** It shows the last card of each stack
   beside the first card of the next, as the Split tab does now. Confirm each
   one against the pile.
3. **Stacks appear in CompFinder by themselves.** CardCropper creates the three
   stacks (260820-001 to -003), gives each the next free divider (KA, KB, KC),
   and crops every card. Each stack shows **Scanned** and
   the slip to write for the top of the pile.
4. **Recognise in CardUploader.** The stack page shows the one thing to do
   there: the folder to upload and the divider to type, each with a copy
   button. Recognise, check the matches, export.
5. **Drop the export onto the stack.** CompFinder matches each row to its copy
   by SKU, keeps every scan URL on the row, and shows the scan beside
   CardUploader's catalogue match. Rows where they
   disagree come first. The stack moves to **Recognised**.
6. **Condition.** The stack opens worst-first, with the back corners already on
   screen. One key per grade (NM, LP, MP, HP, DMG, HOLD) and an optional
   one-line flaw note. An agent's grades, if used, arrive pre-filled and are
   confirmed with Enter. A crease on anything graded above HP is stopped with
   the reason shown. The stack moves to **Conditioned**.
7. **Price.** Pricing runs on its own once a stack is conditioned, by card and
   grade. The screen opens on the Low, Skipped and £0.00 cards only; the rest
   are accepted with one confirm. The stack moves to **Priced**.

### Listing: a priced stack goes live

1. **Press List stack.** CompFinder groups the stack's copies by card and
   condition. A copy whose card and condition already has a live listing joins
   that listing's queue at the back, and the listing's quantity goes up by one.
   Its photo stays on the copy already showing. The rest become new listings,
   each showing its head copy.
2. **Preview.** One screen shows each listing as a buyer will see it: title,
   condition, price, quantity and the head copy's photos. Anything new is
   highlighted: a new listing, a quantity change, or a price far from the one
   already live.
3. **Publish.** Progress shows per listing. A failure says what to fix, for
   example a missing item detail, and the rest carry on.
4. **Shelve.** Put the stack behind its divider and press **Shelved**. The
   stack is done and closes.

### Pick and pack: every morning, on a phone

1. **Open Pick.** Today's orders as one list, sorted by divider and position
   (KA3, KA17, KB2…), whichever system listed them. Each line shows the photo
   of the copy reserved for that order, its location and the order.
2. **Tap Picked** as each card comes out. The listing already moved on at sale
   time, so picking changes nothing on eBay. It marks the copy as having left
   the box.
3. **Can't find it?** A button offers the next copy in that queue, with its
   photo, and drafts a short message to the buyer. Nothing is swapped until
   the buyer approves, because they bought the copy in the photo. On approval
   the substitute is reserved and the listing revised again, so it cannot sell
   twice.
4. **Pack** in the pack tab as today, then mark shipped. Tracking goes to eBay.

### Returns

1. Scan or type the returned copy's SKU.
2. Re-grade it on the same condition screen.
3. Choose **Relist** or **Set aside**. A relisted copy joins the back of its
   card and condition's queue, which raises that listing's quantity; if it has
   no listing, it becomes one. A copy re-graded to a different condition goes
   to that condition's listing, not its old one.

## What gets built

Nine pieces, in build order. Almost all of it is CompFinder work; CardCropper
changes only in piece 2. Each piece ships behind the one before it and is
usable on its own.

| # | Piece | Where | Done when |
|---|---|---|---|
| 0 | Live test of the queue: one card at quantity 3, each copy with its own scans | eBay, via `scripts/copyqueue-run.mjs --item <id> --apply` | A sale moves the photo to the next copy, the quantity is right, and the photo a buyer saw matches the copy picked. See `docs/MULTI_QUANTITY_LISTINGS.md` for the 20-card version |
| 1 | Stack board: every stack with its status and one next-step button | CompFinder | It is the app's home screen for intake and shows existing stacks correctly |
| 2 | Scan station: confirmed breaks create stacks, assign the next divider and send each copy's condition scores | CardCropper | A 150-card run appears as three Scanned stacks, and no CSV is written |
| 3 | Drop-in CardUploader import, with our scan shown beside its match | CompFinder (extends `import-store.js`) | Mismatches list first, and the stack moves to Recognised |
| 4 | Condition screen: worst first, keyboard grades, agent pre-fill, crease rule | CompFinder, with scores computed by CardCropper | A stack of 50 can be graded without leaving the screen |
| 5 | Pricing by card and grade, exceptions first | CompFinder (batch pricing) | Only Low, Skipped and £0.00 need attention; the price is saved on each copy |
| 6 | Listing from the queue: create a listing at quantity N, add a copy to an existing one, plus the buyer preview | CompFinder (`copyqueue.js`, `reviseFixedPriceListing()` and the eBay listing code) | A priced stack goes live from one Preview → Publish, and new copies join existing listings |
| 7 | Sale-time reservation, and Pick by location from eBay orders, with the can't-find flow | CompFinder (order sync, pull sheet) | The photo moves on within one sync of a sale, and a morning's picks need no CardUploader export |
| 8 | Returns: re-grade, then relist or set aside | CompFinder | A returned copy is back in its queue, and on sale, in under a minute |

Pieces 0, 6 and 7 carry the risk; the rest reuse things that already work.
Piece 0 comes first because its result decides whether 6 and 7 are built this
way at all.

### What already exists, and what is new

> **Status, 26 Nov 2026.** The three "New" items below are built — in the
> lab, not on `copyqueue.js`: the reservation is `stack_cards.reserved_*`
> (migration 042, `lib/lab-run.js`, the sale notification and the nightly
> sweep), the pull sheet takes a lab card's RESERVED copy and never
> `pullmatch.js`'s front-most rule (`check-labstacks.mjs`), and the screens are
> `/panel/lab` (Overview, Batches, Inventory, Listing settings). See
> `docs/LAB_FOLD.md` and `docs/PLATFORM_REVIEW.md`. The text is kept as the
> plan it was.

- **Built and tested, untested on live eBay:** the queue, its ordering, the
  desired quantity and photo, the reconcile, and the per-unit pull plan for a
  multi-quantity order (`copyqueue.js`, `check-copyqueue.mjs`). Also the photo
  and quantity revision (`reviseFixedPriceListing()` in `ebay.js`) and the
  schema (`copy_seq`, `scan_url`, `listing_copy_state`, migration 027).
- **New: the sale-time reservation.** A copy belongs to an order line from the
  sale onwards. That needs a column or a small table naming the order line,
  and a migration. The queue then skips reserved copies as well as pulled and
  away ones.
- **New: one ordering.** The pull sheet takes the reserved copy for a
  CompFinder listing and never reapplies `pullmatch.js`'s front-most rule.
  `check-copyqueue.mjs` pins it.
- **New: the screens.** There is no screen on any of this today.

### Rules the new paths inherit

None of these are new. The listing and pick paths must not be the place they
lapse.

- **Prices.** Everything that sends a price to eBay reads `effectivePence()`,
  never `finalPence`, so a price someone typed is the one that goes up. The
  `check-override.mjs` grep covers the new publish path.
- **£0.00.** A stack with a £0.00 card cannot be published until it is priced,
  and the refusal names the cards (`exportGuard()`, `check-zeroprice.mjs`).
- **HOLD and a possible crease** are exceptions on the review screen, never
  part of a one-confirm accept.
- **Stock is read per copy, not per listing.** A quantity-0 listing is a card
  that has gone (`isListingAvailable`). A copy that is reserved, pulled or away
  is not stock on any screen: Reconcile, ★ Recommend show stock, the counter,
  the binder or the storefront.
- **Magic stays on Cardmarket.** `isCardmarketStack()` keeps MTG- dividers off
  the stack board and out of List stack.
- **CardCropper writes as a signed-in user, or through one narrow endpoint
  in the app.** It never holds the service-role key: a key on a shop
  PC can read and write everything. Divider letters are handed out by the
  database in one step, so two runs can never take the same letter.

## Rollout

Four phases, each usable on its own, each with a gate that must pass before the
next starts. Nothing about today's process is switched off until the phase
that replaces it has passed its gate.

| Phase | Pieces | Gate |
|---|---|---|
| 1 | 0 | **One live listing at quantity 3 sells a copy, the photo moves to the next copy within one sync, and the copy picked is the one the buyer saw.** If this fails, stop and redesign 6 and 7 |
| 2 | 1–5 | One stack goes from scanner to Priced with no CSV between our tools, and a fresh-eyes tester does it without the SOP |
| 3 | 6–7, on one stack | That stack lists, sells and is picked for two weeks with no CardUploader export and no wrong copy sent |
| 4 | 8, then all new stock | A returned copy is back in its queue in under a minute; every new stack goes through CompFinder |

Until the last CardUploader listing sells, the daily export continues for those
listings only, and Pick shows both kinds in one list.

## Risks and open questions

| Risk | What it would do | How it is handled |
|---|---|---|
| Two sales land before a sync runs | The second buyer saw the first buyer's photo | Reserve in sale order. The second buyer gets the next copy and the line is flagged on Pick, so it can be checked against the photo before it ships. Measure how often it happens in phase 3 |
| A buyer of several copies expects them all to match the photo | A return or a complaint | The listing wording above, shown in the preview |
| eBay keeps showing an old photo | The buyer sees a copy that has gone | Every scan has its own URL, never overwritten. `listing_copy_state` records what each listing was last revised to show |
| A bug lists or prices live stock wrongly | Wrong prices on eBay in bulk | Preview before every publish, bulk actions only on rows on screen, a log of every eBay change |
| CardUploader changes its export | Recognition stops reaching CompFinder | The import checks the columns and refuses with a clear message, never a partial import |
| CardUploader stops hosting scans (we leave, it changes, or it deletes old ones) | Live listings keep their photos, because eBay copies a picture when it is added. What breaks is moving a listing on to its next copy, and showing scans in CompFinder | The revision checks the next copy's scan URL loads before sending it, and holds the listing on its current photo with a warning if not. Our own storage is a later piece, worth building only if this ever happens |
| The same card is in two listings during the move | A little untidy, no harm | Pick shows orders from both in one list |
| Staff learn a new flow mid-season | Mistakes while it beds in | One stack trial first, and the SOP rewritten for each phase |

Open questions:

- [ ] How long does one stack take today, stage by stage? Measure before
      building, so each phase can be judged. Import timestamps and the
      stack-check log (migration 038) already record part of it.
- [ ] Should the stack slip and divider labels be printed from CompFinder?
- [ ] What does CardUploader cost per month? This decides whether replacing its
      recognition later is worth it.
- [ ] Who does the fresh-eyes test after each phase?
- [ ] How often does the order sync run? It sets how long a sold copy's photo
      can stay up (see the first risk).
