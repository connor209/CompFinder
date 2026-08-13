# CompFinder — Improvement Backlog

A research pass on where CompFinder could go next, informed by the current
codebase and comparable tools (PokePulse, GetCollectr, PriceCharting,
RareCandy). Organised into **Done this session**, then **Now / Next / Later**
by value-vs-effort. Items marked ⚠ need your input, a DB migration, or an
external data source before building.

---

## ✅ Done this session (on branch `claude/compfinder-web-git-vercel-98zscy`)

- **Repricing intelligence** on My Listings — per-card market-vs-ask with
  over/under/in-line verdict, "Price visible" batch pricing, "Biggest
  opportunity" sort.
- **Inventory stats header** — active listings, unique cards, inventory value.
- **Duplicate condensing** — same card + same price collapse to one card with a
  ×N badge, expandable to individual listings.
- **Sort/filter** on inventory + **SKUs** shown (per-listing in the expanded view).
- **Cross-stream deep dive** — jump from a listing straight into Quick Search.
- **Batch results redesigned** as cards (with a Table toggle preserved).
- **1000-row cap fixed** (paginated inventory read).
- **High-quality landing page** at `/` (hero, features, problems, how-it-works).
- **SEO/OpenGraph metadata + favicon**.
- **Quick Search now saved to history** (was batch-only).
- **Inventory CSV export** with repricing columns.
- **Typeahead reliability** — outside-click close (fixed the "needs a click" quirk).

---

## 🔜 Now — high value, low/medium effort, low risk

1. **Sell-through / liquidity indicator.** We already fetch sold *and* active
   comps in the deep dive — surface "how fast does this move?": sold count in
   90d and a sell-through ratio (sold vs currently listed). This is the single
   most reseller-useful metric competitors show and we're one small step away.
2. **Store last market price per listing.** Persist repriced values on
   `ebay_listings` so we can show an inventory-wide "£X potential uplift" total
   and skip re-pricing on every visit. ⚠ small migration.
3. **Aged-listing flag.** Flag listings live > 60/90 days ("stale") — eBay's
   Trading API exposes the start time. Great for "what should I relist?".
4. **Theme toggle everywhere.** The light/dark toggle lives only in the panel;
   add it to the landing page and auth pages.
5. **Onboarding checklist.** First-run nudge: add SoldComps key → connect eBay →
   run first search. Reduces the "empty app" drop-off.
6. **Graceful quota handling** in "Price visible" — stop early and report when
   the SoldComps quota is hit, rather than erroring per-card.
7. **OG share image.** Generate a proper social preview via `next/og` so shared
   links look professional.

## 🟡 Next — strong value, medium effort

8. **Graded vs raw pricing.** ⚠ Detect graded comps (PSA/BGS/CGC + grade) and
   price them separately, with a grade selector. Currently graded comps are just
   excluded — resellers of graded cards would get huge value here.
9. **Condition-aware pricing.** Show price bands by condition (NM/LP/MP/HP)
   instead of one blended number.
10. **Your recent eBay *sold*.** Pull your own sold history (not just active) so
    you can see what you actually got vs current market.
11. **Watchlist / saved cards.** ⚠ new table. Save cards to monitor; foundation
    for alerts.
12. **Portfolio value over time.** ⚠ snapshot storage. Chart inventory value
    trend — a headline dashboard feature.
13. **Scheduled auto-sync.** Nightly inventory refresh via a cron so the cache
    (and "already listed?" checks) stay fresh without manual Sync.
14. **PWA install.** Manifest + icons so mobile users can add CompFinder to their
    home screen (fits the mobile-first push and the camera feature).

## 🔵 Later — high value, higher effort or dependencies

15. **eBay write-back (Phase 2).** Revise a price or relist directly from
    CompFinder. ⚠ needs eBay *write* scopes + re-consent + careful testing.
16. **Bulk reprice.** "Apply market price to N selected listings" (builds on 15).
17. **Price alerts.** Notify when a watched card's market moves past a threshold.
    ⚠ needs email/push + a scheduler.
18. **Multi-marketplace.** Follow the UK/Worldwide scope through inventory and
    pricing (currency-aware), and support other eBay sites.
19. **Chunked/background sync for > 5,000 listings.** Current sync caps at 5,000
    to avoid Vercel timeouts; move to a queue/background job for big sellers.
20. **Non-English card database.** Header art for Japanese/Korean prints (the
    typeahead is English-first via pokemontcg.io today).

## 🛠 Infra / correctness (worth doing regardless)

- **eBay sync is delete-then-insert** (brief empty window). Switch to upsert +
  delete-stale for atomicity.
- **Supabase Auth URL config + custom SMTP** — for reliable external-signup
  deliverability (confirmation emails).
- **Rate limiting** on API routes (`/api/soldcomps`, `/api/identify`) to protect
  quota and keys.
- **Error monitoring** (e.g. Sentry) for the live app.
- **Short-lived cache** of sold results per query to save SoldComps quota on
  repeat lookups.

---

## Notes on data sources

Several "Later" items (graded pops, richer trend history, non-English art) hinge
on data we don't have yet. Options worth evaluating: PriceCharting API, TCGplayer
API (US-centric), and the graded-population feeds. Worth a dedicated spike before
committing to any of the graded/population features.
