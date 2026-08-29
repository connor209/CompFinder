# A digital storefront at a card show

Concept note, 2026-08-29. Question: buyers at a show scan a QR code, browse the
stock we brought but couldn't fit on the table, and submit a request; we pull
the cards and show them. Is it worth building, and what shape should it take?

**Updated the same day, after a test at a show.** The first of the three
products below was tried with no code at all and worked: someone asked "do you
have any gengars", the Show Desk was searched in front of them, and cards sold
that were in a box under the table. What that settles, what it does not, and
what shipped in response are in "Measured" below. The rest of this note is the
reasoning as it was written before any of it existed.

## TL;DR

- **The counter tool is proved as of 2026-08-29** — cards sold off-table at a
  show because the stock list was searched in front of a customer. That is
  product 1 of the three below; the QR remains untested and unbuilt.
- **Worth building, but the best argument for it isn't the pitch.** Checking a
  card out to a show currently makes it invisible *everywhere* — the eBay
  listing is hidden so it can't double-sell, and there's no table space to
  show it. For the length of the show that card is less exposed than it was
  sitting at home. A storefront is where checked-out stock goes to still exist.
- **The constraint is display space, not transport.** We can carry far more
  than we can lay out. That makes this a revenue-per-table change rather than a
  convenience feature, and it is the reason the build is worth more than it
  looks.
- **The catalogue scales for free; the hands don't.** Pull labour is linear in
  requests and completely indifferent to how good the storefront is. At volume
  this is a **picking** problem, not a browsing one — and `stackpos.js` and
  `PullSheet.js` already solve picking. Batching requests into one
  position-ordered walk is what makes it work at 800 cards instead of
  collapsing. Design for it from the start; retrofitting batching onto a
  first-come-first-served queue is a rewrite.
- **Most of the parts exist.** Open `stock_checkouts` rows already ARE the show
  pool. Migration 024 already carries `sticker_pence`. `showfilter.js` already
  searches it. `ebay_listings.image_url` already holds a photo of the actual
  copy. The genuinely new code is a read route, a request table and a queue
  screen.
- **It belongs in `apps/app`, on a per-event token — not on Last Comp.** Last
  Comp's proposition is *disinterested* pricing; putting our own shop on that
  domain makes every price on it read as a sales pitch. A third Vercel project
  costs a third build on every push against a deployment cap we have already
  hit. See "Where it lives".
- **Show day is the least interesting use of it.** The same system pointed at
  the weeks *between* shows — browse from home, request for the next one —
  converts a one-day event into a standing channel and tells us what to pack.
  That is where the value compounds.
- **As a product for other dealers, be sceptical.** The request form is a
  weekend's work for anyone. What isn't copyable is putting the sold comps next
  to the sticker. But the system is worthless without structured inventory, and
  most dealers have a shoebox and a good memory.
- **Two numbers decide it and neither is measured**: what share of revenue
  comes from shows, and whether anyone scans. See "What would make this a
  mistake".

---

## Measured, 2026-08-29

The counter tool was tested at a show with no build behind it — the Show Desk
on a tablet, turned round when a customer asked a question. **Cards sold that
were not on the table.**

**What that proves:** stock nobody can see converts the moment somebody can see
it, and the retrieval is fast enough to hold a conversation over. That is the
premise of everything below, and it is no longer an assumption.

**What it does not prove:** nothing about the QR. Nobody scanned anything — the
tablet was handed over, in a conversation that had already started. The
self-serve product is exactly as untested as it was this morning, and the
scan-rate question in "What would make this a mistake" is still open.

**The most useful thing the test surfaced was a gap, not a success.** "Do you
have any gengars" is a want. The ones where the answer is NO leave no trace
anywhere — no sale, no checkout, no row — and they are the buying list. A day
of them is gone by the next morning.

### What shipped in response

- **Counter mode on the Show Desk** (`apps/app/lib/showcounter.js`). The same
  list, search and sort, projected to picture, name and price. The desk's own
  screens are not rendered at all while it is on, rather than styled away.
- **The projection is the one this note specifies for the anonymous route.**
  Built now, against real customers, on a tablet where the result is visible —
  rather than designed abstractly for a web route nobody has used. The public
  storefront serves this shape or it serves a second, quietly divergent copy.
- **`show_wants`** (migration 026) and `apps/app/lib/wants-store.js` — one tap
  from the search box, recording what was asked for and whether we had it.
- **`scripts/check-showcounter.mjs`**, which stuffs a checkout row with every
  private value and asserts none survives the projection, then slices the
  counter branch out of the render and checks it for desk data and destructive
  buttons.
- **The online stock, as a second list.** Counter mode answers a search with
  cards we have listed on eBay and haven't checked out — under its own heading,
  never merged, and worded as *"ask us"* rather than *"not here"*. Checkout is
  not complete enough to claim absence: a card can be in the box and missing
  from the checked-out list, and saying we haven't got it loses a sale already
  made. This is the honest version of the "unbounded catalogue" the note above
  wanted, and it needs no new table.

Three things the test did NOT settle, still open below: what share of revenue
shows are, whether anyone scans a cold QR, and whether the pull-request flow
earns its place at all once the search exists.

## The problem, stated properly

A table at a show is a fixed cost that buys a fixed amount of display area. We
own far more sellable stock than fits on it. Everything not laid out is dead
for the day: nobody can browse a closed box.

Worse, it is dead *online* too. `checkoutStackCard()` hides the eBay listing on
the way out — quantity-zeroed or ended, per `HIDE_MODES` — which is exactly
right, because the alternative is selling the same card twice. But the
consequence is that attending a show takes stock off the one channel where
people could see it and puts it somewhere they can't.

So the honest framing is not "wouldn't it be nice if buyers could browse". It
is: **we currently delete the visibility of everything we bring, and we do it
on purpose, and there is no reason it has to stay deleted.**

## What already exists

Unusually much. The show pool needed no table of its own and this needs very
little more.

| Piece | Where | What it gives |
|---|---|---|
| The pool | `stock_checkouts`, `resolved_at is null` (016) | The list of what is at the show. Already the single definition. |
| Prices | `sticker_pence`, `sticker_set_at` (024) | A cash price per card, already computed, already held back when thin. |
| The price rules | `showstock.js` | `stickerPence()` ladder, `stickerFor()` gate, overrides. |
| Search and filters | `showfilter.js` | Token-order-free search over SKU, name, event, stack; facets built from the rows. |
| Physical location | `stackpos.js`, `PullSheet.js` | Live rank among present cards, and a pick order. |
| Photos of the real copy | `ebay_listings.image_url` (002) | The actual card, actual condition — better than catalogue art. |
| Photos we took | `listing-photos` public bucket (012) | Already a *public* bucket, which is what a storefront needs. |
| Catalogue art | `card_catalog.image_small` (022) | Fallback art for anything with no photo. |
| Camera capture | `lib/camera.js`, `Scan.js` | The iOS rear-camera problem is already solved. |
| **The buyer projection** | `lib/showcounter.js` (2026-08-29) | An allow-list: picture, name, price. What the anonymous route should serve. |
| **The want list** | `show_wants` (026), `lib/wants-store.js` | What people asked for, and whether we had it. |

What is missing is a read route, a request table and a queue screen at the
desk. The picture decision and the buyer-facing projection are now made — see
"Measured" — which were the two parts that needed judgement rather than typing.

## Pictures are the part that decides whether it feels like a binder

A binder is visual. A list of eBay titles is a spreadsheet, and nobody browses
a spreadsheet at a table.

For stock that is (or was) listed, `ebay_listings.image_url` is the right
answer and it costs nothing: it is a photo of the specific copy, with its
actual condition visible. For stock that was never listed there is no photo at
all, and photographing hundreds of cards is hours nobody will spend.

Proposed rule, to be written down in one place if this gets built:

- **Above a value threshold, a real photo or the card doesn't go in the
  storefront.** For a chase card the specific copy is the thing being bought —
  centring, edges, surface — and catalogue art is a claim we can't back.
- **Below it, catalogue art plus condition in text.** For a £3 raw common the
  art *is* the card, and the variable is condition, which words carry fine.

`CLAUDE.md` already holds the principle this derives from: a missing picture is
a gap, a wrong picture is a lie, and it is the most confident-looking thing on
the page. That applies double here, because a buyer is requesting *based on the
picture* and will be handed the object to compare it against.

## Where it scales, and where it doesn't

The catalogue side is indifferent to size. Four hundred rows or four thousand,
it is the same query and the same filter code.

**Pull labour is the ceiling.** It is linear in requests, it does not improve
when the storefront improves, and it is one person and one box. Eight
simultaneous requests is a queue with no counter staff, and a buyer who waits
six minutes and drifts off is a worse outcome than never having offered the
service.

Which means at volume this is a **warehouse picking problem wearing a
storefront's clothes**, and the fix is already half-written:

- **Batch requests into one walk.** Five requests, sorted by stack and live
  rank, one trip through the boxes. `liveRanks()` and `stackDepths()` already
  produce that ordering and `PullSheet.js` already renders that kind of list.
- **Never show a raw FIFO queue at the desk.** The right unit of work is a
  pick run, not a request.
- **Throttle explicitly.** Staffing varies by show. There needs to be an
  obvious *pause requests* switch, and an automatic pause above some number
  outstanding. Turning the sign off is a better failure than a queue that can't
  be served.

Everything above is a design constraint on day one. A first-come-first-served
implementation is not a smaller version of this — it is a different thing that
has to be replaced.

## The hold, and when its clock starts

A request should reserve the card, but **the hold starts when we pull it, not
when the buyer taps.** With eight requests queued, a reservation timed from the
tap means card eight is held for twenty minutes before anyone has touched it —
unavailable to the person standing in front of us, for the benefit of someone
who may have left.

- Held cards go **grey, not gone**, to other scanners. "Someone is looking at
  this" is useful; a card vanishing from a list is confusing and looks like a
  bug.
- Expiry a few minutes after it reaches the table, then back to the pool.
- A cap of a few open requests per device. A free request is an abandoned
  request.
- A no-show path that returns it, because otherwise the pool silently drains
  over a day.

## Where it lives

**Not on Last Comp.** Two reasons, and the second is the bigger one.

The mechanical reason: indexing was opened on 2026-08-25 with 450 URLs that
have only just started to rank. Show inventory is thin, ephemeral and gone by
Monday — precisely the "Crawled — currently not indexed" risk `CLAUDE.md`
already flags, and it would drag the card pages with it.

The real reason: **Last Comp's whole proposition is that it has no stake in the
number.** It shows its working, it says when it excluded a comp, it publishes
its own £44.75 mistake. Put our shop on the same domain and every price on it
starts reading as a sales pitch. That is not recoverable by putting it on a
different route. Keep the price authority and the seller apart.

**Not a third Vercel project.** Both projects already build on every push, and
a day of merges has already hit the Hobby deployment cap once, with the live
site quietly serving the commit before the fix. A third project makes that
three builds per commit and adds another Root Directory to get wrong — for
what is, in the end, one read route and one write route.

**A route in `apps/app`, and this is the recommendation.** All the logic is
already there — `checkout.js`, `showstock.js`, `showfilter.js`, `stackpos.js` —
and this repo's culture is one definition per rule, with a grep behind it. A
storefront anywhere else means a second copy of "what is in the pool" and "what
does it cost", and the two disagreeing is invisible until a card sells for the
wrong money.

The honest cost is that `apps/app` gets its **first anonymous surface**, which
is a real change to that app's threat model. It stays containable only if it is
contained on purpose:

- **One read-only API route**, service-role, keyed by a **per-event token**
  carried in the QR. Per-event rather than per-user, so a token dies with the
  show and a leaked one is worth nothing by Monday.
- **Never a table read from the browser.** RLS on these tables is
  `auth.uid() = user_id`; an anonymous visitor has no `uid`, and the answer to
  that is a narrow server route, never a loosened policy.
- **A buyer-facing projection, not the row.** Out: title, picture, condition,
  sticker price. **Never** SKU, never stack or position, never cost, never
  anything from `purchases` or `deals`. A buyer seeing our buy price is a
  disaster mid-negotiation; stack positions tell them how deep the stock is.
- **Writes go through a separate, rate-limited route**, because a request
  creates work for a human.
- **`noindex`**, and a check script that greps the anonymous route for any
  select of the private columns — the same pattern as `check-override.mjs`
  greps the money-out paths. The failure this prevents is silent.

## Operational consequences at scale

- **Prefer quantity-zeroing over ending listings for the show pool.** Ending
  churns item ids and throws away listing age, watchers and impressions. That
  is a fair trade for forty cards and an expensive one for four hundred.
  `HIDE_MODES` already offers the choice; the show pool should default to
  `quantity`.
- **The cash ladder collapses at the bottom.** `stickerPence()` puts £2.49 and
  £2.99 both at £3, and anything under £1.50 at £1. Correct for a label,
  strange in a browsable list where the cards sit next to each other. Cheap
  stock probably wants a "3 for £5" section rather than a per-card price.
- **Held rows have no sticker at all.** `stickerFor()` withholds a price on low
  or no confidence, and on prices built from active listings. A storefront
  needs a deliberate answer for those — "ask at the table" is a fine one, a
  blank is not.
- **Venue connectivity is bad.** Hundreds of people on one mast. A buyer
  failing to load is survivable; the desk failing to receive a request is not.
  Whatever gets built should assume the desk's connection drops and comes back.

## Three products, not one

Written after the fact, because the note above conflates them and they do not
share a verdict. All three read the same table and the same price, which is why
they look like one idea.

| | What it is | Verdict |
|---|---|---|
| **1. The counter tool** | You search your own stock in front of a customer who asked. No QR, nothing buyer-facing. | **Proved, 2026-08-29.** Needed no new code to test. Now built properly. |
| **2. The self-serve QR** | Strangers scan, browse, submit a request, wait for a pull. The original pitch. | Weakest. Low scan rate, and the wait competes with walking to the next table. Untested. |
| **3. The persistent storefront** | Stock browsable from anywhere, all the time — between shows, from social, taking requests for the next event. | Where the business is. Works at a scan rate of zero. |

**The dead-inventory argument at the top of this note justifies 3, not 2.** If
nobody scans, checked-out stock is just as invisible as it was. Worth being
precise about, because the two arguments are easy to run together and only one
of them survives a low scan rate.

**1 and 3 can be built without ever building 2**, and 1 is now the thing 3
inherits its projection from.

## Beyond show day, which is where it compounds

Show day is the narrowest use of this. The same system, barely changed:

- **Between shows.** Browse from home, request for the next one. That turns a
  one-day event into a standing channel, and it converts packing from a guess
  into a list.
- **Instagram and Facebook groups**, where a lot of card trade actually
  happens. A link to live stock replaces posting photo dumps and answering
  "still available?" forty times.
- **Demand data.** What gets viewed and *not* requested is the only read we
  will ever get on whether show pricing is right. Same shape of argument as the
  EPN dashboard being Last Comp's only traffic signal: it isn't much, but it is
  the only one there is, so it should be designed in rather than bolted on.

The third one is the reason to log views from the start. It costs nothing at
build time and cannot be recovered retrospectively.

## As a product for other dealers

Worth separating from the above, because the answers differ.

The pull request is not defensible. A QR, a list and a form is a weekend for
anyone who wants it. What is not copyable is the thing underneath: we can put
*"£40 — and here are the last eight sales, median £52"* on a table, and no
other dealer at that show can. If this ever goes commercial, **the storefront
is the wedge and the pricing engine is the product.**

But the addressable market is narrower than it looks. The system is worthless
without structured inventory — SKUs, stacks, positions, an eBay sync. We have
that because we built it over months. Most dealers have a shoebox and a good
memory, and getting them from there to here is the boring, expensive,
unglamorous majority of the work. That should be understood before anyone gets
excited about selling it.

## What would make this a mistake

Two things, neither currently measured. They are the first things to find out,
and both are cheap to answer.

- **If shows are a small share of revenue.** At 10% this is a fun build
  competing for time against anything touching eBay listings, which is the real
  business. At 40% and capped by table space, it is the highest-leverage thing
  on the list. Nobody has written the number down.
- **If nobody scans.** QR fatigue is real. The mitigation is mostly not
  software: *"500 more cards under this table"* gives a reason to scan, a bare
  QR code doesn't. This is testable at one show with a printed sign and a
  static page, before any of the above is built.

The cheapest honest test is a single show with a sign, a read-only list and no
request flow at all — just the catalogue and a count of how many people looked.
If the scan rate is there, the rest is worth writing. If it isn't, the
between-shows version above is still worth building, and none of this
paragraph applies to it.

**The counter tool has now had its equivalent test and passed** (see
"Measured"), which is why it is built and the QR is not. Test each product on
its own evidence: product 1 working says nothing about whether strangers
scan.

## Open questions

- Does the request need a name or a phone number, and what happens to it
  afterwards? Anything collected is data we then have to hold and justify, and
  the privacy stance on the public side is strict on purpose.
- Do prices show at all, or only on request? Showing them lets people
  self-select and cuts haggling; it also invites a price-check against eBay
  while standing there. Probably worth showing, since we would win that
  comparison and can show why.
- What happens to a request when the show ends and the pool resolves?
- Does the storefront cover cards that never went through Stacks or eBay? Held
  out of scope for now, but it is the thing most likely to be wanted second.
