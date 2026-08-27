# Where to market Last Comp, when "what's this worth?" posts are thin

Research report, 2026-08-27. Question, as asked: *the Facebook groups and
subreddits don't have many "what is the value of this" posts to answer — what
other avenues should we explore?*

Companion to `docs/MARKETING.md`, which ranks the whole acquisition plan and
puts communities at #5 with the note *"it does not scale; it is not supposed
to."* This report is about the seam that looked empty when we went looking.

## TL;DR

- **The pond isn't empty, the fish moved.** The valuation question is asked at
  volume — it just isn't asked as a standalone post any more. It lives in
  stickied price-check threads, Discord `#price-check` channels, TikTok
  comments, and inside "what will you give me for this" offers in buy/sell
  groups. Standalone posts are rare *because* those channels absorbed them.
- **Stop hunting the asker; recruit the answerer.** One regular who answers
  thirty price-check posts a week is worth more than thirty posts of ours, and
  they have a reason to want us: we save them opening Terapeak.
- **Our best audience was never the asker anyway.** The person with one card
  is a single search worth £0.0045. The person with a shoebox is the Pro
  prospect — so reselling and eBay-seller communities outrank collector
  communities for us, even though collectors are where the valuation talk is.
- **The share PNG is a distribution channel, not a feature.** It carries the
  wordmark and it travels into groups that ban links. We built it and then
  didn't market with it.
- **The warmer already generates the one thing nobody else has**: 455 UK sold
  prices in GBP, re-measured weekly. A monthly *"biggest movers"* index is
  citable, recurring, costs zero extra SoldComps requests, and is the only
  linkbait asset on this list that a competitor can't copy without building
  the engine first.
- **For a 455-page programmatic site, links beat posts.** A reply gets twenty
  visits once. One link from a page Google trusts lifts all 455 pages.
- **Timing:** SEO lead time is ~3 months and card buying peaks in
  November–December. Anything published in September lands for the peak.

---

## Why the seam looks empty

Four separate things, none of which mean the demand isn't there:

1. **The big subs funnel valuation into one thread.** r/PokemonTCG and friends
   run a stickied price-check / "what's it worth" megathread precisely so the
   front page isn't fifty photos of a bent Charizard. The volume is in the
   thread; the front page looks like there's no volume.
2. **Buy/sell/trade groups phrase it as an offer, not a question.** "£40 posted,
   any interest?" *is* the valuation question, asked by someone who has already
   guessed. That is a better moment for us than a neutral "what's this worth" —
   there is a number on the table to check.
3. **It migrated to Discord and short video.** "Is this worth anything" is
   overwhelmingly a video-and-comments question now, and a `#price-check`
   channel question in the servers. Neither is searchable from the outside,
   which is exactly why it looks like the question stopped being asked.
4. **We were looking in TCG spaces.** A large share of the question comes from
   people who don't collect at all — loft clear-outs, a relative's estate, a
   child's binder being sold. Those people post in general selling, car-boot
   and local groups, not in Pokémon groups.

## The avenues, ranked by what they're worth to us

### 1. Reselling and eBay-seller communities, not collector communities

This is the biggest single reframe available and it barely costs anything to
test. Our differentiation — net after fees, the exclusion list, the liquidity
band, batch pricing a stack — is seller language. A collector wants a number; a
seller wants to know what they'll clear and how fast.

Where: UK reselling and car-boot Facebook groups, eBay-seller Facebook groups,
r/Flipping, r/eBaySellerAdvice, the eBay UK Community boards, and the reseller
Discords. The pitch is not "price your card" — it's **"price fifty cards
without opening fifty Terapeak tabs, and see what you clear after fees."**

This is also the only community channel that points at Pro rather than at
£0.0045 of affiliate revenue, which per `MARKETING.md` is a 2,200× difference.

### 2. Recruit the people who already answer the question

In every group and server there are a handful of regulars who answer every
price-check post. They are doing manual work we can eliminate. Approach them
directly, give them the tool with no ask attached, and let them use it in
public. A mod who pins it answers a thousand posts for us.

Concretely: the sub wikis and "resources" sidebars, the pinned-resources
channel in Discords, the FAQ posts in Facebook groups. Getting listed once in
those beats posting weekly, and it's a link as well as a referral.

### 3. Go where the question actually is now

- **Discord `#price-check` channels.** Highest-density version of the exact
  question, and almost nobody markets there because it isn't indexable.
- **Stickied megathreads**, not the front page. Answer inside the thread.
- **TikTok / YouTube Shorts comments** on "are my old Pokémon cards worth
  anything" — enormous volume, and the answers there are uniformly generic.
- **General selling / loft-clear-out groups**, per the diagnosis above. The
  person who found a 1999 binder in a loft is a better prospect than a
  collector: they have thirty cards and no idea, which is a batch.
- **Live-selling audiences** (Whatnot and the UK breaker scene) — every buyer
  in a live is valuing cards in real time with no tool to hand.

### 4. Answer with the image, not the link

`share.png` exists, carries the wordmark, is always dated, and shows sold
figures only. That makes it postable in every group that bans links — which is
most of the good ones — and it is the format the answer gets screenshotted into
anyway. Lead with the image; put the URL in a comment or leave it to the
wordmark. This costs no new build and we are currently not using it.

### 5. Publish the data nobody else has

The warmer re-prices 455 chase cards weekly. That is a UK-sold, GBP price
series for the cards people care about, and it is a by-product we already pay
for. Two pages fall out of it at near-zero cost:

- **"Biggest movers this month"** — up and down, with the comp counts. A reason
  to come back, and an honest post rather than a plug.
- **A monthly index.** Journalists write the "your old Pokémon cards could be
  worth thousands" piece every single December, and they cite whoever has a
  number. A UK-specific, sold-based index is exactly the citable thing, and
  the citation is a link to a domain that needs links.

Neither costs a SoldComps request beyond what the warmer already spends.

### 6. Head-term content the card pages can't carry

`MARKETING.md` makes this case for set pages. The same argument extends to
pages we don't have and could build from code already written:

| Page | Built from | Why it earns |
|---|---|---|
| eBay fee calculator for card sellers | `FEE_RATE` / `FEE_FIXED_PENCE`, already on the workings screen | Evergreen, high volume, seller-shaped — the audience we want |
| "Sold vs asking, and why the difference matters" | The whole premise of the site | Ranks, and it's the argument for us |
| "Is my card a first edition / shadowless / fake?" | Nothing yet | The other question loft-finders ask, at scale |
| Release calendar / "most valuable cards in *X*" ahead of each set | The catalogue, in minutes | The recurring predictable spike, per `MARKETING.md` §2 |

The site is currently search, card, set, changelog, privacy. Every one of those
is a page a visitor reaches *after* deciding to look up a card. There is no page
that catches somebody earlier than that.

### 7. Links, because a programmatic site lives or dies on them

455 thin-ish pages with almost no inbound links is the classic profile for
"Crawled — currently not indexed", which `MARKETING.md` names as the one signal
that invalidates the whole approach. Community replies do not fix that; links
do.

Cheapest real sources, in order:
- Sub wikis, Discord resource pins, group FAQ posts (§2 — it's both).
- The **£44.75 Umbreon changelog entry** posted to a builder audience —
  r/SideProject, Indie Hackers, Show HN. Wrong audience for customers, right
  audience for links, and the story is genuinely good: a price site whose
  headline post is its own worst failure.
- UK card YouTubers and newsletters. Give them the batch tool, ask for nothing;
  mentions follow use.
- The monthly index (§5), which is the only one that compounds.

### 8. Offline, where the intent is highest

We already built a Show Desk, which means we are physically at card fairs with
a table. A QR on that table, and in local card shops, reaches people mid-
decision. It doesn't scale and it doesn't need to — it's also the only channel
that produces conversation with actual users, which is the other thing
communities were meant to give us.

## Two rules that end accounts, restated

- **Link the tool, never a tagged eBay URL.** Affiliate links in communities
  get the group and the EPN account gone. `lastcomp.co.uk/card/...` is fine;
  anything carrying the campaign ID is not.
- **Disclose.** In every group, on every post, that it's ours.

## Measuring any of this without breaking the promise

The privacy page says no analytics and that stays. It only binds what happens
**on our site**, so channel attribution can live entirely off it: give each
channel its own short link and read the click count at the redirector. Nobody
is tracked on Last Comp, and we still learn which group sent people.

Beyond that the two signals in `MARKETING.md` hold: Search Console's query list
says what to publish next, and the EPN sub-ID says which sets earn.

## What to do first

1. **Post the image, not the link**, in the groups already joined — free,
   today, no build.
2. **Get listed** in three sub wikis / Discord resource pins, and message the
   regulars who answer price checks (§2).
3. **Switch the community effort to seller spaces** (§1) for a month and
   compare against the collector spaces we've been working.
4. **Ship the movers page** off the warmer's existing data (§5) — it's the
   first thing on this list that compounds, and it's nearly free.
5. **Then the fee calculator and the release-calendar set pages** (§6), in
   September, so they're ranking for the November–December peak.
