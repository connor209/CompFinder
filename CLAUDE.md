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
