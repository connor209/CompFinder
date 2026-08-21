# Releasing "Search Last Solds" as a free, ad-supported public site

Research report, requested before building. Question: can the Quick Search
deep-dive be carved out as a standalone one/two-page public site, monetised
with ads, assuming the SoldComps key problem is solved?

## TL;DR

- **Technically: yes, and it's a small job** — maybe a week or two. The pricing
  engine (`lib/pricing.js`) and the catalogue are already source-agnostic and
  auth-free; the parts that need auth (inventory, eBay write-back, history) are
  cleanly separable from the parts that don't.
- **The unit economics work, and by more margin than expected.** SoldComps'
  Scale plan is $79/mo for 50,000 requests ≈ **£0.0012 per API call**. One
  ad-bearing pageview at a £2 RPM is **£0.002**. So display ads cover the data
  cost roughly 1.6× *even with zero caching* — and caching should take 60–80%
  of calls off the bill.
- **But display ads are the small half.** eBay Partner Network pays ~3% of sale
  price on trading cards. Our audience is half buyers, arriving with purchase
  intent, and we already render "view this listing" links. One attributed £35
  sale ≈ £1.05 ≈ **500 ad impressions**. EPN is very likely the larger revenue
  line, and it costs nothing to add.
- **The real constraint is traffic, not margin.** At 1,600 searches/day the
  thing makes roughly £200–£700/month combined. At a few hundred a day it makes
  pocket money. Everything therefore hinges on acquisition.
- **Which is why a two-page site is the wrong shape.** A two-page SPA has
  nothing for Google to index, and AdSense frequently rejects thin tool sites
  outright. The 395k-row catalogue we already hold is the asset: generate a
  server-rendered page *per card*, and the same build becomes an indexable site
  with a real content surface. Same code, ~10× the outcome.
- **The remaining blocker is genuinely a blocker**, but smaller than it looked —
  see "The API key question" below. SoldComps now state plainly that every
  plan, including free, permits commercial use. What they don't address is
  redistribution. Three specific questions need a written answer.

---

## What "Search Last Solds" is, in code

The feature lives in `app/panel/QuickSearch.js` (912 lines). A search does:

1. Resolve typed text → a catalogue card (`/api/catalog/resolve`, `/api/catalog/search`,
   with `/api/cards/lookup` and `/api/mtg/search` as fallbacks/art sources)
2. Build a per-game eBay query (name + collector number + set code + language)
3. Fire **two** `/api/soldcomps` calls in parallel — sold, and active (`sold=false`)
4. Run both through `CompFinderPricing.recommend()` — exclusions, recency
   weighting, condition and graded splits, catalogue-signal splits
5. Render: recommended price, confidence badge, trend chart, UK/worldwide sold
   list with links, active asking price

### What carries over unchanged

| Piece | File | Notes |
|---|---|---|
| Pricing engine | `lib/pricing.js` | No auth, no DB, no network. Pure. |
| SoldComps normalisation | `lib/soldcomps.js` | Already standalone |
| Catalogue reads | `app/api/catalog/*` | `card_catalog` is already public-readable (migration 005) |
| Trend chart | `TrendChart` in `QuickSearch.js` | Self-contained SVG, no deps |
| Name cleaning, marketplace links | `lib/cardname.js`, `lib/marketplace.js` | Pure |

### What has to be stripped

- `/api/ebay/my-listings` — the "you already have this listed" banner
- `saveHistory()` → `price_checks` insert
- `ListForm` and the whole list-to-eBay path
- `createClient()` / Supabase auth throughout
- `PROTECTED_PATHS` in `middleware.js` must not cover the new route

### What has to be built new

1. **A public `/api/soldcomps`** — the current route (`app/api/soldcomps/route.js`)
   reads the key from `profiles.soldcomps_api_key` for the logged-in user and
   401s otherwise. Public means one server-side key in an env var.
2. **A cache table.** There is none today — every search is a live API call.
   This is the single highest-value addition; see below.
3. **Abuse protection.** A public unauthenticated route that spends money per
   call will be scraped within days. Needs IP rate limiting *and* a bot check
   (Turnstile is free), plus cache-first ordering so a repeat query costs
   nothing regardless of who asks.
4. **Consent management** — a Google-certified CMP is mandatory for serving
   personalised ads to UK/EEA traffic. Plus `ads.txt` and a privacy policy
   update (`app/privacy/page.js` exists but says nothing about ad cookies).

---

## The unit economics

### Cost

SoldComps published pricing:

| Plan | Requests/mo | Price | Per request |
|---|---|---|---|
| Basic | 100 | free | — |
| Starter | 2,000 | $9 | $0.0045 |
| Growth | 10,000 | $29 | $0.0029 |
| Scale | 50,000 | $79 | **$0.00158** (~£0.0012) |

Custom pricing above 50,000.

Two things cut the per-search cost immediately:

- ~~**Drop the parallel active-listings call.**~~ **Corrected — keep it.** The
  first draft of this report suggested dropping it to halve the bill. That was
  wrong once affiliate revenue is in the picture: the active call is the one
  that returns *buyable* listings, and those are what EPN actually pays on. It
  costs £0.0012 and can plausibly return 5–10× that. See the EPN section below.
  Cache it harder instead (a 1–3h TTL, since asking prices move faster than the
  90-day sold window).
- **Cache.** Card searches are extremely head-heavy — Charizard, Umbreon VMAX,
  Moonbreon, the current chase cards. A 6–24h cache keyed on the normalised
  query + marketplace + sold/active should plausibly hit 60–80% at any real
  traffic level. At 75%, effective cost per search falls to ~£0.0003.

The cache is also an asset in its own right: run it for a year and you own a
UK sold-price history that SoldComps' own 90-day window can't give you, which
feeds trend charts, "price 6 months ago", and alerts — none of which are
currently possible.

### Revenue

**Display.** A hobby/tools site with UK traffic realistically sits at £1–£4
session RPM on AdSense. At £2 and one ad-bearing pageview per search, that's
£0.002/search.

**Affiliate (EPN).** ~3% of sale price on trading cards. Every listing link the
deep dive already renders — the sold rows, the "search eBay" link, the active
listings — becomes an affiliate link. Attribution windows also mean a user who
clicks through and buys *something else* on eBay still counts.

Rough per-search value, wide but honest:

| | Pessimistic | Optimistic |
|---|---|---|
| Display (£1–£4 RPM) | £0.001 | £0.004 |
| EPN (2%→15% click, 5%→8% convert, £30–£35 basket) | £0.001 | £0.013 |
| **Per search** | **£0.002** | **£0.017** |
| Cost per search (75% cached, sold-only) | £0.0003 | £0.0003 |

So the margin per search is fine anywhere in that range. Scaled:

| Searches/day | Revenue/mo | SoldComps plan needed (75% cached) |
|---|---|---|
| 300 | £18 – £150 | Starter, $9 |
| 1,600 | £96 – £820 | Growth, $29 |
| 10,000 | £600 – £5,100 | Scale, $79 |

**The conclusion is that this is an acquisition problem, not a margin problem.**
Which reframes the whole build.

---

## Why not a two-page site

A two-page SPA has three specific problems:

1. **Nothing to index.** All the value is behind a JS-driven fetch. Google sees
   a search box. Organic traffic ≈ 0, and paid acquisition can't pay back at
   £0.01/search.
2. **AdSense approval risk.** Thin single-purpose tool sites are routinely
   rejected under "low value content". No approval, no display revenue at all.
3. **One pageview, many searches.** In an SPA, search #2 through #20 generate no
   new ad impressions. Refreshing ads on in-place content changes is a policy
   grey area best avoided.

All three are solved by the same change, and we already hold what it needs.

### Card pages

`card_catalog` holds ~395,000 rows across eleven games, already public-readable.
Give each card a real URL:

```
/uk/pokemon/sv3pt5-151/charizard-ex-199-165   → server-rendered
```

Each page: card identity from the catalogue, latest cached sold price, the
trend, recent sold rows, and the search box. Rendered server-side from cache —
no API call on a cold crawler hit, so Googlebot costs nothing.

This gives you, from one build:

- Hundreds of thousands of indexable pages targeting exactly the query people
  actually type ("charizard 4/102 value uk")
- A content surface substantial enough for AdSense approval
- A genuine page navigation per search → a legitimate new ad impression, no
  policy grey area
- Internal linking (set pages, "cards in this set", "similar price range")

Publish the top few thousand cards first, not all 395k — mass-publishing
near-identical thin pages is its own indexing problem. Expand as cache coverage
grows.

---

## Ad integration, concretely

**Placements that don't wreck the tool:**

| Slot | Where | Notes |
|---|---|---|
| Responsive leaderboard | Between search box and result | Above the fold but *below* the input — never above it |
| In-feed | Inside the recent-sold list, after row 3–4 | Matches list styling; strong performer |
| Sticky anchor | Mobile bottom | Usually the highest-RPM unit on mobile |
| Right rail | Desktop, beside the trend chart | Only at ≥1200px, otherwise it crowds the chart |

**Rules:**
- Reserve height for every unit. Layout shift hurts UX *and* Core Web Vitals,
  which feeds back into the SEO the whole model depends on.
- No interstitials, no vignettes, nothing between "press Search" and the price.
  The entire product promise is speed.
- Never place an ad where a mis-tap looks like a result row.
- Keep the ad-free experience as the paid upgrade — see below.

**Requirements before switching ads on:** certified CMP for UK/EEA, `ads.txt`,
updated privacy policy covering ad cookies, and a working consent-mode
integration.

**EPN is the priority, not AdSense.** It's approved faster, has no content
threshold, and pays more per user here. Add it to every outbound eBay link in
`lib/marketplace.js` and the sold-row links in the deep dive. Do this first,
regardless of what happens with display.

---

## eBay Partner Network — how it works, and how we'd wire it in

### The mechanics

EPN is eBay's own affiliate programme. You apply, get a **campaign ID** (a
10-digit number), and from then on any link you send to eBay earns you a cut of
whatever that visitor buys — provided the tracking parameters are on the URL.

**The link format.** There's no link-shortener or redirect service you have to
route through; you append query parameters to the ordinary eBay URL you were
already linking to:

| Param | Value | Notes |
|---|---|---|
| `mkevt` | `1` | Event type — 1 = click |
| `mkcid` | `1` | Channel — 1 = EPN |
| `mkrid` | `710-53481-19255-0` | Rotation ID, **per marketplace**. This is the eBay UK one. |
| `campid` | your 10-digit ID | Required |
| `toolid` | `10001` | Default |
| `customid` | free text, ≤256 chars | Optional. Your own sub-ID — this is how you find out *which* pages earn. |

```
https://www.ebay.co.uk/itm/123456789?mkevt=1&mkcid=1&mkrid=710-53481-19255-0&campid=XXXXXXXXXX&toolid=10001&customid=card-sv3pt5-199
```

That's the whole integration. It works on item URLs, search URLs, category
URLs — anything on eBay.

**Attribution.** Last click, 24-hour cookie. Practically:

- The visitor doesn't have to buy the card you linked. Anything they buy on
  eBay in the next 24 hours counts.
- If they later click someone else's EPN link, that partner takes it — last
  click wins.
- Qualifying-transaction windows differ by format: ~24h for Buy It Now, up to
  10 days for auctions. So an auction they click today and win next week still
  pays.

**What you're paid.** A percentage of GMB (the purchase amount), by category,
with a per-transaction earnings cap. Trading cards / collectibles is commonly
cited around **3%** — verify against the current PDF rate card before modelling
it, since eBay have changed the basis before (it used to be a share of eBay's
fee revenue, which is a *much* smaller number).

**Getting paid.** $10 minimum threshold, paid on the 10th of the month for the
prior month, by bank transfer or PayPal.

### Why it fits this product unusually well

Every other affiliate site has to manufacture purchase intent. We don't:
someone typing "Charizard 4/102" into a sold-comps tool is already mid-decision
about buying or selling that exact card, and we're showing them a price and a
list of listings. The click-through is native to the product, not bolted on.

The maths, once more: 3% of a £35 card is £1.05. At a £2 display RPM that's
**500 ad impressions from one sale.**

### The important asymmetry: sold links don't pay, active links do

This is the bit that changes what we build.

A **sold** comp links to an *ended* listing. Nobody can buy it. It still earns
if the visitor then browses on and buys something within 24h — eBay's
related-items module on ended listings is decent at this — but it's incidental.

An **active** listing links to something with a Buy It Now button. That's the
revenue.

And right now we throw those away. `app/panel/QuickSearch.js` fires the
`sold=false` call, runs it through `recommend()`, and renders exactly one
sentence from it — *"Currently listed at a median £X asking (N listings)"* —
while `view.active.included` is sitting there in memory holding N live,
buyable listings, each with `_source.url` already populated by
`lib/soldcomps.js`'s `mapItem`.

**So the single highest-value change in the whole plan is roughly fifteen lines:**
render the active listings as actual rows, cheapest first, each an EPN link.
"Recent sales" tells them what it's worth; a "Buy one now — from £X" module
right underneath tells them where to get it. That's the money module, and the
data is already loaded.

### Where the links go

| Location | File | EPN? |
|---|---|---|
| Active listing rows (**new**) | `QuickSearch.js` active panel, ~line 890 | ✅ the priority |
| "🔍 eBay ↗" button | `QuickSearch.js:770` via `ebaySearchUrl()` | ✅ |
| Sold comp rows | `QuickSearch.js:880`, `:140` | ✅ low yield, free to add |
| Arbitrage results | `Arbitrage.js:243` | ✅ |
| Batch comp rows | `Panel.js:1348` | ✅ |
| **The user's own listings** | `Inventory.js`, my-listings banner, `ListForm.js:122` | ❌ **never** |

That last row matters. Putting affiliate tracking on links to the user's own
eBay listings is self-referential clicking, and it's the fastest way to get an
EPN account terminated. Keep EPN strictly on comps and third-party listings.

### Implementation sketch

One small module, since the rule is "append params to any eBay URL, and only an
eBay URL":

```js
// lib/epn.js
const MKRID = { "ebay.co.uk": "710-53481-19255-0" };  // per-marketplace

export function epnLink(url, { customId, site = "ebay.co.uk" } = {}) {
  if (!process.env.NEXT_PUBLIC_EPN_CAMPID) return url;   // no-op until approved
  try {
    const u = new URL(url);
    if (!/(^|\.)ebay\.[a-z.]+$/.test(u.hostname)) return url;  // never tag non-eBay
    u.searchParams.set("mkevt", "1");
    u.searchParams.set("mkcid", "1");
    u.searchParams.set("mkrid", MKRID[site] || MKRID["ebay.co.uk"]);
    u.searchParams.set("campid", process.env.NEXT_PUBLIC_EPN_CAMPID);
    u.searchParams.set("toolid", "10001");
    if (customId) u.searchParams.set("customid", customId.slice(0, 256));
    return u.toString();
  } catch { return url; }
}
```

Notes on the details:

- **The env-var guard** means you can wire every link site *now* and it stays a
  no-op until the campaign ID exists. No second pass through the codebase.
- **The hostname check** is deliberate — `lib/marketplace.js` also builds
  Cardmarket URLs, and tagging those with eBay params would be nonsense.
- **`customid` is free reporting.** Use it: `search`, `cardpage`, `arbitrage`,
  or the catalogue ID. Without it you know you earned £40 last month; with it
  you know the card pages earned £38 of it and the arbitrage tab earned £2, and
  you build accordingly.
- **`rel="sponsored noopener noreferrer"`** on every EPN anchor. Currently the
  code uses `rel="noopener noreferrer"`. Adding `sponsored` is Google's stated
  requirement for affiliate links, and it matters *a lot* here: the plan is to
  publish hundreds of thousands of card pages each carrying a dozen affiliate
  links. Untagged, that's a textbook manual-action trigger — it would put the
  SEO strategy and the affiliate revenue at risk simultaneously.
- **Disclosure.** UK ASA/CAP rules require it to be clear and up front. A line
  in the footer plus a short note on the buy module ("We may earn a commission
  on eBay purchases — it never affects the prices shown") covers it.

### Application

Apply at partnernetwork.ebay.com. They review the site, so apply once the
public page is live and has a privacy policy and disclosure in place — not
before. Approval is generally much easier than AdSense: no content-volume
threshold, and a genuine card-pricing tool is exactly the kind of traffic they
want. Which is why this should ship **before** display ads, not after.

---

## The API key question

This is the crux, and the position has moved since `app/api/soldcomps/route.js`
was written. That route's comment records a hosted-shared-key model being
"explicitly deferred pending written clarification". SoldComps now state
plainly on their own site that **every plan, including free, permits commercial
use** — "build it into a paid SaaS, an internal tool, a client deliverable, a
mobile app, whatever".

What they still don't address anywhere public is *redistribution*. So the ask
isn't "may I commercialise" — that's answered. It's three narrower questions,
and they want a written answer, ideally on the same email thread:

1. May a **single server-side key** serve anonymous public end users, rather
   than one key per identified customer?
2. May responses be **cached in our own database** and served from cache to
   later visitors — including cache older than the 90-day live window?
3. May **individual comp rows** (title, price, date, listing link) be displayed
   publicly, or only derived aggregates like the recommended price?

Worth noting that a *free* ad-supported page is an easier case to make than the
paid SaaS they already permit — you aren't reselling access to the API, you're
giving away a derived answer. If they push back, the fallback that keeps most
of the value is to publish only the derived output publicly (price, confidence,
trend shape) and gate the individual comp rows behind an account.

**A note on going direct to eBay:** worth ruling out now. eBay's Marketplace
Insights API is the official sold-data source, but as of 2026 it's a Limited
Release that eBay's own docs describe as restricted and not open to new users —
community reports say access is effectively major-partners-only. Not a route to
plan around. The Browse API for *active* listings is generally available and
free, so the active-price half could move off SoldComps entirely, which would
cut the API bill and remove one ToS question.

---

## Risks worth naming

- **eBay's own sold filter is free.** The differentiator is entirely
  `pricing.js` — junk-comp exclusion, graded splitting, reverse-holo handling,
  recency weighting, catalogue resolution. The marketing has to lead on "the
  right price", not "sold listings", or there's no reason to visit.
- **Established competition** — 130point, PriceCharting and similar already own
  much of this space, though weighted to US/sports. UK-first TCG is a
  defensible niche.
- **Scraper abuse** burning quota. Mitigated by cache-first + Turnstile + IP
  limits, but it needs to be in v1, not bolted on.
- **Platform dependency squared** — SoldComps scrapes eBay; you depend on
  SoldComps. Two links in the chain, neither under your control. The cache is
  partial insurance.
- **AdSense rejection** is a real possibility until the card pages are live and
  indexed. Ship EPN first so there's revenue either way.

---

## Suggested phasing

**Phase 1 — make it possible (no public launch)**
1. Cache table + cache-first read in a new public soldcomps route
2. Server-side key in env, Turnstile + IP rate limiting
3. Send SoldComps the three questions above

**Phase 2 — the public tool**
4. Carve `QuickSearch` into a public component: strip auth, my-listings,
   history, ListForm; drop the parallel active call to a button
5. Public route excluded from `middleware.js` protection
6. EPN links throughout, privacy policy update

**Phase 3 — make it worth something**
7. Server-rendered card pages from `card_catalog`, top few thousand first
8. Sitemap, internal linking, canonical URLs
9. AdSense application once indexed; CMP + ads.txt; place units per above

**Phase 4 — the upsell**
10. "Remove ads, price a whole pile at once, track your inventory" → the
    existing CompFinder app. The free page is the top of that funnel, and the
    subscription is probably worth more than the ads.
