# What EPN is likely to be worth

Research report, 2026-08-23; updated 2026-08-24 after the rebrand to Last Comp. Question: with the affiliate wiring already built
and inert, what does the public page realistically earn from eBay Partner
Network — given the competition, EPN's own published economics, and how we can
plausibly acquire traffic?

## TL;DR

- **The rate is confirmed, not guessed: 3% of GMB on trading cards**, per EPN's
  own category page, capped at $550 per transaction. The cap is irrelevant to
  us — it binds at a £14,000 basket.
- **The realistic unit is ~3p of commission per outbound click**, which is
  ~£0.0045 per search once you account for the fact that most searches never
  produce a click. That is about **2× what display ads would earn per search**,
  which matches the earlier report's ranking but is far less dramatic than its
  "one sale = 500 impressions" framing suggests: sales are rare, impressions
  are not.
- **£100/month needs roughly 740 searches a day.** That is the number worth
  internalising. Not 100, not 10,000 — a real but achievable content site.
- **Year one, honestly: £5–£50/month for the first six months, £50–£400/month
  by month twelve if the card pages index.** EPN becomes a line worth managing
  at ~3,000 searches/day and worth building around only above ~10,000.
- **One £10/month Pro subscriber is worth about 2,200 free searches of EPN.**
  The affiliate line is real money for zero marginal work, but the funnel to
  the app is the larger business by an order of magnitude. Price the free page
  accordingly: EPN pays for the hosting and the SoldComps bill, Pro pays for
  the effort.
- **Two things could zero it, and both are configuration.** The campaign ID
  must never be set on the `comp-finder` project, and the UK-only rotation
  silently discards any non-UK traffic we attract.

---

## The confirmed mechanics

| | |
|---|---|
| Rate, trading cards | **3% of GMB** (the purchase amount, not eBay's fee revenue) |
| Cap | $550 per qualifying transaction |
| Attribution | Last click, 24h for Buy It Now |
| Auctions | Bid within 24h, win within 10 days, still pays |
| Payment | $10 threshold, 10th of the following month |

Two of those matter more here than they would for general retail:

- **The basis is GMB.** eBay changed this in the past — the older model paid a
  share of eBay's *fee* revenue, which is roughly a tenth as much. Any figure
  found in an old blog post is probably on the wrong basis. 3% of the sale price
  is the current one.
- **The 10-day auction window is a genuine niche advantage.** A large share of
  card sales on eBay UK are auctions, and card buyers deliberate for days — the
  behaviour that murders a 24h cookie in most categories. Here a meaningful
  slice of clicks get ten days instead of one.

## The unit economics, built up rather than asserted

The chain is: search → outbound click → purchase within the window → 3%.

| Step | Pessimistic | Base | Optimistic | Why |
|---|---|---|---|---|
| Outbound CTR per search | 8% | **15%** | 25% | Six buy rows and a "See all" button sit directly under the price. But at least half of visitors are *sellers* checking what their card is worth, and they came for a number, not a listing. |
| Click → purchase (24h/10d) | 2% | **4%** | 7% | Marketplace clicks on a specific item the visitor just researched. Higher than content-site retail traffic (1–2%), lower than a cart. |
| Attributed basket | £15 | **£25** | £40 | UK Pokémon singles skew cheap, but attribution counts *anything* bought in the window, which drags the average up. |
| **Earnings per click** | £0.009 | **£0.030** | £0.084 |  |
| **Earnings per search** | £0.0007 | **£0.0045** | £0.021 |  |

**Cross-check:** published EPN benchmarks put a typical content-site EPC around
$0.06 (~4.5p). Our base of 3p sits just under that despite unusually warm
traffic — which is the right direction to be wrong in, given how cheap UK
Pokémon singles are relative to the electronics and sneakers that pull that
average up.

The earlier report's range (£0.001–£0.013 per search) sits almost entirely
inside this one. The difference is at the top: it under-modelled the optimistic
case because it assumed the sold rows were the link surface. The buy module now
exists, and it is the whole revenue story.

## What that scales to

Monthly EPN revenue, by traffic:

| Searches/day | Pessimistic | Base | Optimistic |
|---|---|---|---|
| 100 | £2 | £14 | £63 |
| 300 | £6 | £41 | £189 |
| 740 | £16 | **£100** | £466 |
| 1,600 | £34 | £216 | £1,008 |
| 3,000 | £63 | £405 | £1,890 |
| 10,000 | £210 | £1,350 | £6,300 |

Read it as: below ~300 searches a day this doesn't clear the $10 payout
threshold every month. At 740 it pays for SoldComps Growth ($29) and the
hosting with change. At 3,000 it is a real if modest income line. At 10,000 it
is the reason the site exists.

For orientation at the base case, £100/month means roughly **3,300 outbound
clicks and 130 attributed sales a month**. Each attributed sale is worth about
75p. Volume is the only lever that matters; there is no clever tweak that turns
75p into £7.

## Which traffic level is actually plausible

This is where the honest answer lives, and it is less comfortable than the
model above.

**The UK niche is no longer empty.** The earlier report named PriceCharting and
130point as US/sports-weighted and concluded UK-first TCG was defensible. As of
now the first page for UK Pokémon price-checking queries also carries
CardMetric UK, PACKRAT and PokePrices — all free, all UK-first, all doing
roughly the shape of thing the public page does. The niche is defensible on
*quality* (see below) but it is not unoccupied, and "free UK Pokémon price
checker" is not a phrase we can win by simply existing.

**Our differentiator is real but hard to put in a SERP snippet.** What we have
that a scraped price guide does not: junk-comp exclusion, graded splits,
UK-domestic versus worldwide as two separate numbers, collector-number-anchored
matching, a liquidity read measured over the window the data actually supports,
and caveats that fire when the match is weak. That is genuinely a better answer.
It is also six sentences long, and the competitor's page just shows a number.

**So the acquisition plan has to be the programmatic card pages**, as the
earlier report concluded — and those are slow. Realistic shape:

| Period | Searches/day | EPN at base |
|---|---|---|
| Months 1–3 (launch, no index) | 20–100 | £1–£14 |
| Months 4–6 (first pages ranking) | 100–400 | £14–£54 |
| Months 7–12 (if indexing holds) | 400–2,000 | £54–£270 |
| Year 2, if it works | 2,000–10,000 | £270–£1,350 |

The "if" in months 7–12 is doing a lot of work. Mass-published, near-identical
card pages are exactly what Google's helpful-content systems demote, which is
why the earlier report's advice to publish the top few thousand cards rather
than all 395,000 is a revenue decision, not a tidiness one.

**Verdict on the headline question:** treat EPN as covering costs in year one
and becoming a modest income line in year two. Anyone modelling it as the
reason to build the public page is modelling it wrong; the reason to build the
public page is the funnel into Pro.

## The comparison that reframes it

At the base case, one search is worth £0.0045 of affiliate commission. A single
Pro subscriber at £10/month is worth **2,200 searches**.

Which means a free page converting even 0.1% of its visitors into Pro trials
beats its own affiliate revenue several times over. Both lines are worth having
— EPN costs nothing to run once the campaign ID is set — but if a design choice
ever trades off "more outbound clicks to eBay" against "more visitors who
understand there's a batch tool behind this", take the second one every time.

## Two configuration risks that could zero the whole line

**1. The campaign ID must never be set on the `comp-finder` project.**

`NEXT_PUBLIC_EPN_CAMPID` is read once in `packages/core/epn.js`, which both
apps share — and `apps/app/.env.local.example` carries the same variable. The
two Vercel projects have separate environments, so this is avoidable, but it is
one dropdown away from happening.

If it is set on the app, these become affiliate links clicked by the account
holder: the QuickSearch "Buy one now" rows (`QuickSearch.js:935`), the sold-comp
rows, and the batch comp rows (`Panel.js:1440`). Inventory, the my-listings
banner, ListForm and Arbitrage are already deliberately untagged — but a "Buy
one now" module inside a single-operator tool fails the standing rule (*never
tag a link the account holder is expected to click*) for exactly the same
reason Arbitrage does. `docs/PUBLIC_SEARCH_ADS.md` marks those app call sites
✅, which was written before the public page existed and before the app grew a
buy module of its own. **Set the campaign ID on `compfinder-public` only.**
Commission on your own purchases ends the account, and a terminated account
makes every number in this report zero.

**2. The rotation is UK-only, and that is a silent discard.**

`MKRID` in `packages/core/epn.js` has one row, `ebay.co.uk`. A host with no
verified rotation is deliberately left untagged — the right default, but it
means any non-UK visitor who reaches a card page either clicks an untagged link
or clicks a `.co.uk` link they will not buy from. US card GMB is several times
UK's. If the card pages attract any US traffic at all (they will — card
searches don't respect borders), adding an `ebay.com` rotation and routing by
visitor geography is probably the single highest-yield EPN change available,
and it is a one-line addition to `MKRID` plus a routing decision. It is worth
doing *after* there is evidence of the traffic, not before: the prices are GBP
from UK comps, so a US visitor is being sent to the wrong marketplace for the
number they were shown, and that is a product question before it is a revenue
one.

## A third, smaller one: the scope decision costs EPN money

The public page is Pokémon-only, and correctly so — Yu-Gi-Oh and Magic price
badly here because sellers don't write the collector number. But it is worth
naming the revenue side of that decision: sports cards and Yu-Gi-Oh carry a
large share of eBay's card GMB, and sports baskets in particular run well above
£25. Set-anchored matching for another game isn't just a coverage improvement;
it is the main way the addressable pool of this revenue line grows without
growing traffic.

## What to measure, from day one

The wiring segments by `customid`, so this costs nothing. **Updated 2026-08-25**
— what shipped differs from the table this section first carried, which was
written before the buy module existed. There is no `sold-comp`: the sold rows
don't link out on either card screen, which is right, since an ended listing
earns only by incidental attribution.

Sub-IDs are built by `apps/public/lib/epn-tag.js` as `<slot>-<set>-<number>`,
e.g. `buy-hero-prismatic-evolutions-131`, so the dashboard answers two
questions rather than one:

| slot prefix | What it tells you |
|---|---|
| `buy-hero` | The money module — the cheapest-listing CTA. Should dominate. |
| `buy-row` | The listings table under it. If it beats the hero, the hero isn't picking the right listing. |
| `buy-see-all` | Whether people prefer to browse eBay themselves — if this beats `buy-hero`, our rows aren't the right rows. |

And the second question, which is the one that compounds: **filter by set
instead of by slot and you have per-page earnings.** That is the closest thing
to traffic data this site will ever have — the privacy page promises no
analytics and means it — and it is the input to what gets published next.

The two numbers to pull out of the EPN dashboard in month one are **EPC** and
**click-to-sale conversion**. Both are in the table above as assumptions; a
month of real data replaces the widest guesses in this report with facts, and
the whole model collapses to one multiplication after that.

Do not tune anything on the first month. Card buying is seasonal — set releases
and Christmas move it — and a month of launch traffic is not a sample.

---

# Marketing it, and disclosing it

Follow-on questions, same day: how do we acquire the traffic the numbers above
depend on, and do we publish that the links are affiliate links?

## Disclosure: yes, and it is not a close call

Four independent reasons, any one of which is sufficient:

1. **UK ASA/CAP.** An affiliate link is a material connection and must be
   disclosed clearly and up front — at the point of engagement, not buried.
2. **EPN's own Network Agreement** requires partners to disclose the
   relationship. Breaching it puts the account at the same risk that
   self-clicking does, and a terminated account makes this whole report zero.
3. **Google.** `rel="sponsored"` is the stated requirement for affiliate links.
   We already emit it via `EPN_REL`. At the scale the card-page plan implies —
   thousands of pages carrying a dozen eBay links each — undisclosed affiliate
   links are a textbook link-scheme manual action, which would kill the SEO
   plan and the affiliate revenue in the same stroke.
4. **It is a trust product.** The entire proposition is "this is what the card
   is actually worth". A visitor who discovers undisclosed monetisation on a
   price-advice site has been handed a reason to disbelieve the price. The
   existing copy already answers the fear that matters — *"It never affects the
   prices shown"* — because the suspicion a reader actually forms is "do they
   inflate prices to earn more commission?", not "are they earning anything".

Disclosure does not measurably cost clicks. Every established review and deals
site discloses.

### What is already right

| | Where |
|---|---|
| Point-of-click disclosure | `PriceSearch.js:913`, in the buy module footer |
| `rel="sponsored noopener noreferrer"` | `relFor()`, on every tagged anchor |
| "Not affiliated with eBay, Nintendo or The Pokémon Company" | `page.js:48` |

### Done, 2026-08-24

`apps/public/app/privacy/page.js` now exists with an `#affiliate` section, and
the one-line disclosure sits in the home footer rather than only behind a link
to it. Before that the site had no policy of its own — only the business app's,
which is a different Vercel project and never served this domain, so the link
404'd. EPN review the live site, and a dead affiliate-disclosure link is what a
reviewer clicks, so this was blocking the application rather than untidy.

**The contact address on it (`privacy@lastcomp.co.uk`) has to actually exist**
or the UK GDPR route is a dead end.

### One thing the disclosure now has to say

The page hides live listings that sit implausibly far below what a card sells
for — see "the hero is a minimum" in CLAUDE.md. Hiding a cheaper listing on a
page that earns commission on the ones it shows is exactly the shape of thing a
reader is right to be suspicious about, so the policy says plainly why it
happens and the page says how many. Silence there would be worse than the
listing.

## Marketing: there is nothing to market yet, and that is the answer

> **Superseded 2026-08-25 — kept for the reasoning, not the conclusion.** The
> premise below expired: `apps/public` is no longer one route. 455 cards across
> 92 sets are published and warmed, set pages carry the internal linking, the
> sitemap is submitted and indexing is open. The surface that markets itself
> exists, so "how do we market it" is now a real question with a different
> answer. See **`docs/MARKETING.md`**. The five numbered points below still
> hold as written and are carried forward there.

`apps/public` is one route, 53 lines, with no `sitemap`, no `robots`, no card
pages and page-level metadata only at the root. Phase 3 of
`PUBLIC_SEARCH_ADS.md` is unbuilt. So "how do we market it" today resolves to
"build the surface that markets itself", because the alternative — driving
traffic to a single-page tool — has no compounding and no second visit.

### 1. Card pages are the only channel that compounds

Everything else is a spike; this is the asset. What matters in the build:

- **Target the query people actually type**: `charizard 4/102 value uk`. Long
  tail, low competition, and the intent is already commercial.
- **Publish the set the data supports, not the catalogue.** The repo already
  measured this: the chase set prices at 100% with 15+ median comps and 90%
  image coverage; commons price at 5 comps and 84% coverage. Cards where the
  price is thin and the caveats fire are exactly the pages Google reads as
  thin. The coverage decision is already made for us by
  `scripts/wideset.json` — follow it rather than publishing 395,000 rows.
- **Ship the plumbing**: `sitemap.xml`, `robots.txt`, canonical URLs, per-page
  metadata, and cache-only rendering so a crawler hit costs no API call.

### 2. "We show our working" is the position, and it is defensible

CardMetric, PACKRAT, PokePrices and PriceCharting all show a number. We can
show why the number is right, and no competitor can copy that without building
the exclusion engine first. The most marketable thing in the product is already
on the page and under-sold: **"Show N listings we didn't count"**. Nobody else
shows their working. Alongside it, the UK-versus-worldwide split, the liquidity
band measured over a window we can actually defend, and the caveats that fire
when the match is weak.

"The price checker that tells you when it isn't sure" is a real position, and
it is the one the codebase has spent its effort earning.

### 3. Communities, carefully

UK Pokémon Facebook groups, r/PokemonTCGUK, the seller Discords, eBay seller
forums. Two rules: link the tool, never a tagged eBay URL — affiliate links in
communities get you banned — and disclose. The highest-value form is answering
"what's this worth?" posts with the actual answer plus the link. It does not
scale and it is how you get the first hundred searches a day and the only
early feedback you will get.

### 4. Content that is not a card page

Set-level pages ("every card in 151, by value"), "most valuable cards in X",
and new-set pages live *before* release day. These carry the search volume the
individual card pages don't, and they are what other people link to.

### 5. What not to do: pay for traffic

At £0.0045 of EPN revenue per search, a 5p click costs eleven times what it
returns. Paid acquisition can only ever be underwritten by Pro subscription
LTV, and only once that funnel is converting measurably. Until then, every
acquisition pound has to come from work rather than spend.

### 6. The upsell is the actual goal

One £10/month Pro subscriber is worth 2,200 free searches. The upsell block
exists (`page.js`, `#pro`) but pitches identically to everyone. The prospect
worth identifying is behavioural: someone pricing five cards in a session has a
stack, and a stack is what Pro is for.

## Sequencing, including the bit that is easy to miss

1. ~~**The SoldComps written answer.**~~ **Settled 2026-08-25 without asking** —
   see CLAUDE.md, "The SoldComps terms question". Their FAQ covers the shared
   key and the caching; the comp rows are eBay's data rather than theirs; and a
   question invites a policy where none exists. The domain is live and
   `/privacy` is reachable on it, so nothing here waits on them any more.
2. **The public privacy and disclosure page**, with the `#affiliate` anchor.
3. ~~**Apply to EPN**, set `NEXT_PUBLIC_EPN_CAMPID` on `compfinder-public`
   only.~~ **Done 2026-08-25** — campaign `5339194433`, on `compfinder-public`
   only, confirmed. Every number above stops being a model and starts being
   measurable from here.
4. **Card pages, sitemap, internal linking.** Months, not weeks, before it
   shows in the numbers.
5. **Communities**, in parallel with 4, for the first users and the feedback.
6. **AdSense** last, once there is a content surface to approve — and it is
   the smaller half regardless.

Steps 1–3 are the ones that convert built work into revenue. Step 4 is the one
that decides whether the revenue is £14 a month or £270.
