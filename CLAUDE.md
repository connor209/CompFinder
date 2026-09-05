# CompFinder

Two deployables share one pricing engine. **Say which one you mean before
editing anything** — the words below are the agreed shorthand.

## Naming

| Say this | Means | Vercel project | Who uses it |
|---|---|---|---|
| **the app**, **Pro** | `apps/app` | `comp-finder` | us, daily, for the business |
| **Last Comp**, **the public page** | `apps/public` | `compfinder-public` | anonymous visitors |
| **core** | `packages/core` | — | both of the above |
| **the relay** | `tools/stream-relay` | — | OBS, on the machine running a stream |

The public page is called **Last Comp** as of 2026-08-23 — the Vercel project
and the repo keep the old name, so "CompFinder" in a path is the codebase and
"Last Comp" in copy is the product.

If a request could mean either ("fix the price display", "change the buy
module"), **ask which before editing** rather than guessing. They now contain
similar-looking components that behave differently, so a guess wastes a round
trip and can put a change in the wrong product.

## The rule that matters

**A change to `packages/core` changes both products.** Pricing, comp filtering,
EPN tagging, name cleaning and set matching all live there. Before editing
anything in `packages/core`, say so explicitly and confirm the change is wanted
in the app *and* on the public page — a pricing tweak that suits a batch run can
be wrong for a stranger's one-off lookup.

Nothing in `packages/core` may import React, Next, Supabase, or app code. That
is what keeps it shareable; breaking it breaks both apps.

## Layout

```
packages/core/   pricing · soldcomps · cardname · marketplace · epn · catalog · setmatch
apps/app/        the business tool — eBay OAuth, inventory, batch, scan
apps/public/     the free price page — no accounts, shared key, cached
tools/           stream-relay: a local server OBS points at during an eBay Live
                 auction. Not deployed, no dependencies, not a workspace.
Start Stream…    double-click launchers for the relay, at the root because the
                 point of them is not having to find a folder
supabase/        migrations, shared by both
docs/            research reports; MARKETING.md is the current acquisition plan
                 HOW_PRICING_WORKS.md is the app's pricing in plain English
                 PRICING_RESEARCH.md is where to strengthen it next
```

Run everything from the repo root: `npm run dev` / `npm run build` (the app),
`npm run dev:public` / `npm run build:public` (the public page), `npm run
stream` (the relay, only while streaming).

## Checks

`npm run check` runs thirty-four table tests, no framework, non-zero exit on failure:

- `scripts/check-language.mjs` — which sets `languageOf` calls English.
- `scripts/check-corebrowser.mjs` — what shared code ships to a BROWSER: a
  grep for regex lookbehind across core and both apps, plus the two rules
  ("60 HP" is a stat, "Reverse Holo" is not "Holo") that the lookbehind-free
  rewrites had to preserve.
- `scripts/check-exclusions.mjs` — which comps the pricing engine excludes,
  and — since the rule inverts when the card being priced is itself a slab —
  which card we are holding.
- `scripts/check-resolve.mjs` — what the resolver parses and how it ranks.
- `scripts/check-public-price.mjs` — a grep: no charm ladder on the public side.
- `scripts/check-turnstile.mjs` — pass forgery, client binding, expiry, off-switch.
- `scripts/check-liquidity.mjs` — how a capped result set is read, and a grep
  against anyone guessing it from a comp count again.
- `scripts/check-images.mjs` — which picture goes with which card.
- `scripts/check-windows.mjs` — the sold window: one list, read off the URL.
- `scripts/check-listings.mjs` — which live listings may be shown, and which may
  be the hero. Built around the £44.75 Umbreon that shipped.
- `scripts/check-cardquery.mjs` — the query a card is searched by and the cache
  key it hashes to, keys pinned, with a grep against a second derivation.
- `scripts/check-cardpage.mjs` — that a cached card server-renders a price, and
  that everything else falls through to the client.
- `scripts/check-indexing.mjs` — that the door to search engines defaults shut,
  that robots.txt and the page metadata give the same answer, and which card
  URLs are pages for the index at all: a canonical and a `noindex` are
  mutually exclusive and one of them is always emitted.
- `scripts/check-canonical-host.mjs` — the hostname redirect: production
  bounces to the one canonical host, previews and dev are never bounced, and a
  missing `NEXT_PUBLIC_SITE_URL` means no redirect rather than a loop through
  Vercel's apex 308.
- `scripts/check-share.mjs` — the shareable PNGs, card and set: always dated,
  sold figures only, long names cut, the set board ranked and capped, and greps
  against either ever growing an asking price or reaching past the cache.
- `scripts/check-clientboundary.mjs` — that nothing rendering on the server
  CALLS a function out of a `"use client"` module. It builds clean and throws
  at request time, and only once the data has a value to format.
- `scripts/check-epn-tag.mjs` — what an affiliate link reports about itself:
  the sub-IDs, that the slot prefix still selects what it always did, that
  `epn.js` passes them through unrewritten, and a grep against hand-writing
  one at a call site.
- `scripts/check-batchsave.mjs` — what survives saving and re-opening a batch
  run: every comp, every exclusion reason, the asking prices on the right card,
  and a grep against a second definition of the saved shape.
- `scripts/check-showstock.mjs` — the show pool and the price that reaches a
  label: the cash ladder as a table, which prices are held back, that a graded
  card starts from our own eBay price while a raw one never does, and that a
  column added by a hand-applied migration degrades instead of breaking.
- `scripts/check-showfilter.mjs` — finding one card in the box: what a query
  looks at, that AB2 sorts before AB11 and an unstickered card sorts last in
  both directions, and — the one that costs cards — that a bulk action only
  ever acts on rows that are on screen.
- `scripts/check-showcounter.mjs` — the list turned round to face a customer:
  that the projection is an allow-list rather than a filter, that no private
  value survives it, that a held price asks instead of showing a number, and a
  slice of the render itself checked for desk data or a destructive button.
- `scripts/check-binder.mjs` — the digital binder: that a pocket is an
  allow-list like the counter row, that four copies of one card fold into one
  pocket while four different cards never do, that a page is nine pockets with
  the last one padded, that the eBay stock gets its own pages and never shares
  one with the box, that opening the binder on a wide screen pairs pages
  without renumbering any of them, and — the one that costs you the screen —
  that a mostly vertical drag is a scroll rather than a page turn.
- `scripts/check-panelstate.mjs` — a state setter that was never declared.
  Born from a white screen: the Show Desk shipped calling `setPhoto()` with no
  `useState` behind it, which `next build` compiles, a JSX parse accepts and
  every grep in this repo passes, because it only throws when React renders.
- `scripts/check-override.mjs` — a price you typed: what counts as one, that
  the recommendation is never edited, that the sticker gate lets yours through,
  and a grep over every path that spends money for a direct read of
  `finalPence`.
- `scripts/check-zeroprice.mjs` — a card nothing priced: that it is written as
  £0.00 rather than left blank, that the engine's own £2.49 floor is never
  confused with it, that a run carrying one cannot be listed or exported and
  the refusal names the cards, that a row the run never saw keeps its own
  price, and greps keeping the zero out of `packages/core` and the public page.
- `scripts/check-stackpos.mjs` — where a card physically is: that pulled and
  checked-out cards close the numbering up behind them, and a grep against a
  fourth copy of the rule.
- `scripts/check-labels.mjs` — the printer's file: the two columns in the
  printer's order, names cut to real label widths, and a workbook built for
  real and read back out of its own bytes.
- `scripts/check-instock.mjs` — whether a card is still ours to sell: that a
  listing at quantity zero is a card that has gone, that a missing quantity is
  not a zero, and a grep over the two screens that ask.
- `scripts/check-recent.mjs` — the cards you looked at: newest first, one row
  per card however it was spelled, capped, and junk from an older build
  dropped rather than drawn.
- `scripts/check-copyqueue.mjs` — one listing, several copies of the card: that
  the copy in the photograph is the copy that goes, that a quantity-2 order is
  two cards at two positions, and that running the reconcile twice does nothing
  the second time.
- `scripts/check-desksetup.mjs` — what the Show Desk says is still to run, and
  mostly what it refuses to say: a probe that fails on venue wifi is never
  reported as a missing migration.
- `scripts/check-deal.mjs` — the basket at the table: that an agreed lot price
  splits back over the cards and sums to the penny, that a card with no price
  cannot be sold, that a failed eBay call never rolls the money back, that a
  listing is ended once rather than hidden then ended, that a checkout already
  resolved elsewhere is refused rather than counted twice, and that a basket
  does not survive the night. Supabase and eBay are both faked.
- `scripts/check-livestream.mjs` — what may be said on a broadcast: that a lot
  is an allow-list carrying no SKU, cost or note; that a price the Show Desk
  would hold back from a sticker is never read out as a figure; that the figure
  is the engine's own rather than the sticker's laddered one; that the relay
  strips a figure off a held lot arriving with one; that four pictures come off
  the listing in the listing's order; and greps keeping the relay from ever
  building a lot itself or binding anything but loopback.

Every case in the first two is a real expansion code or a real sold-listing title. The
false-positive cases matter more than the true ones: each is something a draft
rule wrongly excluded, kept so a later "obvious" widening of a pattern fails
loudly instead of quietly costing good comps. **Run it before touching
`packages/core`.**

## The hero is a minimum, and a minimum has no robustness

Everywhere else on a card page a bad comp is absorbed: the price is a weighted
median and one stray moves it by pennies. **"Buy it today for" is the cheapest
live listing**, so the worst match in the set *is* the answer — in the largest
type on the page, with an affiliate link under it.

That shipped. Umbreon VMAX 215 Evolving Skies, 24 Aug 2026: eight sold comps,
median £837.48, last one £949.95, and a hero reading **£44.75** pointing at a
listing that was not the card.

Two leaks put it there, and both had to close:

- **`dropWrongNumerator` keeps a title with no collector number** — right for
  sold comps, where dropping them loses real evidence and the median absorbs
  the rest; wrong for a minimum, where the unnumbered stray wins by
  construction.
- **Cheap listings that *did* carry 215/203 still weren't the card** (£57.72,
  £85.56 against a £837 median). No amount of name and number matching catches
  those: a title is not evidence about the object.

`apps/public/lib/listings.js` owns both rules — a positive number match for
live listings, then a price floor at **a third** of what the card sells for.
The floor is nothing like the sold-side rule, which drops a low outlier at
median/12: a completed sale is evidence that somebody paid it, an asking price
is evidence of nothing, and the cheap tail of a chase card's listings is where
fakes and wrong printings collect. It only stands where it can — nothing under
£5, nothing on fewer than three comps, and if *every* listing is below it then
the floor is likelier wrong than every seller, so they show.

**The third is not yet measured against a corpus.** `probe-rules.mjs` and the
audit harness are how that gets done, and the number should move if the data
disagrees.

Nothing is dropped quietly: the count is handed back and the page says so.

## Card pages, crawlers, and the budget

`/card/<query>` is a client component that fetches on mount, so what left the
server used to be a spinner — no answer for a crawler on the one surface built
to be crawled, and a SoldComps request per uncached view against a URL space
where any string is a valid page.

The **published set** (`apps/public/lib/published-cards.js`, the 455 chase
cards) is the set we stand behind: server-rendered with a price, listed in the
sitemap, kept warm. `lib/card-page.js` reads the cached price on the server and
seeds the hook with it — **seeding `useState` rather than setting it in an
effect is the point**, since an effect runs in the browser, which was never the
problem. Anything else falls through to the client path unchanged.

**A crawler must never cost a SoldComps request.** `card-page.js` only READS
the cache. Filling it is the warmer's job.

**The buy module stays client-side.** Asking prices are two hours fresh at best
and a cache entry can be a month old, so a server-rendered "buy it today for"
would tag a listing that may have sold days ago.

**Three callers must build the same query string**, or every server-rendered
page misses the cache forever: `queryForCard()` in `lib/card-query.js` (not
`use-card.js` — that file is `"use client"` and the server can't import it) and
`cacheKeyFor()` in `lib/cache-key.js`. The failure is invisible — no wrong
price, just no price, while the warmer keeps writing entries nobody reads.

**The sitemap lists only cards that currently have a price**, because a thin
page submitted in bulk demotes the good ones with it. Card pages carry a
**canonical** to the published spelling: the same card is reachable under every
typo, and without one those compete with each other.

**A page is for the index only if it answers without JavaScript**, and
`cardPageDirectives()` is the one lookup that decides. Either we can name the
published page a URL is a spelling of — canonical, indexable — or we cannot,
and it gets `noindex, follow`. **Never both**: `noindex` beside a canonical
pointing elsewhere is the combination Google calls conflicting, and the
noindex can carry to the target, which here is a page we do stand behind.
Branching on one lookup makes that unrepresentable rather than merely avoided.

The unpublished side is unbounded — every typo, every long-tail card, and
since the grade rides in the URL, every "PSA 10 …" variant of all 455 — and
none of it server-renders anything, so a crawler gets the spinner. The sitemap
always refused to submit those; the pages themselves stayed indexable if found
any other way, which is the same split as robots.txt disagreeing with the
metadata. The **workings screen is never indexed on any card**, published or
not, for the same reason: it runs entirely on the client. A published card
that is not currently warm stays indexable — the test is the MANIFEST, not the
cache, so a Supabase blip can never noindex the site, and a cache gap on one
of the 455 is not worth spending a slow-to-undo signal on.

**A server component may render a client component; it may not CALL one.**
`gbp` lived in `app/ui.js`, which is `"use client"`, and both `/set/<slug>`
and `/sets` called it while rendering on the server. That throws at request
time — "Attempted to call gbp() from the server" — while building perfectly
clean, and it only reaches the call when a card HAS a price: a cold cache
renders a dash and never invokes it. So the page breaks when the DATA
arrives, not when the code ships, which is why a set page that had been live
for days went down without anyone touching it. The formatter now lives in
`lib/money.js`, ui.js re-exports it for the client screens, and
`check-clientboundary.mjs` greps every server file under `app/`.

**`/sets` is the only way to browse.** Set pages carried the internal linking
from the day they shipped, but it ran one way only: a card page linked up to
its set, and nothing pointed down. No page listed the sets, the home page
linked to none, and the routes in were a card page or the sitemap — so 92 sets
and 455 cards were unreachable to anyone who didn't already know a card in one.
The hub ranks sets by what their cards come to TOGETHER (`loadAllSets`, one
catalogue read and one chunked cache read for all 455, cached for an hour in
`app/sets/cached-sets.js` and shared with its share image). A set total is
written by `totalGbp` — whole pounds, grouped — because pence on a sum of
forty-eight medians are false precision and "£52341.00" can't be read at a
glance; card prices keep theirs. **Rendered on demand, not prerendered**: an
`export const revalidate` on a page with no dynamic segment makes Next build it
at BUILD time, which made `npm run build:public` demand Supabase credentials.

**Set pages are the internal linking, not just content.** `/set/<name>` lists
every card in a set by value, and each card page links up to its set and across
to six others. Before that, a card page's only outbound link was the home page:
450 URLs each at the end of a dead end, with the sitemap as their sole route
in, which is a poor way to get a site understood — Google leans on internal
links to judge what matters. "Most valuable cards in Prismatic Evolutions" also
carries volume an individual card page never will.

**The sibling window WRAPS from each card's own position**, which is the whole
point rather than a detail: taking the first six of a set would have all 48
Prismatic Evolutions cards linking to the same six pages, so six get every
internal link in the set and forty-two get none. `check-cardpage.mjs` asserts
that every card in a set receives one. The strip is rendered from the manifest
and carries no prices, so it costs no query on the hot path; the prices are on
the set page, one click away, which does the work once for the whole set.

**Indexing is gated on one flag.** `PUBLIC_ALLOW_INDEXING` controls robots.txt
and the pages' `noindex` from `lib/indexing.js`, and defaults to CLOSED — off
is the safe direction, since being wrong that way costs some indexing we didn't
get yet and being wrong the other way costs a domain migration. The condition
that mattered was the domain, and it is live: content indexed against a preview
hostname owes you a migration for pages that had just started to rank.
`NEXT_PUBLIC_SITE_URL` must name a host that actually resolves — a canonical
pointing at a dead host is worse than none, and it must match what Vercel
serves (www, not the apex, which redirects).

```
node scripts/build-cardpages.mjs            # rebuild the published set
node scripts/warm-cardpages.mjs --dry-run   # what needs warming, spends nothing
node scripts/warm-cardpages.mjs --limit 120 # warm the 120 stalest
```

Or **Actions → Warm card pages**. It also runs weekly, and that cadence is a
budget: Starter is 2,000 requests a month shared with live visitors, 455 cards
cost 455, so weekly-at-120 is one full cycle a month and leaves ~1,500 for
people actually using the site. **Raise the limit when the plan changes, not
before.**

## A slab is not the card underneath it

The engine excluded every graded comp, always, on the reasoning that a slab is
a different object at a different price. Right — and it never asked whether the
card *being priced* was one. So a PSA 10 was fetched with "PSA 10" in the
query, came back with a page of the right card in the right slab, and dropped
all of it. What survived was a proxy, a sleeve and a raw copy, and the card
priced at the **£2.49 floor** — while the graded panel on the same screen
showed the PSA 10 tier at £875, worked out from the comps the price had just
thrown away. Nothing on the row said any of it had happened.

`settings.subjectGrade` (from `subjectGradeFrom()`, one definition in
`packages/core/pricing.js`) is what the engine was missing, and the exclusion
**inverts** on it rather than standing down: pricing a slab, the raw copies go
as `rawCopy` and slabs of a different grade go as `otherGrade`.

- **Grades are kept apart; grading companies are pooled.** A PSA 10 goes for
  several times the same card in a PSA 8, so pooling grades swaps one confident
  wrong number for another. PSA over CGC is a real premium but nothing like
  that gap, and splitting on it as well empties most pools. Worth revisiting
  with a corpus; not worth guessing at.
- **Below `gradedMinComps` there is NO price, and never a fall back to the raw
  market.** That fall back is the original fault, and it is silent. The tiers
  still ride along on `rec.graded`, so the screen shows what was found.
- **The subject test is where the blast radius is.** A false positive on a comp
  costs one comp out of forty; one on the subject throws away every comp that
  *is* the card. Hence `NOT_GRADED_PATTERN` — "not graded", "non-graded", "raw"
  — and why `check-exclusions.mjs` pins ACE SPEC, TAG TEAM and "pristine
  condition" as raw a second time on the subject side.
- **Sellers copy the slab's own label**, so "PSA GEM MINT 10" and "PSA NM-MT 8"
  are graded — the label words may sit between the company and the number, and
  the first version read those titles as raw, excluding the best comps on a
  slab's own search as `rawCopy`. Company name required: a companyless "Gem
  Mint 10/10" is a raw card being praised (335 corpus hits, mostly raw), and
  "tag"/"ace" still need the digit directly or "…TAG TEAM Mint 9/10" and One
  Piece's "…Ace Mint 9/10" read as slabs.
- **It costs nothing upstream.** `queryForCard()` is unchanged, so a graded and
  a raw search share one cache entry and one SoldComps call; only the filtering
  differs. On the public page the grade is read from what the visitor TYPED
  (`card.asked`), never from `card.q` — `q` is the canonical string the cache
  key hashes, with the grade already stripped out of it.
- **On the public page the ask rides in the URL**, and `apps/public/lib/
  grade-ask.js` owns it. `asked` covered exactly one of the six routes into a
  card page — free text plus Enter — while the dropdown and the which-one
  picker navigated to the bare canonical string, so tapping the card you meant
  silently swapped "what's the slab worth" for the raw price. `carryGrade()`
  prefixes the normalised ask onto the canonical query ("PSA 10 Umbreon VMAX
  215/203 …"), `stripAsk()` recovers the canonical string for the resolver,
  the handoff guard and the recents dedupe, and `parseQuery()` strips the
  grade before parsing — without that, "PSA 10 Umbreon VMAX 215" parsed as a
  card *named PSA, number 10*. In the URL rather than the handoff because the
  URL survives a reload, a share and the Back button; a handoff is deleted on
  read. A recents row replays the latest ask, still one row per card.

**On the Show Desk a graded sticker starts from what we already ask on eBay**,
rounded to the pound (`stickerRows`, `listed`). The only place a listing price
leads rather than sits beside the suggestion, and scoped to slabs on purpose:
slab sales are thin enough that plenty of cards have none at their grade in
ninety days, and the listing price is a decision already made about that exact
copy with the grade on the label. A raw card is untouched by it — the ladder
and the gate are right there. The sticker box still beats both, and every row
says which of the three it is.

## Measure before adding a pricing rule

The audit harness exists so a rule is judged on data rather than on the two
examples that prompted it. Twice now that has reversed a decision that looked
obvious: "read description" appeared on two £9.99 fakes and turned out to be
ordinary seller language on genuine full-price sales, and a symmetric price
outlier at 8x removes real played copies (which is why the low side sits at
median/12 with a cluster guard).

```
node scripts/build-bigset.mjs                 # English-only chase cards from the catalogue
node scripts/audit-big.mjs --json out.json    # price them all, from apps/public
node scripts/diff-runs.mjs before.json after.json   # per-card, flags LOST prices
node scripts/inspect-spans.mjs "Card 123 Set"       # read the comps behind one price
CORPUS_OUT=corpus.json node scripts/probe-rules.mjs # dump every title, test a regex offline
```

Sold comps cache for 24 hours, so re-running straight after an audit is free
and touches nothing at SoldComps.

## Where the pricing is trustworthy, measured

`scripts/wideset.json` is 371 cards built to be everything the chase-card set
is not — cheap Pokémon commons, trainers, energy, Yu-Gi-Oh and Magic. What it
found, on 2026-08-22:

| population | priced | median comps | wide spans |
|---|---|---|---|
| Pokémon chase (the 455-card set) | 100% | 15+ | 6 of 294 |
| Pokémon trainers | 69/77 | 15 | — |
| Pokémon commons | 188/201 | 5 | — |
| Yu-Gi-Oh | 44/60 | 8 | **14** |
| Magic | 26/33 | 4 | 3 |

**Decided 2026-08-22: the public page is Pokémon-only.** `/api/resolve` and
`/api/suggest` filter on `game = 'pokemon'`, and the copy says so. The engine
is unchanged — `packages/core` still prices any game, and the app still uses
it for all of them.

**Pokémon is reliable; the other games are not, and it isn't a bug.** The whole
engine is anchored on the collector number, which is what separates one
printing from another. Yu-Gi-Oh and Magic sellers mostly don't write it — 33
of 60 Yu-Gi-Oh cards priced only via the name-only fallback — so the tool
pools every printing of a card and reports a number with a 15–50x span. Giant
Growth came back as £5.59 from 30 comps spanning £0.99 to £19.84.

Both caveats fire on those cards ("matched on the card name alone", "matched
very different cards"), but a confident-looking number built on pooled
printings is worse than no answer — hence the scoping above. Lifting it means
giving those games set-anchored matching of their own, not just removing the
filter.

## Liquidity is read off one boolean — get it from the API

The band on the page ("Sells fast", "Slow mover") hangs almost entirely on
whether the result set was CAPPED. SoldComps returns one page of sales,
newest first, so for a fast card the window isn't 90 days — it's however long
those sales took.

Two things were wrong about that until 2026-08-23, and both were invisible
because the harness and the page each had their own copy of the logic:

- **The page guessed the cap from the comp count** (`comps.length >= 39`),
  because `price()` threw `hasNextPage` away. Measured over 40 cards, the guess
  is wrong on 21: when SoldComps says there is more it has returned between 35
  and 40 items, so 39 misses real caps, and nine sets of 39–55 items weren't
  capped at all. Two other harnesses passed no flag and read every fast card
  as slow. `assessLiquidity()` in `apps/public/lib/liquidity.js` is now the
  only definition, used by the page and all four audits.
- **The rate was measured over the span of the SURVIVING comps.** The cap
  truncates the *search*, not the card: a Xerneas keeps 3 sales out of 40
  listings, and those three sit 3 days apart inside a page reaching back 58
  days. That read as "Sells fast, 7 a week" for a card selling once every
  three weeks. The window page one actually supports is **[oldest listing on
  the page, now]** — complete data for that card over that period — which is
  what `visibleDays` passes to `assess()`. It moved 10 of 25 capped cards,
  in both directions.

`node scripts/audit-liquidity.mjs --n 40` scores all five policies side by
side against live data, and re-running it inside 24 hours is free.

**Cheap commons are thin for a different reason: the data isn't there.** Of 40
comps for a Weedle, almost none are single-card sales — eBay's market for a 1p
common is "Choose Your Card" pick-lists, correctly excluded. No rule change
conjures sold data that doesn't exist.

## Card images

The catalogue is Cardmarket-derived and has no art of its own, so image URLs
are matched in and stored on `card_catalog` (migration 022), never fetched
inside a visitor's request. Two reasons: a public page shouldn't depend on a
third party being up — pokemontcg.io spent an hour returning 500 to every call
on 2026-08-23, and did it again on 2026-08-26 — and we store links, not copies,
so the artwork stays The Pokémon Company's problem to license rather than ours
to redistribute.

```
node scripts/probe-images.mjs                       # measure coverage, writes nothing
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  node scripts/backfill-images.mjs --dry-run        # then without, to write
node scripts/backfill-images.mjs --refill           # retry every card that still has none
```

**`--refill` is the mode to run after a source is added or a rule changes.**
The default run is resumable — every row it looks at gets `image_checked_at`,
so the next run skips it — which means a rule that would now find art for a row
never gets the chance. `--refill` retries every row that still has no picture
and touches nothing else. `--recheck` re-asks about all 32,365 and is only
worth it if a source is suspected of having given a WRONG picture.

Or from the browser, with no checkout: **Actions → Backfill card images → Run
workflow** (`.github/workflows/backfill-images.yml`), which has `--refill` and
`--recheck` as tickboxes. Manual trigger only — it holds the service-role key,
so it never runs off a push. Needs the repository secrets
`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, and migration 022
applied first.

Backfilled 2026-08-23, tcgdex only: **21,162 of 32,365 English rows have art
(65%)** — the figure to beat once the second source below has been run in. That
whole-catalogue figure is dominated by things nobody prices here — sealed
products, World Championship decks, Play! Prize Packs and Japanese-named sets
tcgdex doesn't index. On the cards people actually search it is **84%, and 90%
of the chase set**. Non-English rows are skipped: tcgdex has them, but under
Japanese set names, which needs a name map we don't have.

Getting there took four rounds, and 52% of it was matching bugs rather than
missing data:

| fixed | worth |
|---|---|
| Cardmarket prefixes the 2003-07 era "EX Unseen Forces"; tcgdex doesn't | ~2,000 |
| Promos are numbered `SWSH001` there, bare numbers here | ~1,100 |
| `Dialga Lv.68`/`Dialga`, `Espeon Gold Star`/`Espeon ☆`, `Nidoran [M]`/`Nidoran♂` | ~1,300 |

A fourth spelling turned up on 2026-08-26: tcgdex writes most Gold Stars as
`Espeon ☆` but the five Holon-era ones as `Pikachu Star`, where Cardmarket
spells "Gold Star" throughout. A **trailing** bare "star" is that marker and
nothing else — the word only ever appears mid-name otherwise ("Team Star
Grunt", "Star Piece"), and VSTAR carries no word boundary before it, so
Charizard VSTAR is untouched. All five are chase cards.

**Two hazards the tests caught before they shipped**, both in the name guard:
it was folding Charizard, Charizard ex, Charizard V and Charizard LV.X into one
card, and the first fix for that merged Nidoran♂ with Nidoran♀. A suffix is
only ever accepted in one direction — ours carrying `LV.X` where tcgdex writes
the base name is the same card; theirs carrying `V` where ours doesn't is not.

**The match is set + collector number; the card NAME is a guard on the result,
never part of the key.** A missing picture is a gap; a picture of the wrong
card is a lie about what's being priced, and it's the most confident-looking
thing on the page. Two rules earn their place, both in `scripts/lib/card-images.mjs`:

- **Sub-sets are a whitelist**, not "any set name that extends another".
  Cardmarket keeps the Trainer Gallery, Galarian Gallery and Shiny Vault inside
  their parent with a TG/GG/SV number prefix; tcgdex splits them out. The naive
  rule also merges Base Set 2 into Base Set, Dragon Frontiers into Dragon, Team
  Rocket Returns into Team Rocket and eight XY Trainer Kits into XY. The tests
  caught it.
- **Zero-padding comes off after the letter prefix.** SV001, SV01 and SV1 are
  one card; SV1 and SV10 are not.

## Two sources, and the second one is where the chase cards were

tcgdex is asked first and answers for most of the catalogue. Its gaps are not
scattered, which is why "some images are missing" read on the site as *the
expensive ones* missing — measured 2026-08-26, tcgdex holds no art at all for
Shining Fates Shiny Vault (122 cards), Crown Zenith Galarian Gallery (70), all
four Trainer Galleries (120), Shining Legends (78), Dragon Majesty (78),
Aquapolis and Skyridge (72), and ~190 SM/SVP/MEP promos. 1,717 English cards.
A Trainer Gallery card *is* a chase card.

pokemontcg.io has every one of them, and is second rather than first because it
is the less reliable of the two — 30 calls a minute keyless, and it was down
entirely partway through this work. Second is where that belongs: it is asked
only about cards tcgdex had no art for, it is never on a request path, and its
"small" is a 180KB PNG against tcgdex's 35KB WEBP. `POKEMONTCG_API_KEY` lifts
its rate limit and the pacing with it; it is optional.

**A source that cannot answer must never look like a source that answered with
nothing.** Both return `null` for a failed call, and a row whose sources all
failed is left unwritten — no `image_checked_at` — so the next run tries again
rather than recording a gap that isn't one and then skipping it forever.

`lib/image-sources.mjs` is the only file that names either API host, and
`check-images.mjs` greps to keep it that way. The probe had already drifted
once: it looked our set names up EXACTLY where the backfill used `setFamily()`,
so every "EX Unseen Forces" came back as a set tcgdex has never heard of and
about a thousand cards were reported missing that were never missing. Both now
run through the same module in the same order, so what the probe reports is
what a backfill would write.

On the 455 published cards: **423 with tcgdex alone, 438 with both.** The 17
still without art are World Championship decks, Play! Prize Pack reprints and a
few one-off promos, which neither index holds.

## Last Comp: the public page's design system

Dark only, three fonts, four screens. `apps/public/app/globals.css` holds the
tokens; there is no light palette to fall back to, so nothing is behind a
`prefers-color-scheme` query.

- **Archivo at width 125%** for anything that shouts — headings, brand, labels,
  buttons, verdicts — always uppercase. The width axis is the identity, which
  is why `layout.js` asks next/font for `weight: "variable"` and `axes:
  ["wdth"]`: request fixed weights instead and next/font refuses the axis, the
  build still passes, and every heading quietly renders at normal width.
- **Martian Mono** for exactly two figures a screen (the buy-it-today price and
  the sells-for figure) and nothing else.
- **IBM Plex Mono** for rows, dates and inputs; **IBM Plex Sans** for prose.

Fonts are self-hosted through `next/font`, not linked to Google.

**The splash and the iOS launch image are one picture.** iOS draws a static PNG
before any of our code runs, and the splash animation continues from exactly
that state — so `lib/splash-frame.js` holds the geometry as numbers and both
`app/Splash.js` and `app/launch-image/route.js` are generated from it. Hand-
matching them is how the handoff becomes a visible jump. Frame one is
deliberately complete-looking on its own (wordmark all white, flat grey rule,
no holo, no tagline), because a slow network leaves the visitor sitting on it.

Two things learned building it. The launch image needs a real Archivo file —
`apps/public/assets/Archivo-Expanded-800.ttf`, read off disk and force-traced
via `outputFileTracingIncludes`, because `fetch(new URL(…, import.meta.url))`
resolves to a static asset path the bundler can't fetch at build time. And the
mock's teal bloom is absent from BOTH sides: Satori renders no radial gradient
at any syntax tried, and a bloom in the DOM against a flat PNG is exactly the
jump this file exists to prevent.

Startup images go through `metadata.appleWebApp.startupImage`, not a
hand-written `<head>` — the App Router hoists metadata and a `<head>` in the
root layout renders nothing.

```
/                        search
/sets                    every set, by what its cards come to together
/changelog               what changed, and what was wrong
/card/[q]                which one? when ambiguous, otherwise the answer
/card/[q]?days=30        the same answer over a shorter sold window
/card/[q]/workings       every sale counted, every sale excluded, net after fees
/card/[q]/share.png      the answer as a 1200x630 PNG — POST any card, GET published
```

**The answer screen carries the mark, because it is the screen people
screenshot.** Price guidance gets given by snipping a rectangle of this site
into a thread, and the one screen most likely to be passed around was the one
screen with no brand on it. `Crumb` now ends with a horizontal `<Wordmark
inline />` — the same two-tone, on one line, because the stacked lockup would
double the height of a single-row bar. In that row the card NAME is the only
thing allowed to shrink: it is already on screen in larger type just below,
and a narrow phone pushing the mark off would undo the point of putting it
there.

**`share.png` answers to both methods, and the split is the point.** POST is
the Save-image button: the figures arrive in the body from the client that
already has them, so it works for EVERY card — including the one someone needs
to price for a customer, which usually isn't one of the 455. It costs nothing
upstream and there is nothing on it to scrape, because it renders what you
hand it. GET is the OpenGraph image, and it can only be the published set,
because a crawler hands us nothing and the only other source is the cache.
That is the right limit rather than a sad one: published cards are the ones
whose links get posted. **The GET reads the cache and never fills it** — the
same rule as `card-page.js` — and it 404s rather than throwing, because an
unfurler caches a 500 and the link then stays plain long after Supabase
recovers.

**Both methods draw through one `image()`.** Two renderers would eventually
disagree about which one is the shareable card; `check-share.mjs` counts the
`ImageResponse` calls. GET takes its headline from `priceCard`, the same
function the answer screen's figure comes from, so an unfurl and the page
cannot quote different numbers.

**A set page unfurls as its leaderboard.** `/set/<slug>/share.png` draws the
five dearest cards with their prices, dated, on the same 1200x630 ground as the
card image — because the set pages are the ones with search volume behind them
and the ones people actually post, and they were going out as a bare link.
GET only, unlike the card image: a set is always one of ours and its prices are
always already cached, so there is nothing for a caller to hand us. **No card
art on it**, deliberately — five remote fetches on a route unfurlers hammer,
each a chance to time out or return a WEBP Satori can't draw, for pictures at
postage-stamp size beside the numbers people came for. It reads through
`loadSetCards` (one catalogue read, one cache read, no SoldComps) and 404s —
never throws — including when nothing in the set is priced yet.

**A card page only claims an OG image it can actually draw.** `ogImageFor()`
gates on `findPublished` — a manifest lookup, free on a page render — and an
unpublished card falls back to `twitter:card=summary` rather than
`summary_large_image`, which would unfurl as a broken box.

**The catalogue's art is WEBP and Satori cannot draw it.** `image_small` is
`<card>/low.webp` (`scripts/lib/card-images.mjs`), which is right for the page
— a browser decodes WEBP without blinking — and took the Save-image button
down on every card that had art. Two things made it hard to see: it built
clean and passed a hand-written local test that used a `high.png` URL, and
Satori raises while PIPING the response rather than when `ImageResponse` is
constructed, so it surfaced as Next's own 500 page with nothing in it and no
try/catch of ours could reach it. `drawableArt()` swaps in the `high.png`
sibling, the content-type check is an ALLOW-LIST (`startsWith("image/")` is
what let it through), and the render is buffered so a draw failure falls back
to the image without art instead of killing the connection.

**The share sheet is for phones, and `canShare` does not tell you that.**
Chrome and Edge on Windows implement Web Share with files, so gating on
`navigator.canShare({files})` opened the Windows share dialog on a desktop
click — and the only route from there to a pasteable image was the snipping
tool the button exists to replace. `ShareButton` decides on `(pointer:
coarse)`: a phone gets the share sheet, everything else gets a download plus a
Copy button where the clipboard takes images. The clipboard is handed a
PROMISE inside the click, not an awaited blob, because Safari requires the
`ClipboardItem` be constructed within the gesture.

**Nothing on that image is an asking price.** "Buy it today for" is the
headline everywhere else and is forbidden here for the same reason it is never
server-rendered — except worse, because a PNG pasted into a Facebook group is
still being quoted in March while the listing sold in August. Sold figures are
facts about things that already happened. The image is also always DATED, for
the same reason. `check-share.mjs` greps for both.

**A graded ask is on the image, bound to the figure.** A slab's price is
several times the raw card's, so "Umbreon VMAX sells for £875" with the PSA 10
left off is the site misquoting itself under its own brand. The label over the
figure carries it ("PSA 10 slab sells for"), derived server-side from the
query the payload already sends via `gradeAskFrom` — never free text off the
body, or anyone could draw their own words onto a branded, dated price card.
`check-share.mjs` pins both halves.


**The cards you looked at are yours, and they stay on your device.**
`lib/recent-searches.js` owns the list behind the **Recent** button on the
search screen — localStorage, capped at eight, deduped on `normaliseQuery` so
one card can't sit in it twice under two spellings. It is recorded on the CARD
screen rather than at the search box, because the box is one of six ways in:
the dropdown, a typed query, a chip, a set page, a sibling link, a pasted URL.
Only a card that actually resolved is recorded — a search that failed is not
somewhere to send someone back to. `check-recent.mjs` pins the order, the cap,
the dedupe and that junk from an older build is dropped rather than drawn.

It is a different thing from `card-handoff.js` and deliberately not a mode on
it: a handoff is one card, carried across one navigation and deleted on read,
so it can never answer for a card nobody asked for. This is a list, kept. A
recents row still leaves a handoff on its way out, so coming back to a card
costs no resolve.

**The splash shows once a SESSION, and an installed app is not an exception.**
It used to skip that check when running standalone, reasoning that a
home-screen launch should always splash — which it still does, because a launch
starts a new session. What it also did was replay on every full page load
inside the app, so coming back from a card played the whole animation again.
iOS draws its launch PNG on a launch and not on a navigation, so that one had
nothing behind it to continue from. The back arrow and the wordmark are
`next/link` for the same reason: a full document load to leave a card is a
round trip and a splash where neither was wanted.

Both card screens run off `lib/use-card.js`. That is deliberate: the workings
exist to show the arithmetic behind the answer, and a second fetching path
would eventually have them explaining a different number than the one on the
previous screen.

**The sold window is in the URL, not in component state**, for the same
reason. `lib/windows.js` owns the list (30 and 90), and `/api/price` validates
against that same list rather than its own copy — an arbitrary number would
fragment the cache into near-duplicate entries that each cost a fresh API call.
Ninety is the default and is left out of the URL, so the ordinary link stays
the shareable one it has always been. A `days` state on the answer screen
renders identically and quietly leaves the workings explaining the 90-day
figure; `check-windows.mjs` fails on it.

**The answer screen waits on the sold comps, never on the live listings.**
Cold, a card was resolve 1.0s → sold 5.2s → active 7.7s, one after the other:
about fourteen seconds before anything appeared. The two price calls are now
started together and the screen renders as soon as the sold set lands, with the
buy-it-today figure filling in behind a "checking what's listed right now…"
line. Sold data is the answer; what is listed this minute is the upsell, and it
is the slower of the two. Roughly six seconds cold, and nothing on a cache hit.

**What the answer screen shows beyond the price.** All of it was already
computed and thrown away: the last comp (`sales[0]` — the product is named
after it), the graded tiers from `gradedBreakdown()`, and the daily-median
trend chart. Graded rows are a reference table, deliberately quieter than the
headline, because a slab is a different market and none of those sales feed the
price above.

**The changelog is written by hand, and the fixes matter more than the
features.** `lib/changelog.js` is prose for visitors, not generated from
commits — the messages in this repo are internal reasoning and a visitor should
not have to decode them. An entry earns its place by being something someone
using the site would notice; if you cannot write it without naming a file, it
is not an entry. The £44.75 entry is the most valuable one there precisely
because it is embarrassing: a site whose proposition is that it shows its
working cannot run a changelog that only lists new things. And a changelog that
stops being updated says the project is abandoned, louder than never having had
one — so keep entries cheap to add and only add them when something visible
ships.

**Anything quoting a constant must be generated from it.** The workings screen
prints "Based on £200.01 at 13.25% fees, 30p fixed, plus £1.35 postage" under a
net figure, and both come from `FEE_RATE`/`FEE_FIXED_PENCE` in `lib/verdict.js`.
The design prototype shipped a hardcoded version of that caption once and it
disagreed with the figure above it.

**The sale notes on the workings screen are derived, never invented.**
`lib/sale-note.js` reads condition wording, holo, postage and the seller's own
condition field out of the listing. The mock also shows "sold at auction",
"14 bids" and "private seller"; SoldComps returns none of those, so they are
absent rather than guessed.

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

## A card we could not price is £0.00, and £0.00 stops the run leaving

The engine returns `finalPence: null` for a card it cannot price — a SoldComps
timeout, comps that were all excluded, a slab below `gradedMinComps`. That is
the honest answer and the public page needs it. What the **app** used to do
with it was the problem: the eBay upload export left a row it had no price for
exactly as it found it, and a CardUploader CSV arrives with a placeholder
`*StartPrice` on every row — **£2.49, the same figure as the engine's own
floor**. So a card nothing had checked went up at £2.49, looking on every
screen and in the file identical to a card the engine had genuinely priced at
its floor. A £40 card can leave that way and the only evidence is a row that
read as blank on a screen nobody re-read.

`apps/app/lib/zero-price.js` owns the fix, and the two halves only work as a
pair — a zero that can be exported is just a different wrong number in the
file, and a guard with no zero behind it is a warning about nothing.

- **No price is written as ZERO, not as blank.** A dash is what the eye skips:
  it says "nothing to report here", which is the opposite of the truth on a row
  nothing has priced. £0.00 is not a cheap card, cannot be read as one, and
  eBay itself refuses to list at it. The poison value is the point.
  `exportPence()` is the one place it comes from, so a caller cannot pick its
  own fallback and teach one export the rule while the next stays quiet.
- **Nothing that spends money leaves while a zero is in the run.**
  `exportGuard()` refuses the eBay upload CSV and the bulk lister, and it
  **names the cards** — three of them, then a count — because a refusal you
  have to go hunting behind is one that gets ignored. A hard stop rather than a
  warning: the whole class of fault here is something that was on screen and
  did not get read.
- **The bulk lister used to filter the unpriced rows out and say nothing**,
  which is the same silence in a different shape — you list 87 of 89 cards and
  find the other two weeks later. It refuses the whole run now.
- **The diagnostic exports still go.** Export CSV and Download this run carry
  the zeros rather than being blocked: they are how you SEE which cards are
  wrong, and blocking the sheet that shows the problem is the one thing that
  makes the problem harder to fix. Both write `0.00` in the price column, so
  they and the upload file agree about what a card nothing priced is worth.
- **A row this run never saw keeps its original price.** Only rows that were
  IN the run and came back without one are zeroed — the run has no opinion
  about a card that wasn't in it, and overwriting those would be the same
  quiet damage in the other direction.
- **`effectivePence()` still returns null, and `packages/core` is untouched.**
  Every caller counting priced cards or holding a sticker back depends on
  null; a zero leaking in there would read as a card priced at nothing rather
  than a card not priced. And the public page must never render "£0.00" — that
  is Last Comp quoting a stranger a price it does not hold.
  `check-zeroprice.mjs` greps both boundaries.

**The way out of a zero is the override.** Type a price and the row is priced,
the guard clears, the review queue lets it go — that path was already built and
this rule is what makes you use it. `parseOverridePence` refuses `0`, so a zero
can only ever mean "nothing priced this".

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
- **The desk says what is still to run when it OPENS**, not when you press
  save. Migration 024 used to announce itself by refusing a sticker price with
  the card in your hand and a customer waiting — the one moment nothing can be
  done about it. `apps/app/lib/desk-setup.js` asks three cheap questions after
  the desk has rendered (never before: on venue wifi that ordering is the
  difference between a warning and an obstacle), and says what each pending
  migration costs you today rather than naming a database object. **A probe
  that fails is not a missing migration** — a dropped connection, a timeout, an
  RLS refusal all read as UNKNOWN and say nothing, because the person reading it
  is at a show and cannot check. Never rendered in counter mode: a filename and
  "one-off setup needed" read to a customer like a till about to go down.
  `scripts/check-migrations.mjs` is the whole-database version and is right for
  a terminal; twenty round trips to report on the price guide is not what
  anybody wants at a table.
- **Migration 024** adds `sticker_pence` to `stock_checkouts` and `pool_name`
  to `price_batches`. `pool_name` is read and written OPTIONALLY: migrations
  here are applied by hand, so the code always ships first, and Postgres
  rejects a whole statement that names a missing column — a required one would
  take out the saved-runs list and every save with it, show-related or not.

## What a bulk action acts on is what you can see

The away list is the show stock list, and it was one flat list in the order you
happened to pack it — fine for a dozen cards, useless for two hundred with a
customer holding one up at the table. `apps/app/lib/showfilter.js` is the
search box, the sort and the filters over it: SKU, card name, event and stack
searched together with tokens AND-ed and order-free, so "215 umbreon" and
"umbreon 215" land on the same row, and both sides flattened through one
`normalise()` so "pokemon" finds "Pokémon" and "215/203" finds the number as it
is written on the card.

**`selectionFor()` is why the file exists.** The desk's convention is that
ticking nothing means "all of them", which was unambiguous while the list
showed everything: search "sunday", press ↩ Return to spots, and Saturday's two
hundred cards get filed too — silently, because the rows that moved were never
rendered. So "all" means all of what is on screen, a ticked row the search has
since hidden is not acted on either (it keeps its tick and comes back with it),
and every count on the buttons comes from that one function.
`check-showfilter.mjs` pins it, along with a grep against the old inline
convention coming back.

Two smaller rules worth keeping. **A card with no sticker sorts last in both
price directions** — treating it as £0 would head the cheapest-first list with
the cards that have no price at all, which is the opposite of what that view is
for. And **the event and stack dropdowns are built from the rows themselves**,
so an option that filters to nothing can't be offered; they don't appear at all
until there is more than one to choose between.

The row chip and the "still sellable online" filter both read `listingState()`
— a filter that finds three cards the chips call hidden is the kind of
disagreement nobody notices until one of them sells twice.

## The list turned round to face a customer

Tested at a show on 2026-08-29 before any of it was built: someone asked *"do
you have any gengars"*, the Show Desk was searched in front of them, and cards
sold that were in a box under the table. **What that proved is not that the
software works — it is that stock nobody can see converts the moment somebody
can see it.** Table space is the cap, and the Show Desk was already the way
round it.

What it also showed is that the desk is dressed for us. Counter mode
(`apps/app/lib/showcounter.js`) is the same list, the same search and the same
sort, projected.

- **The projection is an ALLOW-LIST, not a tidy-up.** `counterRow()` builds a
  new object key by key; it never spreads the checkout row and deletes the
  private parts. The leak worth designing against is not one anybody would
  write — it is the column added to `stock_checkouts` a year from now for an
  unrelated reason, appearing on a tablet pointed at a customer. Built the
  allow-list way that is unrepresentable; built the other way it is invisible
  until it happens. `check-showcounter.mjs` stuffs a row with private values
  and searches the serialised result for every one of them.
- **What was on screen that shouldn't be**, and why each matters: the **SKU**
  is a stack name plus a position, so it tells a stranger how deep the stock
  runs; **"still live on eBay"** says out loud that the card is listed, which
  invites a price-check against the sticker in front of them; and **`£ Sold`
  and `↩ Return`** are one mis-tap from a customer holding the tablet.
- **Counter mode REMOVES the desk rather than restyling it.** The checkout
  form, the bulk bar, the recommendations and the recent activity are not
  rendered at all. A customer can scroll, and an off-palette destructive button
  is still a button.
- **A held price says "Ask at the table".** `stickerFor()` withholds a price on
  low or no confidence, and on prices built from active listings. Facing a
  customer a blank reads as free, and the eBay figure is wrong by ~13.25% of
  fees plus £1.35 of postage a table sale never pays.
- **The picture is a photo of THIS copy** (`ebay_listings.image_url`), never
  catalogue art. Cards checked out by ENDING their listing have none, and a gap
  is fine: catalogue art would show a mint scan of a played card to the person
  holding that card. **Tapping it opens the same photo large**, which is a
  string swap on eBay's CDN filename (`s-l140` → `s-l1600` in `largeImage()`)
  rather than a fetch: a route costing an API call per row on screen is one
  nobody can use on venue wifi. Only the GALLERY shot is stored, so that is the
  one picture available — the full set would need a `GetItem` call per listing.
- **Condition is its own field, not part of the name.** It is the fact a
  customer can't check for themselves: they can see a card in the box, and they
  cannot see one that is online. It could never have ridden inside the name
  anyway, since `labelName()` cuts a title at the collector number and the
  grade is written after it. `conditionOf()` reads the TITLE first and eBay's
  `ConditionDisplayName` second — the opposite of what the authoritative-looking
  field suggests, because on a TCG single the seller types "NM" in the title and
  leaves the dropdown on "Ungraded", which is why those generic values are
  dropped rather than shown. The reading itself is `packages/core`'s
  `inferCondition()`, not a third copy: the pricing engine splits its comps on
  exactly that, and a counter disagreeing about what "NM" means would be a
  second opinion nobody asked for.
- **One search, two screens.** Both go through `showView()`, so what a customer
  finds and what you find are the same set — a search that answers differently
  sends you to a card they cannot see, or promises one that is not in the box.
- **The eBay stock is a SECOND list, under its own heading, never merged.**
  `onlineMatches()` answers a search with cards we have listed online and don't
  have checked out. Merged into the list above, a card that might be at home
  becomes indistinguishable from one you can hand over, and the top list is the
  only one anybody can act on.
- **It says "ask", not "not here", and that wording is load-bearing.** Not
  everything that travels to a show gets checked out, so a card can be in the
  box and missing from the checked-out list — and telling a customer we haven't
  got it, while it sits in the box, loses a sale already made. What the data
  knows is that we own one; whether it is in the room is a question for the
  person at the table. `check-showcounter.mjs` greps the copy for both halves.
- **Where it is, on a tap and never before one.** An online row carries a
  reveal that resolves the card's live stack position (`locationsBySku()` in
  `stackpos.js`, so it is the same rule as everywhere else: pulled and
  checked-out cards close the numbering up, and a card with no honest number
  gets no entry). It is the one piece of desk data allowed on this screen, and
  it is looked up from state the desk already holds rather than carried on the
  row — putting the SKU on the projection to make the tap easier is exactly the
  shortcut the check refuses. Note the position of an un-checked-out card is
  where it lives at HOME, which is right only if its stack travelled.
- **Only ever on a search, capped, dearest first.** The box is a hundred-odd
  cards and the listings are thousands: unsearched, the second list buries the
  first. A sold card is still a row in `ebay_listings`, so it goes through
  `isListingAvailable()` — and a missing quantity is silence, not a zero, or
  real stock is hidden. The eBay price shows as it stands, which is the right
  number for a card that would be posted.

**This is the projection the public storefront needs.** See
`docs/SHOW_STOREFRONT.md`: an anonymous route serves exactly this shape and
nothing else, so the hard part is settled here, on a tablet in your own hands,
where you can see what a customer sees. Two projections would eventually
disagree about what is private, and the one that disagrees quietly is the one
on the internet.

## The binder is the other way of showing the same stock

Counter mode is a LIST — a row each, name and price, read at arm's length.
That is the right shape for answering "do you have any gengars" and the wrong
shape for what people actually do at a table, which is flip through a binder
and point at what they like. `apps/app/lib/binder.js` is the same show stock
laid out nine to a page in card pockets, and it is a third mode on the Show
Desk rather than a replacement for either of the other two.

- **A page is nine pockets, always.** A real binder page is 3x3, and a fixed
  count is what makes a page NUMBER mean anything: "it's on page four" has to
  be true on the phone in your pocket and the tablet on the table. The last
  page is padded with empty pockets rather than reflowing — a page that
  resized to fit three cards would move the one somebody was about to point at
  as you turned onto it. And a page has to FIT on the screen, which is what
  the width cap on `.bn-wrap` is for: nine pockets you have to scroll past is
  a list with a frame drawn round it.
- **A wide screen opens the binder; it does not repaginate it.** From 900px
  the two halves are on screen at once, because a single column of nine down
  the middle of a 1400px panel reads as sparse. `binderSpreads()` pairs
  ADJACENT pages for display and nothing else — the flattened spreads are
  always `0..n-1` in order, and `check-binder.mjs` pins that, because the
  moment a page number depends on the window width the "it's on page four"
  promise is gone. **A spread never straddles the two sections**: a box page
  facing an online page is the merge the whole design refuses, and worse than
  the list version because the reader cannot tell which side the header is
  talking about, so a section's last spread sits alone with a blank facing
  page. Padding the pagination to avoid that would have renumbered every
  later page on wide screens only.
- **The frame does some work.** A cover with the app's own `--holo` foil on
  its top edge, sheets sitting on it with a gutter shadow curving into the
  spine, the binding down the left of a single page and up the middle of an
  open one, a page number in each outer corner, and a sleeve sheen on every
  pocket. All CSS, no images. A grid of pictures is a grid of pictures; the
  frame is what makes somebody hold it like a binder instead of reading it
  like a table.
- **On a phone the name gets THREE lines, and that is the rule not the
  exception.** A pocket there is ~85px across, which will not hold "Umbreon
  VMAX 215/203" in two — and a CSS clamp cuts the END, so what gets lost is
  "215/203". That is backwards: `labelName()` exists because a long name loses
  its NAME before it loses its NUMBER. A third line is cheaper than breaking
  that, and the height stays fixed so the grid is still a grid.
- **The eBay stock is in it, and it gets its own pages.** Table space is the
  cap the binder exists to lift, and what is at home is the bigger half of it,
  so the binder shows both by default — box first — with a scope dropdown to
  narrow to either. The counter list's never-merge rule holds: a card that
  might be at home is not one you can put in somebody's hand. A binder has no
  room for the list's heading-and-rule, so **the rule is carried by the PAGE**
  — each section is paginated on its own and the pages concatenated, which
  makes a mixed page unrepresentable rather than merely avoided. The page
  header names the section and the pocket's corner badge says `ask`, because a
  pocket seen on its own has no header above it. A card in the box AND still
  listed appears once, in the box, since the box is the one you can act on;
  the same card in both sections never folds into one pocket, because "×4"
  would then count cards that are not in the room.
- **One card, one pocket.** Four copies of the same Gengar are four rows on
  the desk — four physical cards in four stack positions, and the desk is
  right to list them. A customer flipping past the same card four times is
  reading a duplicate. The copies are folded in, not thrown away: the pocket
  says `×4`, the preview lists every copy with its own condition and price,
  and the count of what got folded is on screen beside the page number.
  Nothing is dropped quietly here either.
- **The headline price is the CHEAPEST copy**, with "from" in front of it
  whenever a dearer one or an unpriced one is behind — quoting one copy's
  price for all of them is how you argue with a customer holding the receipt.
- **A pocket is an allow-list, exactly like `counterRow()`.** Built key by
  key, never a checkout row with the private parts hidden by CSS, and for the
  same reason: the leak worth designing against is the column added to
  `stock_checkouts` a year from now, appearing on a tablet somebody is
  holding. `check-binder.mjs` stuffs a row with every private value the desk
  knows and searches the whole serialised pocket for each one.
- **Where a card is comes back on a TAP, and the two sections are asked
  different questions.** A card in the box has been checked out, so
  `stackpos.js` gives it no live position on purpose — quoting the one it used
  to hold would send you counting to the wrong card on a shelf it is not on.
  What finds it is the SKU on its sleeve plus the stack it was packed out of
  (`placeOf()`). A card that is only LISTED is still in its stack, so it has a
  real live position and that is the useful answer — the same one the counter
  list's online rows give, with the same caveat that it is where the card
  lives at HOME. The pocket carries an id and nothing else; the desk resolves
  its own row.
- **A mostly vertical drag is a scroll.** `swipeDirection()` refuses anything
  that is not clearly horizontal and past a threshold, because the binder sits
  in a page you scroll and a page that turns under a customer's thumb while
  they are reading is unusable — and it is exactly the sort of thing that
  works on a mouse and fails in a hall. Arrow keys and the ◀ ▶ buttons do the
  same job for a laptop at the desk.
- **Desk chrome is gated on `customerMode`, never on `counterMode`.** There
  are two customer screens now. Gating the checkout form on the LIST alone
  renders it behind the binder, which is the same leak with an extra step;
  `check-showcounter.mjs` fails on any surviving `!counterMode`.
- **The picture is asked for bigger, not fetched.** `imageAt()` in
  `showcounter.js` is the one definition of eBay's CDN filename rule —
  `s-l500` for a pocket, `s-l1600` for the preview — so a binder page still
  costs no API call. `contain` rather than `cover`: a gallery shot cropped to
  fill is a card with its edges cut off, and the edges are what somebody is
  looking at the picture to see. The `ask` mark shares that corner badge for
  the same reason: over the card's top-left it hides the printed name, and on
  the price line it turns "from £825" into "from £…" in a 90px pocket.
- **One shape, both sources.** `boxItem()` and `onlineItem()` are the only
  place the difference between a checkout row and an eBay listing exists;
  everything after them groups, sorts and projects items. A second grouping
  path for the online stock would eventually disagree with the first about
  what counts as the same card, and that shows up as a customer being told we
  have one of something we have four of. A quantity-3 listing counts as one
  item — honest enough in a section whose promise is "ask and we'll check",
  and better than a number this file would have to guess at.

## A deal is one basket, one customer, one number

Day one at Glasgow, 2026-09-05: cards were being sold one at a time across two
screens. Mark a card **⤴ Show** in My listings — which checks it out and HIDES
the eBay listing — then walk to the Show Desk and mark it **£ Sold**, which
ENDS the same listing. Two eBay calls per card, in two places, while a customer
holds three more.

`apps/app/lib/deal.js` is the basket over that, and `DealBar.js` is the screen.
`packages/core` is untouched: what a lot goes for at a table has no business
changing what Last Comp tells a stranger their card is worth.

- **Adding is inert, and that is the trade.** No eBay call, no checkout, no
  write — a line in a list on this device. A customer who changes their mind
  costs one tap, which matters because on venue wifi you cannot reliably
  un-hide a listing you hid by mistake. The cost is a few minutes where the
  card is still live online, and that window already existed while they were
  deciding.
- **Selling does the whole job in one pass and ends the listing ONCE.** A card
  already in the box is the desk's existing path — resolve the checkout, pull
  the stack card, end the listing. A card still live on eBay gets a
  `stock_checkouts` row written ALREADY resolved, which is what saves the
  second call: checking out only to sell a moment later spends a hide and an
  end to reach the same place. **No migration** — 016 and 024 are enough.
- **A card with no SKU still sells**, recorded against no stack card. `⤴ Show`
  refuses it today, which at a table means refusing money over bookkeeping.
- **The money is written before the eBay calls, and a failed call never rolls a
  sale back.** A hall with bad wifi is exactly when you are busiest: a lost
  sale is unrecoverable, an un-ended listing is a retry. The failure goes on
  the row (`hide_error`) as well as on screen, and the retry only ever touches
  eBay.
- **The price is a fallback chain — sticker, then our eBay ask, then market —
  and the row says which.** A sticker is a decision somebody made holding the
  card; a market figure is the engine guessing. Quoting the wrong end of that
  without saying so is how you argue with a customer holding the receipt.
- **An agreed lot price splits back over the cards in proportion, and the last
  line absorbs the rounding.** Both halves matter. Proportional keeps each
  card's `sold_price_pence` honest, so per-card takings and margin survive a
  deal; summing to exactly what changed hands is what stops the day's takings
  disagreeing with the tin by a penny a deal, for ever, in a way nobody ever
  finds. Typing over a line price CLEARS the lot total — you have gone back to
  pricing card by card, and a total that no longer equals its parts is worse
  than none.
- **A card with no price blocks the sale, and the refusal names it.** Same rule
  as `exportGuard()` in `zero-price.js` and for the same reason: the whole
  class of fault here is something that was on screen and did not get read.
  Unticking a line keeps it in the basket, which is how you sell three of four.
- **A checkout already resolved elsewhere is refused.** The basket can sit on
  the counter while the same card is sold or returned from the desk, and
  resolving it twice would count the takings twice — silently, because both
  writes succeed and the row looks identical afterwards. The update is guarded
  on `resolved_at is null` and reads back the row it changed.
- **A basket does not survive the night** (`DEAL_TTL_MS`, 12 hours). A deal
  ends when the money changes hands or they walk off; neither leaves anything
  worth keeping until tomorrow, and the rows in a stale one have moved on.
- **A line is an allow-list**, built key by key, exactly like `counterRow()` —
  because the leak worth designing against is the column added to
  `stock_checkouts` a year from now, and a basket is one short step from a
  screen a customer can see.
- **localStorage, not Supabase.** One device, one deal. The one moment this has
  to work is the moment the venue wifi is worst. Two screens share it through a
  window event rather than a provider, and `useDeal()` is called ONCE per
  screen — a hook per row is two hundred storage reads on the one screen that
  was just fixed for doing too much per row.
- **`dealMode` is where the deal may be SPENT, and it is the one deliberate
  exception to `customerMode`.** Every other piece of desk chrome asks "is
  anybody but us looking at this?". This one asks a narrower question, because
  at a table you flip the binder WITH the customer and leaving it to take the
  money is the round trip the basket exists to remove. So the **binder carries
  the full bar, sell button and all** — decided explicitly, against the
  customer-screen rule, and the residual risk is real: two taps by whoever
  holds the tablet (Open deal, then £ Mark sold) records a sale. The drawer
  starts closed, so it is never one.
- **The counter is still out, and gets a read-only `DealTally`** — count and
  total, no drawer, no line editing, no sell button, nothing on it to press.
  That is the list you hand over and walk away from. Two components rather
  than one with a prop, because a prop is one wrong default from a sell button
  on that screen; `check-deal.mjs` pins `dealMode` as the literal desk-or-
  binder list, pins `dealMode ? <DealBar`, fails if the full bar appears under
  `counterMode`, and greps `DealTally` for every function that writes.
- **`dealMode` is written as a positive list of two screens, never as a negated
  counter-mode test.** Negating counter mode is the mistake
  `check-showcounter.mjs` exists to refuse — it hides a thing from the list and
  leaves it on the binder by accident. Here the binder is included on purpose,
  so the name says so. That check greps ShowDesk.js for the negated form as a
  literal, comments included, so writing it out to explain the rule is enough
  to fail the rule.
- **Adding is inert, so `＋ Deal` is safe on any screen.** It sits on every copy
  in an opened binder pocket, beside the ⌖ locate button: they point, you tap.
- **A pocket carries an id and nothing else**, so `＋ Deal` in the binder
  resolves the desk's own row by that id — the same rule as the ⌖ locate
  button. A box copy's id is its `stock_checkouts` row, a listed one's is its
  eBay item id. Putting either row on the projected pocket to make the lookup
  easier is the shortcut `check-showcounter.mjs` exists to refuse.
- **The bar STICKS to the bottom of the viewport.** It shipped merely docked at
  the end of the screen, reasoning that a fixed bar is a permanent bite out of
  a phone. Wrong twice: My listings is a long single column on a phone, so "the
  end of the screen" is a thousand pixels below the fold — you added a card,
  got no acknowledgement, and scrolled past two hundred rows to reach the
  basket. And the bite is not permanent, because the bar only exists while a
  deal is open, which is exactly when it has to be one thumb away. `sticky`
  rather than `fixed` keeps the content column's width and still comes to rest
  at the end of the page — and it works only because `#app` and `body` clip on
  the X axis with `overflow-x: clip` rather than `hidden`, which makes no
  scroll container. Changing either to `hidden` un-sticks it silently.
- **The drawer is a sheet: only the lines scroll.** The total and `£ Mark sold`
  are pinned, because an eight-card basket must not push the button that says
  how much money is changing hands off the bottom of a phone. For the same
  reason the two buttons stack rather than sit side by side under 560px:
  squeezed into a row the primary shrinks below its label and `.btn-primary`
  clips rather than wrapping, so it read "Mark 4 sold — £100.0".

## A broadcast is a sticker nobody can peel off

We auction on eBay Live from the photographs already on the listings, with a
host talking through each lot. The card stays in its stack until it sells.
Every card here is already pulled once, scanned, conditioned, SKU'd and priced;
pulling all of them again to wave each at a lens is that work twice, on the one
evening you are also trying to talk to a room.

Three pieces. `apps/app/lib/livestream.js` owns the LOT and is the only
definition of what may go on air. `tools/stream-relay` is a dependency-free
local server OBS points a Browser Source at. My listings grows a `＋ Stream`
button beside `＋ Deal`. `packages/core` is untouched: what a card fetches on a
Thursday night stream has no business changing what Last Comp tells a stranger
their card is worth. The eBay Live policy reading and the run instructions are
in `docs/LIVE_STREAM.md`.

- **A lot is an ALLOW-LIST**, built key by key — the same discipline as
  `counterRow()` and `dealLine()`, for a harder reason than either. Those face
  one customer across a table; this is broadcast, and a broadcast is recorded.
  The leak worth designing against is still the column added to `ebay_listings`
  a year from now for an unrelated reason, and here it arrives on a stream.
  `check-livestream.mjs` stuffs a row with every private value the app knows —
  SKU, stack, cost, note, takings — and searches the serialised lot for each.
- **A price we would not stand behind is never read out.** eBay's own rule is
  that a seller makes no misleading claim about condition, authenticity or
  value, and this repo already knows which of its prices are too thin to print:
  `stickerFor()` holds back low and no-confidence prices, and prices built from
  ASKING prices rather than sales. Every one of those reasons is stronger in
  front of a camera than on a sticker, which at least gets peeled off in front
  of one person. A held lot goes out with **no value line at all** — not a
  hedge and not an empty box where the last lot had a number.
- **`stickerFor()` decides WHETHER; `effectivePence()` decides WHAT.** That
  split is a bug this file shipped with: reading the figure off the sticker too
  put "£85 recent sold" on air for an £84 card, because the sticker rounds onto
  a £1/£5/£10 cash ladder for somebody handing over notes. Rounding is how you
  make a false statement about value without ever meaning to.
- **Nothing is held quietly**, and the reason goes to the HOST — in prose, at
  the moment the lot is queued, on the screen they are standing at. Never to
  the relay, never to the overlay. The audience sees no figure; the person
  about to talk over the card for thirty seconds knows why.
- **The pictures are the LISTING's pictures.** Not catalogue art, not a scan
  store of our own. eBay requires that what is shown live matches the listing,
  and this is the cheapest way to be certain of it — it also settles the real
  exposure of the whole format, which is dispute rather than policy: a buyer
  claiming the card was not as described is looking at the same photographs the
  stream showed them. `fetchItemPictures()` is one GetItem per lot, affordable
  precisely here because a lot is queued by hand seconds before a host talks
  over it, and it is deliberately on no path that renders a list.
- **The relay never builds a lot.** `sanitiseLot()` is a bouncer: it strips the
  figure off a lot marked held, drops any field nobody allowed, and refuses a
  lot outright rather than half-rendering one. Two ends written on different
  days need the rule at both, and the check greps the relay for any sign of it
  deciding anything — `lotFrom`, `counterName`, `stickerFor` and the rest.
- **A lot with no pictures is refused, and standby renders nothing.** eBay
  reads an empty or placeholder screen as an abandoned stream, so the overlay
  is transparent and draws nothing between lots; the honest picture there is
  the host on camera. A card auctioned off a blank rectangle is the version of
  this format nobody should defend, which is why it is unrepresentable rather
  than merely discouraged.
- **127.0.0.1, and an origin allow-list on top.** The machine running OBS is on
  hall wifi; bound to every interface the relay serves the queue, the stock and
  the prices to the building. `*` for origins is the same hole one layer up —
  any page open in that browser could read the queue. The relay prints what it
  accepts at startup, because a `＋ Stream` button that silently does nothing is
  the failure this repo has already paid to learn about once.
- **The queue is in memory and does not wrap.** A queue is a session: re-added
  in seconds, and restored after a crash it is a list of cards that may already
  have sold. Running off the end parks on nothing rather than starting again,
  because a stream that quietly restarts its list auctions the same card twice
  — and a lot queued after that airs THAT lot, not the front of the queue,
  which was the first version's bug.
- **SSE, not a WebSocket.** The one deviation from the brief. Traffic is
  one-directional and the host's controls are ordinary POSTs, so a socket buys
  nothing and costs a dependency or a hand-rolled frame parser. `EventSource`
  reconnects on its own, forever, with no code — and OBS routinely opens a
  browser source before the relay is running.
- **The producer is the app, not a browser extension.** The brief described an
  extension reading the item number off an open eBay listing page, and the
  contract in `docs/LIVE_STREAM.md` still allows one. It is not what shipped
  because the name, condition and value are not on that page in a form worth
  trusting — they are in Supabase behind the app's login, so an extension needs
  a second auth surface for data the app already has open.
- **The relay is started by double-clicking a file.** `Start Stream Relay.cmd`
  and `.command` at the repo root install on a first run, start the relay and
  open the host's desk; the desk carries the OBS URL with a copy button and,
  while the queue is EMPTY, a button that loads demo lots so a scene can be
  laid out with no app, no eBay account and no database in the way. The relay
  refuses those once anything is queued rather than trusting the page to hide
  the button — during a stream there is always something in the queue, which
  makes demo cards in front of an audience unrepresentable rather than
  unlikely. They are demo.mjs's own fixtures and they go in through the same
  door as a real lot, so `sanitiseLot()` vets them identically.
- **Which picture is showing comes from the relay's clock.** The overlay
  derives it from the lot's elapsed time rather than running a timer of its
  own, so a browser source that reconnects mid-lot lands where the desk says it
  is instead of restarting the cycle under a host who has already done the
  front of the card.

## My listings: a keystroke used to render the whole inventory

The filter box was sticky at the show, and the images were not the reason. A
keystroke re-ran the row memo over every listing and then re-rendered EVERY
result; the filter-and-group half measures 10–18ms over 3–8k rows on a desktop
and the render around it is the rest, on a tablet several times slower again.
The thumbnails are 10KB `s-l140` files loading lazily — they add paint cost and
they are not what blocks the keystroke.

The list is capped at `PAGE` (200) with a **Show more** under it, and the
filter feeds the memo through `useDeferredValue` so the input never waits on
the list. **The cap is a rendering cap, so what is on screen is what a bulk
action acts on** — the same rule as `selectionFor()` on the Show Desk, and it
matters more here because "Price visible" spends a SoldComps request per card.
The CSV is the one exception and says so in its tooltip: it is a file you read
later, not a button that spends money.

The `.rise-grid` entrance animation now plays once on arrival and is then
dropped — it is `.rise-grid > *`, so every card that mounted as a filter
widened replayed a .34s rise, and the `nth-child` delays shift as rows reorder.

**A quantity of zero has two causes, and they want opposite treatment.** eBay
zeroes a listing when the card SELLS and leaves the shell in the ActiveList;
we zero one ourselves when the card is checked out to a show. Same field, same
value. `listingStock()` in `stockcheck.js` is the one place that tells them
apart, against the open `stock_checkouts` rows: a sold shell is **hidden** from
My listings (it is noise in a list of what there is to sell, and it was padding
out the inventory value), and a card at a show is **kept and labelled** with
where it is, because hiding that one would hide the stock you are standing next
to. `check-instock.mjs` pins both directions.

Three things about it that are the point rather than detail:

- **A failed probe is not an empty box.** If `stock_checkouts` is unreachable
  the index is left null, `listingStock` answers `unknown`, and NOTHING is
  hidden — the same rule as `desk-setup.js`. Guessing the other way makes a
  card you are standing next to vanish from your own inventory.
- **A checkout we did not make the zero for is `suspect`, not confidently
  "at a show".** Checked out with `hide_method` anything but `quantity`, a
  zero is eBay's doing, so the card is away AND something happened to the
  listing — the double-sale the desk warns about. It gets a question and a
  "check eBay", not a reassuring chip.
- **Nothing is dropped quietly.** The count of hidden sold-out rows is a
  checkbox that brings them back, and the count of cards at a show is in the
  summary. A row that vanished with no count looks exactly like a card we never
  had, in the one list you would go looking in to find out.

## What we were asked for is the only demand signal a show gives

"Do you have any gengars" is a **want**, and until migration 026 nothing
recorded it. The asks where the answer is NO leave no trace anywhere — no sale,
no checkout, no row — and they are the valuable half: a buying list and a
packing list, unreconstructable the next morning.

`apps/app/lib/wants-store.js` is the only file naming `show_wants`, the same
rule `batch-store.js` follows and for the same reason. Three things worth
knowing:

- **It is recorded from the search box**, because by then you have already
  typed it: "gengar" is in the box and the answer is on screen. `had_match`
  comes from THAT search rather than being recomputed later — the useful fact
  is whether we could meet the ask at the moment it was made, and stock has
  moved by the time anyone reads the list.
- **A miss and a hit are both worth a tap.** The miss says what to buy; the hit
  says what to pack again. `wantsSummary()` breaks ties toward the misses,
  because the list gets read with a float in hand.
- **A pending migration degrades rather than breaks.** Migrations here are
  applied by hand and the code ships first, so every call returns
  `{ ok: false, missing: true }` until 026 is run and the desk carries on
  working. A desk that white-screens at a show because a migration is pending
  is a worse outcome than no want list.

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

## One listing, several copies of the card

Quantity 3 behind one listing, three physical copies, each with its own scan and
its own stack row. A copy sells, the listing's picture becomes the next copy's
scan, and the pull sheet says which one to walk to. **Built and tested; no
screen, and untested against live eBay** — see `docs/MULTI_QUANTITY_LISTINGS.md`
for the process to run it by hand and for the 20-card experiment that decides
whether the method is worth having at all.

`apps/app/lib/copyqueue.js` owns it, `packages/core` is untouched, and migration
027 adds `copy_seq`, `scan_url` and `listing_copy_state`.

- **eBay reports the LISTING's SKU on a sale, never the copy's.** A sale says
  "this item id sold two" and carries nothing that separates copy 1 from copy 2,
  so the ordering is ours: `copy_seq`, then when the copy was added, then the
  row id. That last key is not tidiness — the head of the queue is the card in
  the photograph, and two reads of the same data disagreeing about it would
  rotate the picture to a card nobody sold.
- **It is a RECONCILIATION, not a ledger.** The first design consumed sale line
  items and kept an event log so a replayed sync could not double-consume;
  reading `PullSheet.js` killed that. The pull sheet already matches orders to
  stack cards and marks them pulled on Commit, so **the card leaving the box is
  the consumption**, recorded by the person holding it. Desired state is a pure
  function of what is still in the box — quantity is copies left, picture is the
  head's scan — so running it twice does nothing the second time and a missed
  run is merely stale. A ledger would have been a second opinion about stock,
  and the disagreement would have been silent.
- **eBay REHOSTS pictures, which is the one thing that cannot be derived.** A
  listing's image comes back as `i.ebayimg.com/…`, never the storage URL we
  sent, so there is no comparison to make between the listing and the queue.
  `listing_copy_state` records which copy the listing was last revised to show
  and nothing else; delete it and the cost is one redundant revision each.
- **eBay caches pictures BY URL.** Every copy's scan needs its own URL, never
  overwritten in place — re-uploading different bytes to a path eBay has already
  fetched changes nothing visible and looks exactly like the revise call
  failing.
- **One copy's scan on the listing, never several.** Three scans on a quantity-3
  listing tell a buyer three cards exist and nothing about which they get, which
  is worse than a stock photo because it looks like it is telling them
  something. A picture swap needs `ReviseFixedPriceItem`
  (`reviseFixedPriceListing`); `ReviseInventoryStatus` does price and quantity
  only, and both changes go in one call so there is no window advertising a card
  that has gone.
- **A copy at a show is not a copy you can post.** Away and pulled both leave
  the queue, and the listing's quantity drops with them — a listing left at 3
  while one of the three is on a table sells a card twice.

Two bugs in shipped code came out of building it, both invisible while every
listing was a single card. **A line item carries a quantity and the pull sheet
ignored it** — `fetchPendingOrders` always returned it — so one order for two
copies pulled one card and the sheet looked complete; each unit is its own row
and its own tick now. And **which of several same-SKU copies got pulled was
arbitrary**, first-wins over an unordered `select *`, when the whole point is
that the copy that goes is the copy in the photograph.

```
node scripts/copyqueue-run.mjs                      # what would change, dry
node scripts/copyqueue-run.mjs --item <id> --apply  # send one, on purpose
```

`--apply` requires `--item`: the first live test is one listing you chose, not
every listing you happen to hold two of.

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

## Every migration is applied by hand, so ask before assuming

Nothing here runs migrations automatically. The code always ships first and
degrades when a migration is pending, which is right — and it means the
database's actual state is never inferable from the repo. Two ways to ask it:

```
node scripts/check-migrations.mjs      # needs the Supabase URL + service-role key
```

Or **Actions → Which migrations are applied? → Run workflow**, which uses the
secrets the warmer and the image backfill already hold. Read-only: it probes
for tables, columns, functions and the one storage bucket, and it never CALLS a
function — `claim_soldcomps_slot` hands out a pacer slot, and a health check
that consumes one is changing the thing it measures.

`supabase/HEALTH_CHECK.sql` asks the same question in SQL and is still the
better answer with the dashboard open — one paste, one Run, and it can read row
counts the probe cannot. The script exists because the SQL needs a human at the
editor, so nothing else could ever answer "what's still to do".

**An unanswered probe is not a missing migration.** Anything the script could
not determine makes the whole run inconclusive and exits non-zero, rather than
reporting absence — the first version printed "nothing to apply" when the
database was simply unreachable, which is the most confident possible way to
say the opposite of the truth. `supabase/APPLY_PENDING.sql` covers 012–016 in
one paste; everything after that is its own file, because the later ones import
data, replace functions and hold locks.

## Merging to main deploys — batch it

Both Vercel projects build from this repo, so every push to `main` triggers
two Production builds and every push to a branch triggers two Previews. On
2026-08-22 a long audit-and-fix session merged 30 times in a day, hit the
Hobby plan's 100-deployment cap by early afternoon, and the last two fixes sat
unbuilt for hours — with the live site quietly serving the commit before them.

Verify locally (`npm run check`, `npm run build:public`), let fixes accumulate
on the branch, and merge once you have something worth deploying. If the site
stops reflecting a merge, check the Vercel dashboard before assuming the code
is wrong: a missed deploy looks exactly like a bug that didn't take.

## Gotchas that have already bitten

- **`packages/core` runs in a BROWSER, so its syntax is capped by Safari.**
  `inferCondition` used a regex lookbehind to stop "60 HP" reading as Heavily
  Played. Safari only learned lookbehind in 16.4, so an older iPad throws —
  and because the minifier rebuilds a regex literal as `RegExp("(?<!…")`, a
  runtime constructor rather than a literal, it does not fail at load. It
  fails the first time the function is CALLED, so the app opened, every other
  screen worked, and one screen white-screened on one device. Diagnosing that
  from the symptom is nearly impossible; `check-corebrowser.mjs` greps for it
  instead. **The copy that actually broke was not in core** — it was a third,
  hand-copied `inferCondition` in `Panel.js`, which now delegates.
- **Relative imports of moved modules.** Anything written against the pre-
  workspace layout may `import … from "./pricing.js"`. That resolves to nothing
  now — it must be `@compfinder/core/pricing.js`. The build catches it; it has
  happened twice (`stockcheck.js`, `carduploader.js`).
- **Vercel Root Directory** is per-project: `apps/app` and `apps/public`. A
  deploy that builds fine then can't find `routes-manifest.json` means the root
  directory is wrong, not the code.
- **`packages/core` has no `"type"` field** on purpose: `pricing.js` and
  `soldcomps.js` are CommonJS, the rest are ESM. Fine through the bundler.
  Running an ESM one under bare `node` warns; harmless.

## EPN affiliate links

`packages/core/epn.js` tags eBay links. **Live since 2026-08-25** — campaign
`5339194433`, set on `compfinder-public`. It is inert wherever
`NEXT_PUBLIC_EPN_CAMPID` is unset, which is how it stays safe on the app. Two
standing rules:

- **Never tag a link the account holder is expected to click** — their own
  listings (Inventory, the my-listings banner, ListForm) and the whole
  Arbitrage tab. Commission on your own purchases gets the account terminated.
- **Set it on `compfinder-public` only, never on `comp-finder`.** The variable
  is read once in `packages/core/epn.js`, which both apps share, and
  `apps/app/.env.local.example` carries the same name. Set on the app it tags
  QuickSearch's own "Buy one now" rows and the batch comp rows — links the
  account holder clicks. Separate Vercel projects are what keep this safe; it
  is one dropdown away from not being, so re-check it after any project change
  rather than assuming.

**Every tagged link says which card it was on.** `apps/public/lib/epn-tag.js`
builds the sub-ID — `buy-hero-prismatic-evolutions-131` — from a fixed list of
slots and the card's own set and number. The slot stays the FIRST segment on
purpose: those three have been reporting since the campaign went live, so a
prefix match still selects what it always did and the card is additive. There
is no analytics on this site and the privacy page promises there never will be,
which makes the EPN dashboard the only per-page traffic signal there is —
reading it by set is what decides which cards to publish next.

What it is likely to earn, with the sums, is in `docs/EPN_EXPECTED_RETURN.md`:
~3p per outbound click, ~£0.0045 per search, so **~740 searches a day for £100
a month**. One £10 Pro subscriber is worth about 2,200 free searches — the
number that should settle any trade-off between "more clicks to eBay" and "more
visitors who find the batch tool".

## Before the public page goes live

Things deliberately set for a page with no visitors. Each one is wrong the
moment strangers can reach it.

- [x] **Rate limit back to 120/hour.** Done 2026-08-23. `PUBLIC_LIMIT` is the
      default in `apps/public/app/api/price/route.js`; `PUBLIC_RATE_LIMIT_PER_HOUR`
      still overrides it. Our own runs use `AUDIT_TOKEN` instead — every audit
      script sends it via `scripts/lib/audit-headers.mjs`, which warns loudly
      when it isn't set rather than letting a long run die of 429s an hour in.
- [x] **Throttle our own calls to SoldComps.** Done 2026-08-23, migration
      `021_soldcomps_global_pacer.sql`. A leaky bucket in Postgres hands out
      slots 1100ms apart (~54/min, short of their 60 on purpose); a request
      that would wait more than 4s is shed with a "try again in a few seconds"
      rather than queued. In Postgres because each Vercel invocation is its own
      process — an in-process bucket paces one lambda and leaves the rest
      unbounded. Every attempt claims a slot, retries included. Fails OPEN if
      the pacer is unreachable, so the deploy doesn't depend on the migration
      having been run.
- [x] **Bot protection** on `/api/price`. Done 2026-08-23. Turnstile, but as a
      pass rather than a per-request token: `/api/challenge` trades one solved
      token for a signed 30-minute cookie bound to the visitor, and `/api/price`
      checks the cookie on cache misses only. One challenge per half hour, and
      nobody re-reading a cached price is ever asked. **Inert until both
      `TURNSTILE_SECRET_KEY` and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` are set** —
      set both or neither, since the secret alone asks for a check the page
      can't solve.

      **The check is the one guard a phone can fail on its own**, and it did,
      for two months, on any card that missed the cache: the search stopped on
      "No luck — just checking you're human", which is the server's
      *interstitial* copy printed as a verdict. Three things had to change, and
      all three are worth keeping in mind before touching this again.

      **The pass binds to a NETWORK, not an address** (`clientNetwork()` in
      `lib/turnstile.js` — IPv4 /24, IPv6 /64). A phone's egress address moves
      while the visitor is waiting: carrier CGNAT rotation, or a dual-stack
      handset answering one request over IPv4 and the next over IPv6. Bound to
      the exact address, a pass earned a second earlier is not a pass any more.
      A /24 keeps what the binding is for — a proxy fleet spans the internet,
      not 256 neighbouring addresses. `::ffff:a.b.c.d` is unwrapped to its
      IPv4 /24 rather than bucketed by /64, or every mapped address on the
      internet would share one tag; `check-turnstile.mjs` pins that case.

      **An interactive challenge must be impossible to miss.** Cloudflare
      decides per visitor whether the check can be silent and asks a phone far
      more often than a desktop. The widget used to be pinned bottom-right at
      12px — a small box in the home indicator's lap, on a page still showing a
      spinner — so nobody tapped it and `timeout-callback` killed the search
      thirty seconds later. `before-interactive-callback` is Cloudflare saying
      a tap is needed; that is when the panel goes to the middle of the screen
      with a line of copy on it.

      **The widget's own hostname list is the thing that was actually
      broken, and it failed silently for two months.** Diagnosed 2026-08-28:
      the check reported `110200` — Turnstile for "domain not allowed" — and
      the cause was **a stale Home Screen icon**, not the widget. The sitekey
      was right and the widget listed both `lastcomp.co.uk` and
      `www.lastcomp.co.uk`. The phone was simply not on either of them: an
      iOS icon added before the domain went live keeps the origin it was
      installed from, so every page it opened came off an old Vercel
      hostname Turnstile had never been told about. Safari on the same phone
      worked. Deleting and re-adding the icon fixed it.

      **`start_url` in `manifest.js` is "/" — relative — and that is what
      makes this possible.** iOS resolves it against wherever the icon was
      installed from and keeps that origin permanently. Making it absolute
      does NOT fix it: a start_url outside the manifest's own origin is out of
      scope and ignored, so it would be a no-op dressed as a fix. The real
      remedies are a canonical-host redirect in middleware (gated to
      production, or a preview deploy bounces to live) or re-adding the icon.
      **The redirect is in place as of 2026-08-28** — `apps/public/middleware.js`,
      with the decision in `lib/canonical-host.js` and `check-canonical-host.mjs`
      pinning it: production only, 308 so a POST keeps its method, and **no
      redirect at all when `NEXT_PUBLIC_SITE_URL` is unset**, because the
      `siteUrl()` fallback is the apex and Vercel 308s the apex to www — a
      redirect built from the fallback would loop forever, precisely when a
      config var went missing. A stale icon now heals on its next launch; the
      diagnostic below stays.

      **This cost two wrong diagnoses, and both were confident.** First the
      mobile-network story — carrier drift, a corner-pinned widget — three
      plausible causes fixed blind because the site has no analytics and there
      was no route from "it fails on a phone" to why. Then, once `110200`
      named a domain refusal, the assumption that the widget's hostname list
      was short. Both were reasoned and neither was checked, because neither
      could be from here. **The lesson is the ordering: instrument first, then
      fix.** One line of small print carrying Cloudflare's own error code and
      `location.hostname` settled in one retry what two rounds of inference
      got wrong.

      **A client-reported error code must never unlock the server.** It is
      tempting to let `110200` fail open, since a challenge that cannot
      succeed is a wall rather than a guard. Don't: the code comes from the
      page, so anything can claim it, and /api/price would be spending money
      on whoever asked. A widget that genuinely is misconfigured is fixed in
      the dashboard.

      **Add every host the widget can render on**, including a vercel.app host
      if previews are meant to price anything — a preview on a host Turnstile
      doesn't know fails exactly this way, and looks like a broken build.

      **Nothing in `turnstile-client.js` may wait forever, and a failed search
      gets a Try again.** Every await there is bounded, because the state to
      degrade into is a page that says what went wrong and offers another go —
      not a spinner with no end. `price()` in `use-card.js` allows two
      challenge rounds rather than one, since a second challenge in a row is
      the normal outcome of drift rather than a failure, and it never lets the
      server's "one moment" reach the screen as a final answer.
- [x] **Privacy policy and affiliate disclosure.** Done 2026-08-24,
      `apps/public/app/privacy/page.js` with an `#affiliate` section, plus the
      disclosure inline in the home footer rather than only behind a link. The
      site had none of its own — only the business app's, a different Vercel
      project — so any link to `/privacy` 404'd. EPN review the live site, so
      this was blocking the application. The contact address on it,
      `privacy@lastcomp.co.uk`, is live and receiving — confirmed 2026-08-25.
- [x] **Apply to EPN, and set `NEXT_PUBLIC_EPN_CAMPID`** (5339194433). Done
      2026-08-25: the campaign is live and the ID is set on `compfinder-public`
      **only** — confirmed, and the thing to re-confirm if the projects are ever
      recreated, because commission on your own purchases ends the account and
      `apps/app/.env.local.example` carries the same variable name.

      Every tagged link now reports which card it was on, not just which module
      (`lib/epn-tag.js`, pinned by `check-epn-tag.mjs`). That matters more here
      than it would elsewhere: the privacy page promises no analytics and means
      it, so **the EPN dashboard is the only per-page traffic signal this site
      has**, and it only says as much as the sub-ID puts in. Reading it by set
      is what decides which cards to publish next — see `docs/MARKETING.md`.

      Still open, and worth a row in `MKRID` once there is evidence of the
      traffic: the rotation is UK-only, so a US visitor clicks an untagged
      link.
- [x] **Open the door to search engines.** Done 2026-08-25.
      `PUBLIC_ALLOW_INDEXING=1` on `compfinder-public`; robots.txt allows all
      but `/api/` and the `noindex` is gone. Search Console is a **Domain**
      property (verified by DNS TXT, so it covers www and the apex together),
      and `https://www.lastcomp.co.uk/sitemap.xml` is submitted — the full URL
      including www, because a Domain property prefills nothing and the apex
      308s. 450 URLs discovered.

      **URL Inspection confirmed Googlebot sees the price in the HTML** without
      running JavaScript — the whole point of the server-rendering work, and
      the one thing worth re-checking if the card page is ever refactored.

      **What to watch now, because there is no analytics.** The Pages report:
      "Crawled — currently not indexed" at scale is the thin-content verdict
      and the only real risk to the whole approach. "Discovered — currently not
      indexed" early on is just a queue. And the Performance report's query
      list is the closest thing to traffic data the site has — it tells you
      which cards to publish next.
- [ ] **Consent management** (a Google-certified CMP) before any ad code, and
      `ads.txt`, for UK/EEA traffic.

The configuration side is done as of 2026-08-25: `AUDIT_TOKEN`, both Turnstile
keys, `NEXT_PUBLIC_SITE_URL` (www, not the apex — the apex 308s) and
`NEXT_PUBLIC_APP_URL` are all set on `compfinder-public`, and the warmer has
the same `AUDIT_TOKEN` plus the Supabase pair as repository secrets. Migration
021 still has to be applied against Supabase or the pacer logs that it is
unreachable and lets everything through.

**Vercel functions run in `lhr1`.** They defaulted to Washington, which put the
Atlantic between every request and a UK Supabase — a cached price read went
from 0.81s to 0.33s on moving them. Worth remembering if the project is ever
recreated: the default is wrong for this product.

## The SoldComps terms question, settled 2026-08-25

This used to say the public page must not go on a domain until SoldComps
confirmed three things in writing. **That gate is lifted.** Re-reading their
own FAQ answered most of it, and the rest was a question worth less than the
delay it was causing.

Their FAQ: *"Every plan — including free — permits commercial use. Build it
into a paid SaaS, an internal tool, a client deliverable, a mobile app,
whatever. You pay for the requests; what you build on top of them is yours."*

Against the three questions that were open:

- **One server-side key serving anonymous visitors** — answered. They bless "a
  mobile app", and a mobile app cannot ship per-user API keys; it is one key
  serving users the operator never identifies. Same for the paid SaaS they also
  bless.
- **Caching their responses** — unaddressed, but there is no objection to
  construct. Caching *reduces* their load, and every plan is metered per
  request, so caching means we buy fewer. Their only interest runs the other
  way, and "what you build on top of them is yours" leans permissive.
- **Displaying individual comp rows** — the one genuinely open point, and
  weaker than it first looked: the rows are *eBay's* listings. SoldComps is a
  scraper; what they sell is the access, not ownership of the fact that a card
  sold for £X on a date.

**Why we stopped short of asking.** A question invites a policy where none
exists. Faced with a novel redistribution question, the safe answer for a
support person is "no" — and then we are bound by an answer we went and
fetched. Operating on a reasonable reading of terms they wrote and published is
the better position, and the realistic downside was never damages: it is being
asked to stop.

**What that means in practice.** The key can still be cut off, and the day it
is, every uncached search fails — the warmed cards keep serving and nothing new
prices. That risk is real, unchanged, and the reason the cache is worth as much
as it is. It was never a reason to keep the site off a domain.

If we ever do make contact, make it a customer email — what we are building, we
are on Starter, expect to grow, anything you would want us to know — rather
than a permission request. That gets a named human and an implicit blessing
without forcing a ruling.
