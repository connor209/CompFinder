# CompFinder

Two deployables share one pricing engine. **Say which one you mean before
editing anything** — the words below are the agreed shorthand.

## Naming

| Say this | Means | Vercel project | Who uses it |
|---|---|---|---|
| **the app**, **Pro** | `apps/app` | `comp-finder` | us, daily, for the business |
| **the public page**, **the free page** | `apps/public` | `compfinder-public` | anonymous visitors |
| **core** | `packages/core` | — | both of the above |

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

`npm run check` runs seven table tests, no framework, non-zero exit on failure:

- `scripts/check-language.mjs` — which sets `languageOf` calls English.
- `scripts/check-exclusions.mjs` — which comps the pricing engine excludes.
- `scripts/check-resolve.mjs` — what the resolver parses and how it ranks.
- `scripts/check-public-price.mjs` — a grep: no charm ladder on the public side.
- `scripts/check-turnstile.mjs` — pass forgery, client binding, expiry, off-switch.
- `scripts/check-liquidity.mjs` — how a capped result set is read, and a grep
  against anyone guessing it from a comp count again.
- `scripts/check-images.mjs` — which picture goes with which card.

Every case in the first two is a real expansion code or a real sold-listing title. The
false-positive cases matter more than the true ones: each is something a draft
rule wrongly excluded, kept so a later "obvious" widening of a pattern fails
loudly instead of quietly costing good comps. **Run it before touching
`packages/core`.**

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

Measured over the 400 English cards in the audit sets: **84% end up with art,
90% of the chase set.** The gaps are World Championship Decks and a few EX-era
and promo sets tcgdex doesn't index (13%), plus the Shining Fates Shiny Vault,
which it lists without art (12 cards). Non-English rows are skipped — tcgdex
has them, but under Japanese set names, which needs a name map we don't have.

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
- [ ] **Set `NEXT_PUBLIC_EPN_CAMPID`** (5339194433). Left unset while we are
      the only ones clicking, since commission on your own purchases ends the
      EPN account.
- [ ] **Consent management** (a Google-certified CMP) before any ad code, and
      `ads.txt`, for UK/EEA traffic.
- [ ] **The SoldComps answer below.** Not optional.

The three that are done are configuration as much as code: `AUDIT_TOKEN` and
the two Turnstile keys still have to exist in Vercel, and migration 021 has to
be run against Supabase, or the pacer logs that it is unreachable and lets
everything through.

## Open question blocking the public page

SoldComps has not yet confirmed in writing that we may (1) serve anonymous
visitors from one server-side key, (2) cache their responses in our own
database, (3) display individual comp rows publicly. Their site says every plan
permits commercial use; redistribution is unaddressed. Until that is answered,
the public page should not be marketed or put on a domain.
