# Marketing Last Comp

Research report, 2026-08-25. Question: with the public page live on a domain,
indexed, and earning affiliate commission, how do we best acquire traffic?

This supersedes the marketing section of `docs/EPN_EXPECTED_RETURN.md`, whose
answer was *"there is nothing to market yet, and that is the answer"*. That was
correct when `apps/public` was one route and 53 lines. It no longer is.

## TL;DR

- **The surface exists now.** 455 cards across 92 sets, server-rendered with a
  price, set pages carrying the internal linking, sitemap submitted, indexing
  open since today. Every prerequisite the earlier report listed is built.
- **The EPN dashboard is the only per-page traffic signal this site will ever
  have**, because the privacy page promises no analytics and that promise is
  worth more than the data. As of today the sub-IDs carry the card, so it can
  be read by set. That is the measurement loop; there is no other one.
- **The compounding channel is set pages and the release calendar**, not more
  card pages. "Most valuable cards in *X*" carries volume an individual card
  page never will, and a new set is a recurring, predictable spike we can be
  first to because we can generate the page in minutes.
- **Publishing more cards is a $29 decision, not an effort decision.** The
  warmer costs one SoldComps request per card against a 2,000/month Starter
  ceiling shared with live visitors. This is the constraint most likely to be
  discovered as a 429 rather than decided.
- **The single largest gap is that nothing on Last Comp points at Pro.** One
  £10/month subscriber is worth 2,200 searches of affiliate revenue. The
  channel worth the most is the one that currently doesn't exist.
- **Do not pay for traffic.** At £0.0045 a search, a 5p click loses eleven
  times over. Paid is only ever underwritten by Pro LTV, which is currently
  unmeasured.
- **Timing argument for doing this now:** SEO lead time is roughly three
  months and card buying peaks in November–December. Work published in
  September lands for the peak. Work published in November lands for February.

---

## Where things actually stand

| | |
|---|---|
| Published cards | 455, across 92 sets (`apps/public/lib/published-cards.js`) |
| Biggest sets | Prismatic Evolutions 48, Pitch Black 25, Evolving Skies 23 |
| Indexing | Open since 2026-08-25; 450 URLs discovered in Search Console |
| Server-rendered price | Confirmed by URL Inspection — Googlebot sees it without JS |
| EPN | Live, campaign `5339194433`, `compfinder-public` only |
| Analytics | None, by promise |
| Path to Pro | **None** |

The last two rows are the whole report.

## The one number

From `docs/EPN_EXPECTED_RETURN.md`, base case: **£0.0045 of commission per
search**, and **one £10/month Pro subscriber is worth 2,200 searches**.

Read that as a ranking of every marketing decision available. Work that adds
searches is worth about a fifth of a penny each. Work that converts a searcher
into a Pro subscriber is worth 2,200×. Both are worth doing — EPN costs nothing
to run now that it is wired — but where they trade off, the funnel wins every
time, and it is not close.

The corollary is uncomfortable: **the channel with the highest expected value
is the one we have deliberately not built.**

## What we can measure, and what we deliberately can't

The privacy page says, in its own words: *"No analytics or measurement scripts.
We don't know how many pages you viewed or where you came from."* That is a
real promise on a product whose entire proposition is trustworthiness, and it
should be kept. It also means marketing here runs on two signals and no more:

**1. Search Console.** The Performance report's query list is the closest thing
to traffic data the site has, and it is genuinely good for this purpose: it
tells you which cards people search for, which is exactly the input to the
publishing decision. The Pages report is the risk indicator — *"Crawled —
currently not indexed"* at scale is the thin-content verdict on the whole
programmatic approach. *"Discovered — currently not indexed"* early on is just
a queue and means nothing yet.

**2. The EPN dashboard**, which as of today reports per card rather than per
module. `apps/public/lib/epn-tag.js` builds `<slot>-<set>-<number>`:

| Read it by | To answer |
|---|---|
| slot prefix (`buy-hero`, `buy-row`, `buy-see-all`) | Is the buy module the right shape? |
| set segment | **Which cards earn — so which to publish next.** |

The second is the new one and the one that compounds. Filter to
`prismatic-evolutions` and you know whether the 48 pages of it are carrying the
site or whether something else is.

**What neither gives you:** the conversion rate from search to Pro, because
there is nothing to convert to yet, and no session data to measure it with if
there were. That is a decision to take deliberately when the funnel is built —
either accept a coarse server-side count of a single event, with the privacy
page changed first as it already promises it will be, or accept that the funnel
is unmeasured. Do not let it get decided by accident.

## The plan, ranked

### 1. Read the dashboard by set, monthly, and publish accordingly

This is now free and it is the only closed loop in the whole plan. Search
Console says what people look for; EPN says what earns; the intersection is the
next tranche of cards. Everything below is a hypothesis until this has a
month of data behind it.

**Do not tune anything on the first month.** Card buying is seasonal — set
releases and Christmas move it — and a month of launch traffic is not a sample.

### 2. Set pages and the release calendar

`/set/<name>` already exists and lists every card in a set by value. Two things
follow from that which individual card pages can't do:

- **"Most valuable cards in *X*" carries search volume a single card never
  will**, and it is the page other people link to. Individual card pages are
  long-tail; set pages are the head.
- **A new set release is a recurring, predictable, high-volume spike**, and it
  is the one place we have a structural advantage: we can generate a set page
  from the catalogue in minutes, before the content sites have finished opening
  packs. Publish ahead of release day, every release, as a standing job.

This is the highest-leverage *content* work available and it reuses everything
already built.

### 3. Expand the published set — but price it first

The publishing decision has a hard cost ceiling that is easy to miss:

| | |
|---|---|
| SoldComps Starter | 2,000 requests/month, shared with live visitors |
| Warming 455 cards | 455 requests — one full cycle a month |
| Headroom today | ~1,500 for people actually using the site |

So "publish 1,500 cards" is not an effort decision, it is a **$29 Growth-plan
decision**. Decide it that way. The alternative is discovering it as a 429 on a
Saturday.

The quality gate stays: publish where the data supports a page. The repo has
already measured this — the chase set prices at 100% with 15+ median comps and
90% image coverage; commons price at 5 comps. Cards where the price is thin and
the caveats fire are exactly the pages Google reads as thin, and a thin page
submitted in bulk demotes the good ones with it.

### 4. Build the path to Pro

Worth more than everything else in this document combined, and currently
absent — there is no link from Last Comp to the app anywhere on the site.

The existing reasoning for that absence is right and should be preserved: a
bare "Sign in" pointing at a product the visitor has never heard of, on a page
whose privacy policy promises *"no accounts here, nothing to sign up for"*, is
worse than nothing. The answer is not to add a link. It is to build an offer.

**Target it behaviourally rather than showing it to everyone.** The prospect
worth catching is the visitor pricing their fifth card in a session: that
person has a stack, and a stack is what the batch tool is for. Everyone else is
looking up one card and should be left alone.

That is a product build, not a copy change, and it is the single most valuable
thing on this list.

### 5. Communities, in parallel, for the first hundred a day

SEO gives you nothing for three months. Communities give you the first users
and the only early feedback you will get: UK Pokémon Facebook groups,
r/PokemonTCGUK, seller Discords, eBay seller forums. The highest-value form is
answering "what's this worth?" posts with the actual answer plus the link.

Two rules, both account-ending if broken: **link the tool, never a tagged eBay
URL** — affiliate links in communities get you banned — and disclose.

It does not scale. It is not supposed to.

**When the "what's it worth?" posts turn out to be thin on the ground, that is
not the absence of demand** — the question moved into stickied megathreads,
Discord `#price-check` channels and video comments, and a large part of it is
asked by loft-clear-out sellers who were never in a TCG group in the first
place. `docs/MARKETING_CHANNELS.md` is the follow-up report on where it went,
why seller communities outrank collector ones for us, and the channels that
don't involve posting at all.

### 6. The position: "it tells you when it isn't sure"

CardMetric, PACKRAT, PokePrices and PriceCharting all show a number. The
defensible claim is not that ours is more accurate — that is unprovable in a
SERP snippet — but that ours **shows its working and admits its limits**:

- "Show N listings we didn't count" — nobody else does this
- The caveats that fire when the match is weak
- UK-domestic and worldwide as two separate numbers
- A liquidity band measured over a window the data actually supports
- **A changelog that leads with the £44.75 Umbreon we got wrong**

That last one is the most marketable asset in the product and the least
obviously so. A price site publishing its own worst failure is a story; a
number is not. It is also the thing a competitor cannot copy without building
the exclusion engine first.

### 7. Do not pay for traffic

At £0.0045 of EPN revenue per search, a 5p click costs eleven times what it
returns. Paid acquisition can only ever be underwritten by Pro subscription
LTV, and only once that funnel exists and converts measurably. Until then every
acquisition pound comes from work rather than spend.

## What would tell us this isn't working

Named in advance, so the answer isn't reverse-engineered from whatever the data
turns out to say:

- **"Crawled — currently not indexed" across most of the 455 pages, three to
  six months in.** This is the one that invalidates the approach rather than
  the execution. The response is fewer, better pages — not more of them.
- **Impressions without clicks.** The pages rank but the snippet doesn't earn
  the click; a title and description problem, cheap to fix.
- **Clicks without EPN clicks.** People get their number and leave. That is
  half the audience by design — sellers, not buyers — but if `buy-hero` earns
  nothing at real traffic, the hero is picking listings nobody wants.
- **`buy-see-all` beating `buy-hero`.** Our rows aren't the right rows.

## Sequencing

1. **Read the dashboard by set** — monthly, starting a month from now. Free.
2. **Set pages ahead of every release** — standing job, starts with the next set.
3. **Decide the SoldComps plan**, then expand the published set to match.
4. **Build the Pro offer**, behaviourally triggered. The big one.
5. **Communities**, in parallel with 2 and 3, for the first users and feedback.
6. **AdSense** last, and it remains the smaller half. It needs a certified CMP
   and `ads.txt` before any ad code, per the checklist in CLAUDE.md.

Steps 1–3 compound. Step 4 is worth more than 1–3 together. Step 5 is what
carries the site while 1–3 are still too slow to see.
