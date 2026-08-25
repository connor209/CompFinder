# Strengthening the app's pricing

Research, 2026-08-25, prompted by: automate more of the listing process, find
wider data, structure the maths better, make batch runs faster.

Numbers below are either **measured** (from the code, or from the four Neo-era
runs this week) or **researched** (from vendor docs, with sources at the end).
Proposals are marked as proposals. Nothing here is implemented.

---

## The finding that matters most

**You do not need better prices on every card. You need to know which prices to
look at.**

Measured on the 89-card run after this week's fixes:

| | rows | median price |
|---|---|---|
| no disagreement warning of any kind | **71** | £2.49 |
| warned about themselves | 18 | £5.74 |

Every remaining bad price was in the 18. The tool already separates them — it
just presents all 89 identically and leaves you to read 89 notes.

**Proposal: a confidence gate, and a review queue.** A row passes unattended
when it has ≥N sold comps, no disagreement flag, and the sold figure agrees
with the live market. Everything else goes to a queue. On this run that is
**80% straight through, 20% needing eyes** — and the 20% is the part where
your judgement is actually worth something.

That is the automation lever. Everything below is in service of making the gate
trustworthy enough to widen.

---

## Speed: 3x, and it is all in one change

Measured from `runBatchInner` and the observed request times. An 89-card run
makes ~104 SoldComps calls (89 sold, ~15 active).

| | wall clock |
|---|---|
| **sequential, as it works today** | **5.3 min** |
| 2 concurrent, paced at 60/min | 1.7 min |
| 3 concurrent, paced at 60/min | 1.7 min |
| the floor — SoldComps' documented 60/min | 1.7 min |

**Three at a time is enough.** Past that the rate limit binds, so more
concurrency buys nothing and only risks 429s. The run is currently sequential
with a 1.2s sleep between cards, which is roughly 3x slower than the supplier
actually allows.

`scripts/lib/pace.mjs` already implements exactly the pacer this needs — a
floor between calls, a ceiling per hour, real backoff on push-back — and the
app does not use it. Migration 021 put a leaky bucket in Postgres for the same
job on the public side.

**Proposal:** a worker pool of 3 over the item list, sharing one pacer. Results
still stream in as they land, so the screen behaves as it does now.

## Quota: the bigger win is not spending it twice

**The app has no cache at all.** Every run re-fetches everything.

This week you priced the same list four times while we tuned:

| | calls |
|---|---|
| four runs, as it works today | **417** |
| four runs, with a 24h cache | **104** |

Last Comp has cached sold comps for 24 hours since it was written
(`soldcomps_cache`, keyed on the query string). The app pays full price every
time, including for the two runs that differed only in a rule I had changed.

**Proposal:** reuse the same table and the same 24h TTL, keyed on the query
plus the search filters. A re-run inside a day becomes free and near-instant,
which also makes tuning cheap in a way it currently is not.

---

## Wider data: what is actually available

### eBay Browse API — already built, already free, currently unused for pricing

`apps/app/lib/ebay.js` has `browseActiveListings()`: eBay's own Browse API,
`EBAY_GB`, using an **app-level token** — no user OAuth needed. Only the
Arbitrage tab calls it.

Meanwhile every active-listing check in the batch spends a SoldComps request.

Browse is **5,000 calls/day free** on a standard keyset. Moving the active
checks there makes them free, first-party rather than scraped, and removes the
quota argument against checking *every* card against the live market instead of
just the suspicious ones — which is what caught Sunkern (£19.49 → £2.49) and
would have caught Golbat (£29.99 on a card listed at £3.48).

**This is the highest value-per-hour change on the list.** The client is
written; the pricing path just does not call it.

### eBay Marketplace Insights API — the official sold data

90 days of real sold history, first-party. It is a **Limited Release** API
needing business-level approval, and developers report being refused with
"major partners only". Worth an application given you are a real seller with
volume, but not a plan.

If it ever landed it would replace SoldComps entirely — same data, from the
source, no scraping question.

### TCGplayer — closed

No new API keys since 2024. Existing keys still work. US market anyway, so
weakly relevant to eBay UK listing prices.

### Cardmarket — the interesting second opinion

No official open API, but **TCGdex exposes Cardmarket and TCGplayer prices free
with no key**, and paid wrappers exist. Cardmarket is the European market, and
per `CLAUDE.md` your catalogue is already Cardmarket-derived — so the join is a
`cardmarket_id` you already store.

This is not a replacement for sold comps. It is a **sanity ceiling from a
different source**: a card whose eBay comps say £29.99 and whose Cardmarket
trend says £2 is the Golbat failure, catchable without spending an eBay call.

### Your own sales — the best comps you have and you are not using them

The app already holds `sell.fulfillment.readonly` and syncs eBay orders
(`/api/ebay/sales/sync`). Your own completed sales are the highest-quality comp
available: your condition standards, your photos, your postage, your market.
Nothing feeds them back into pricing.

**Proposal:** when a card being priced matches something you have sold, weight
that sale heavily and show it. "You sold this for £3.20 in June" is worth more
than four strangers' listings, and it costs nothing — the data is already in
the database.

---

## Structuring the maths better

Ranked by expected value, not by how clever they are.

### 1. Condition is being ignored, on every card

`poolConditionsBelowPence: 1500` pools NM, LP and MP together under £15 — which
is most of your stock. An MP card and an NM card of the same number get the
same recommended price.

The CSV carries a condition per card, and `pricing.js` already parses condition
out of comp titles. The multiplier could be **learned from the comps
themselves** per card, or per set, rather than assumed.

This is a systematic error on nearly every row, and probably the largest
remaining source of per-card inaccuracy after this week's fixes.

### 2. Price in log space

Card prices are log-normal — a £2 card and a £200 card have similar *relative*
spread. Every threshold in the engine is a ratio already (8x, /12, 3x q3/q1),
which is log-space reasoning done with multiplication. Making it explicit — a
median and a median-absolute-deviation on log prices — would replace three
hand-tuned constants with one, and behave the same at both ends of the market.

**Proposal only, and the kind that must be measured before it ships.** It would
change every price. `recurse-batch.mjs --corpus` over a downloaded run is
exactly the tool for judging it, and now costs nothing to run.

### 3. Sold and active together, not either/or

Today the active market is a fallback or a veto. The two figures answer
different questions — what it *went* for, what it is *available* for — and both
matter to a listing price. A card selling at £3 with nothing listed under £8 is
a different opportunity from one selling at £3 against forty listings at £2.50.

The engine already computes both. It just throws one away.

### 4. Use the history you are already writing

`price_checks` stores every priced card with its price and date. A card priced
repeatedly has a series, and a new price far off its own history is a flag that
needs no external data at all. Currently the table is only read to show what
you last priced something at.

---

## What I would do, in order

**1–3 shipped 2026-08-25.** The table is kept as written so the estimates can
be judged against what actually happened; 4–8 are still proposals.

| | change | effort | why |
|---|---|---|---|
| 1 ✅ | Active checks via the **Browse API** | small — client exists | frees the quota argument; makes the live-market check universal |
| 2 ✅ | **24h cache** on comps | small — mirrors Last Comp | four runs cost one; tuning becomes free |
| 3 ✅ | **3-way concurrency** + a gate | small | 5.3 min → 1.7 min |
| 4 | **Confidence gate + review queue** | medium | 80% of rows stop needing you |
| 5 | **Condition multipliers** | medium, needs measuring | the largest remaining per-card error |
| 6 | **Your own sales as comps** | medium | best data you own, currently unused |
| 7 | Cardmarket cross-check | medium | second source, catches the Golbat class |
| 8 | Log-space estimator | small code, large blast radius | do last, and only against a corpus |

1–3 are independent, low-risk, and together turn a 5-minute run that costs 104
calls into a 1.7-minute run that often costs none.

## Sources

- [eBay Browse API](https://developer.ebay.com/api-docs/buy/static/api-browse.html) · [rate limits](https://developer.ebay.com/api-docs/developer/analytics/types/api:RateLimit)
- [eBay Marketplace Insights API overview](https://edp.ebay.com/api-docs/buy/marketplace-insights/static/overview.html) · [access discussion](https://community.ebay.com/t5/eBay-APIs-Talk-to-your-fellow/Marketplace-Insights-API-access/td-p/34838736/)
- [TCGplayer: how to get pricing data](https://help.tcgplayer.com/hc/en-us/articles/201577976-How-can-I-get-access-to-your-card-pricing-data) · [API closed to new developers](https://tcgapi.dev/compare/tcgplayer-api/)
- [TCGdex market prices (Cardmarket + TCGplayer, no key)](https://tcgdex.dev/markets-prices) · [Cardmarket API wrapper](https://cardmarketapi.com/)
- [SoldComps](https://sold-comps.com/) · [their own alternatives comparison](https://sold-comps.com/alternatives)
