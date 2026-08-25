# Comp Finder — web version — setup

## Repo layout

The repo is an npm workspace with two deployables sharing one pricing engine:

```
packages/core/   pricing, soldcomps, cardname, marketplace, epn, catalog, setmatch
apps/app/        CompFinder — the business tool (eBay OAuth, inventory, batch)
apps/public/     the free public price page (not built yet)
supabase/        migrations, shared by both apps
```

`packages/core` is the rule that keeps this honest: nothing in it may import
React, Next, Supabase, or app code. That's what makes it shareable, and it's
why extracting it was a file move rather than a rewrite. A second copy of
`pricing.js` would drift the moment either app touched it.

Run everything from the repo root:

```
npm install          # installs both workspaces, links @compfinder/core
npm run dev          # apps/app
npm run build        # apps/app
npm run dev:public   # apps/public, once it exists
```

**Deploying.** Each app is its own Vercel project, both pointed at this repo
with a different **Root Directory** (`apps/app`, `apps/public`) and
"Include files outside the root directory" enabled so `packages/core`
resolves. Set an Ignored Build Step on each so a change to one app doesn't
rebuild the other. The cron entries in `apps/app/vercel.json` belong to the
business app only.

**Known wrinkle.** `packages/core` has no `"type"` field, because
`pricing.js` and `soldcomps.js` are CommonJS while the rest are ESM — exactly
as they were inside `lib/`. Bundled by Next this is fine. Running one of the
ESM files under bare `node` prints a MODULE_TYPELESS_PACKAGE_JSON warning;
harmless, and not worth changing the pricing engine's module semantics to
silence.

## What's actually been verified, and what hasn't

Same honesty this whole project has run on, worth stating plainly here
too: this sandbox has no network access, so `npm install` and `next dev`
have never actually run. What *has* been verified, for real, not by
inspection:

- Every `.js` file, including every JSX-containing React component, parses
  correctly — checked with the real TypeScript compiler's `transpileModule`
  (found available in this environment), not just eyeballed. The
  transpiled (JSX-removed) output was also independently syntax-checked.
- `packages/core/pricing.js`, `apps/app/lib/carduploader.js`,
  `packages/core/soldcomps.js` import and
  run correctly via `require()`, exactly as they did in the extension —
  confirmed by actually calling them, not assumed from "they're pure JS."
- The full pricing pipeline was re-run end to end through the new
  active-listings path specifically (`sold=false` mode), using realistic
  data — this is what caught two real bugs before you'd have hit them:
  `mapItem` and the currency filter in `soldcomps.js` both only ever
  checked `soldPrice`/`soldCurrency`, which don't exist on active-mode
  responses (`currentPrice`/`currentCurrency` instead) — every active
  fallback would have silently priced from `NaN`, and non-GBP active
  listings would have slipped straight through the currency filter
  unfiltered. Both fixed and tested against realistic response shapes.

What genuinely hasn't run: `npm install` itself, and therefore `next dev`
actually booting. The Next.js/Supabase wiring follows standard, current
patterns throughout (App Router, `@supabase/ssr`'s documented cookie
pattern), but "follows the documented pattern" and "confirmed booting" are
different claims, and only the first one is true yet. That first `npm run
dev` is the real test, the same way it's been for every other piece of
this project.

## Steps

1. **Install dependencies**
   ```
   npm install
   ```

2. **Create a Supabase project** at [supabase.com](https://supabase.com). The
   free tier's 500 MB is enough to develop against; the live project outgrew it
   and is on Pro as of 2026-08-25 (see CLAUDE.md).

3. **Run the schema.** Supabase dashboard → SQL Editor → New query → paste
   the contents of `supabase/schema.sql` → Run.

4. **Copy environment variables.**
   ```
   cp .env.local.example .env.local
   ```
   Fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   from Supabase dashboard → Settings → API.

5. **Run it locally**
   ```
   npm run dev
   ```
   Visit `http://localhost:3000` — should redirect to `/login`.

6. **Sign up**, check your email for the confirmation link (Supabase's
   default auth flow), sign in, then add your SoldComps API key under
   Settings before running a batch.

7. **Deploy to Vercel** — connect the repo, add the same two env vars in
   Vercel's project settings, push. No other configuration needed.

## What's deliberately not built yet

- **The rest of `options.html`'s threshold settings** (postage-outlier
  multiplier, set-mismatch ratio, wide-spread threshold, etc.) — the
  Settings page covers the two most operationally important ones (API key,
  item location default) as a working example of the pattern. Every other
  threshold follows the identical shape: a form field, merged into the
  same `settings` JSONB column, no new plumbing required.
- **Server-side SoldComps budget tracking** — currently `localStorage`,
  mirroring what `chrome.storage.local` did in the extension. Moving this
  into the `profiles` table (a couple of columns, updated from the API
  route) would make it survive a cleared browser and work correctly across
  multiple devices — a real upgrade, not currently necessary at this
  scale, no reason to have built it before there's a reason to.
- **The hosted-shared-key subscription/reselling model** — deliberately
  not built. This version uses bring-your-own-key throughout, the only
  model clearly covered by SoldComps' terms of service as written (see
  this conversation's terms check). Swapping in a shared-quota model later
  is a change to what `app/api/soldcomps/route.js` does internally
  (look up a shared key instead of the user's own), not a rearchitecture —
  worth building this way regardless of whether that email to SoldComps
  ever gets sent.
