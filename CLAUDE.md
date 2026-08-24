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
docs/            research reports; PUBLIC_SEARCH_ADS.md covers the public page plan
```

Run everything from the repo root: `npm run dev` / `npm run build` (the app),
`npm run dev:public` / `npm run build:public` (the public page).

## Checks

`npm run check` runs twelve table tests, no framework, non-zero exit on failure:

- `scripts/check-language.mjs` — which sets `languageOf` calls English.
- `scripts/check-exclusions.mjs` — which comps the pricing engine excludes.
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
  and that robots.txt and the page metadata give the same answer.

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

**None of it is switched on yet.** `PUBLIC_ALLOW_INDEXING` gates robots.txt and
the pages' `noindex` from `lib/indexing.js`, and defaults to CLOSED. Two
conditions, both required: the domain has to be live, or the content is indexed
against a preview hostname and you owe yourself a migration for pages that had
just started to rank; and SoldComps have to have answered, because inviting
Googlebot to crawl every card page is an emphatic way of doing the thing they
have not yet said we may do. `NEXT_PUBLIC_SITE_URL` must name a host that
actually resolves — a canonical pointing at a dead host is worse than none.

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
third party being up — the alternative source, pokemontcg.io, spent an hour
returning 500 to every call on 2026-08-23 — and we store links, not copies, so
the artwork stays The Pokémon Company's problem to license rather than ours to
redistribute.

```
node scripts/probe-images.mjs                       # measure coverage, writes nothing
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  node scripts/backfill-images.mjs --dry-run        # then without, to write
```

Or from the browser, with no checkout: **Actions → Backfill card images → Run
workflow** (`.github/workflows/backfill-images.yml`). Manual trigger only — it
holds the service-role key, so it never runs off a push. Needs the repository
secrets `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, and
migration 022 applied first.

Backfilled 2026-08-23: **21,162 of 32,365 English rows have art (65%)**. That
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
/card/[q]                which one? when ambiguous, otherwise the answer
/card/[q]?days=30        the same answer over a shorter sold window
/card/[q]/workings       every sale counted, every sale excluded, net after fees
```

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

`packages/core/epn.js` tags eBay links, and is inert until
`NEXT_PUBLIC_EPN_CAMPID` is set. Two standing rules:

- **Never tag a link the account holder is expected to click** — their own
  listings (Inventory, the my-listings banner, ListForm) and the whole
  Arbitrage tab. Commission on your own purchases gets the account terminated.
- **Leave the campaign ID unset until the public page has real visitors.**
- **Set it on `compfinder-public` only, never on `comp-finder`.** The variable
  is read once in `packages/core/epn.js`, which both apps share, and
  `apps/app/.env.local.example` carries the same name. Set on the app it tags
  QuickSearch's own "Buy one now" rows and the batch comp rows — links the
  account holder clicks. Separate Vercel projects are what keep this safe; it
  is one dropdown away from not being.

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
- [x] **Privacy policy and affiliate disclosure.** Done 2026-08-24,
      `apps/public/app/privacy/page.js` with an `#affiliate` section, plus the
      disclosure inline in the home footer rather than only behind a link. The
      site had none of its own — only the business app's, a different Vercel
      project — so any link to `/privacy` 404'd. EPN review the live site, so
      this was blocking the application. **The contact address on it
      (`privacy@lastcomp.co.uk`) has to actually exist.**
- [ ] **Set `NEXT_PUBLIC_EPN_CAMPID`** (5339194433), on `compfinder-public`
      only — see above. Left unset while we are the only ones clicking, since
      commission on your own purchases ends the EPN account.
- [ ] **Apply to EPN.** They review a live site with a working disclosure, so
      this can't happen before the domain does — which means the SoldComps
      answer below gates the affiliate revenue too, not just the legal question.
- [ ] **Consent management** (a Google-certified CMP) before any ad code, and
      `ads.txt`, for UK/EEA traffic.
- [ ] **The SoldComps answer below.** Not optional.

Most of what is done is configuration as much as code: `AUDIT_TOKEN` and
the two Turnstile keys still have to exist in Vercel, and migration 021 has to
be run against Supabase, or the pacer logs that it is unreachable and lets
everything through.

## Open question blocking the public page

SoldComps has not yet confirmed in writing that we may (1) serve anonymous
visitors from one server-side key, (2) cache their responses in our own
database, (3) display individual comp rows publicly. Their site says every plan
permits commercial use; redistribution is unaddressed. Until that is answered,
the public page should not be marketed or put on a domain.
