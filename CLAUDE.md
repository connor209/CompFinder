# CompFinder

Two deployables share one pricing engine. **Say which one you mean before
editing anything** — the words below are the agreed shorthand.

## Naming

| Say this | Means | Vercel project | Who uses it |
|---|---|---|---|
| **the app**, **Pro** | `apps/app` | `comp-finder` | us, daily, for the business |
| **Last Comp**, **the public page** | `apps/public` | `compfinder-public` | anonymous visitors |
| **core** | `packages/core` | — | both of the above |

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
supabase/        migrations, shared by both
docs/            research reports; MARKETING.md is the current acquisition plan
                 HOW_PRICING_WORKS.md is the app's pricing in plain English
                 PRICING_RESEARCH.md is where to strengthen it next
```

Run everything from the repo root: `npm run dev` / `npm run build` (the app),
`npm run dev:public` / `npm run build:public` (the public page).

## Checks

`npm run check` runs twenty-four table tests, no framework, non-zero exit on failure:

- `scripts/check-language.mjs` — which sets `languageOf` calls English.
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
- `scripts/check-share.mjs` — the shareable PNG: always dated, sold figures
  only, long names cut, and greps against it ever reading the price cache or
  growing an asking price.
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
- `scripts/check-override.mjs` — a price you typed: what counts as one, that
  the recommendation is never edited, that the sticker gate lets yours through,
  and a grep over every path that spends money for a direct read of
  `finalPence`.
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
