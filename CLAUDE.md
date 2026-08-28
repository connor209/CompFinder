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

## Where the rest of this is written down

This file is what holds for the whole repo. Everything specific to one of the
three parts lives beside that part, so a session working on the Show Desk
isn't also carrying the splash-screen geometry and the Turnstile post-mortem:

| File | Covers |
|---|---|
| `packages/core/CLAUDE.md` | the pricing engine — what a comp has to be to count, the graded rule, where the numbers are measured and where they are not, and the standing "measure before adding a rule" |
| `apps/app/CLAUDE.md` | **the app / Pro** — saved batch runs, prices you type, show stickers and the label file, where a card physically is |
| `apps/public/CLAUDE.md` | **Last Comp** — the hero, card pages and crawlers, liquidity, card art, the design system, and everything that had to be true before strangers could reach it |

They load automatically when you are working in that directory, and they do not
load when you are not — which is the point. **`scripts/` is at the root**, so
nothing below it loads for a session editing a check or an audit: the sitemap
above says which file to read for the rule a script is testing.

**A change to `packages/core` is still a change to both products, whichever
file you happened to be reading.** See the rule above.

## Checks

`npm run check` runs twenty-three table tests, no framework, non-zero exit on failure:

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
  and that robots.txt and the page metadata give the same answer.
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
