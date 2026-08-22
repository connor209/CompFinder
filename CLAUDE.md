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

`npm run check` runs two table tests, no framework, non-zero exit on failure:

- `scripts/check-language.mjs` — which sets `languageOf` calls English.
- `scripts/check-exclusions.mjs` — which comps the pricing engine excludes.

Every case in both is a real expansion code or a real sold-listing title. The
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

- [ ] **Rate limit back to 120/hour.** `apps/public/app/api/price/route.js`
      currently runs at `TESTING_LIMIT` (2000) so audit runs don't trip it.
      That endpoint spends real money per cache miss — at 2000 one scraper
      burns a month of SoldComps quota in an afternoon. Set it to
      `PUBLIC_LIMIT` and use `AUDIT_TOKEN` for our own runs.
- [ ] **Set `NEXT_PUBLIC_EPN_CAMPID`** (5339194433). Left unset while we are
      the only ones clicking, since commission on your own purchases ends the
      EPN account.
- [ ] **Throttle our own calls to SoldComps.** Their documented limit is 60
      requests/minute across the whole key, and the public page has no global
      limiter — only a per-IP one. A modest burst of visitors, or one cache
      cold-start, will exceed it. Measured: a 282-card audit at ~170/min
      failed 155 of 282 with upstream errors. Needs a queue or a concurrency
      cap before real traffic, or busy periods return errors that look like
      the tool being broken.
- [ ] **Bot protection** on `/api/price` — Turnstile or equivalent. The rate
      limit alone only bounds one IP.
- [ ] **Consent management** (a Google-certified CMP) before any ad code, and
      `ads.txt`, for UK/EEA traffic.
- [ ] **The SoldComps answer below.** Not optional.

## Open question blocking the public page

SoldComps has not yet confirmed in writing that we may (1) serve anonymous
visitors from one server-side key, (2) cache their responses in our own
database, (3) display individual comp rows publicly. Their site says every plan
permits commercial use; redistribution is unaddressed. Until that is answered,
the public page should not be marketed or put on a domain.
