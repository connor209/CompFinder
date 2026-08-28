# apps/public — Last Comp, the public page

The free price page: no accounts, one shared key, cached hard. Vercel project
`compfinder-public`; the product has been called **Last Comp** since
2026-08-23, so "CompFinder" in a path is the codebase and "Last Comp" in copy
is the product. **Read the root `CLAUDE.md` first.**

Everything here answers a stranger who typed one thing into a box and is owed
an honest number or an honest "we don't know". That is a different job from
the app's, which is why several rules below are deliberately *not* the app's —
see `packages/core/CLAUDE.md` for the engine both share.

`npm run dev:public` / `npm run build:public`, from the repo root.

## The hero is a minimum, and a minimum has no robustness

Everywhere else on a card page a bad comp is absorbed: the price is a weighted
median and one stray moves it by pennies. **"Buy it today for" is the cheapest
live listing**, so the worst match in the set *is* the answer — in the largest
type on the page, with an affiliate link under it.

That shipped. Umbreon VMAX 215 Evolving Skies, 24 Aug 2026: eight sold comps,
median £837.48, last one £949.95, and a hero reading **£44.75** pointing at a
listing that was not the card.

Two leaks put it there, and both had to close:

- **`dropWrongNumerator` keeps a title with no collector number** — right for
  sold comps, where dropping them loses real evidence and the median absorbs
  the rest; wrong for a minimum, where the unnumbered stray wins by
  construction.
- **Cheap listings that *did* carry 215/203 still weren't the card** (£57.72,
  £85.56 against a £837 median). No amount of name and number matching catches
  those: a title is not evidence about the object.

`apps/public/lib/listings.js` owns both rules — a positive number match for
live listings, then a price floor at **a third** of what the card sells for.
The floor is nothing like the sold-side rule, which drops a low outlier at
median/12: a completed sale is evidence that somebody paid it, an asking price
is evidence of nothing, and the cheap tail of a chase card's listings is where
fakes and wrong printings collect. It only stands where it can — nothing under
£5, nothing on fewer than three comps, and if *every* listing is below it then
the floor is likelier wrong than every seller, so they show.

**The third is not yet measured against a corpus.** `probe-rules.mjs` and the
audit harness are how that gets done, and the number should move if the data
disagrees.

Nothing is dropped quietly: the count is handed back and the page says so.

## Card pages, crawlers, and the budget

`/card/<query>` is a client component that fetches on mount, so what left the
server used to be a spinner — no answer for a crawler on the one surface built
to be crawled, and a SoldComps request per uncached view against a URL space
where any string is a valid page.

The **published set** (`apps/public/lib/published-cards.js`, the 455 chase
cards) is the set we stand behind: server-rendered with a price, listed in the
sitemap, kept warm. `lib/card-page.js` reads the cached price on the server and
seeds the hook with it — **seeding `useState` rather than setting it in an
effect is the point**, since an effect runs in the browser, which was never the
problem. Anything else falls through to the client path unchanged.

**A crawler must never cost a SoldComps request.** `card-page.js` only READS
the cache. Filling it is the warmer's job.

**The buy module stays client-side.** Asking prices are two hours fresh at best
and a cache entry can be a month old, so a server-rendered "buy it today for"
would tag a listing that may have sold days ago.

**Three callers must build the same query string**, or every server-rendered
page misses the cache forever: `queryForCard()` in `lib/card-query.js` (not
`use-card.js` — that file is `"use client"` and the server can't import it) and
`cacheKeyFor()` in `lib/cache-key.js`. The failure is invisible — no wrong
price, just no price, while the warmer keeps writing entries nobody reads.

**The sitemap lists only cards that currently have a price**, because a thin
page submitted in bulk demotes the good ones with it. Card pages carry a
**canonical** to the published spelling: the same card is reachable under every
typo, and without one those compete with each other.

**Set pages are the internal linking, not just content.** `/set/<name>` lists
every card in a set by value, and each card page links up to its set and across
to six others. Before that, a card page's only outbound link was the home page:
450 URLs each at the end of a dead end, with the sitemap as their sole route
in, which is a poor way to get a site understood — Google leans on internal
links to judge what matters. "Most valuable cards in Prismatic Evolutions" also
carries volume an individual card page never will.

**The sibling window WRAPS from each card's own position**, which is the whole
point rather than a detail: taking the first six of a set would have all 48
Prismatic Evolutions cards linking to the same six pages, so six get every
internal link in the set and forty-two get none. `check-cardpage.mjs` asserts
that every card in a set receives one. The strip is rendered from the manifest
and carries no prices, so it costs no query on the hot path; the prices are on
the set page, one click away, which does the work once for the whole set.

**Indexing is gated on one flag.** `PUBLIC_ALLOW_INDEXING` controls robots.txt
and the pages' `noindex` from `lib/indexing.js`, and defaults to CLOSED — off
is the safe direction, since being wrong that way costs some indexing we didn't
get yet and being wrong the other way costs a domain migration. The condition
that mattered was the domain, and it is live: content indexed against a preview
hostname owes you a migration for pages that had just started to rank.
`NEXT_PUBLIC_SITE_URL` must name a host that actually resolves — a canonical
pointing at a dead host is worse than none, and it must match what Vercel
serves (www, not the apex, which redirects).

```
node scripts/build-cardpages.mjs            # rebuild the published set
node scripts/warm-cardpages.mjs --dry-run   # what needs warming, spends nothing
node scripts/warm-cardpages.mjs --limit 120 # warm the 120 stalest
```

Or **Actions → Warm card pages**. It also runs weekly, and that cadence is a
budget: Starter is 2,000 requests a month shared with live visitors, 455 cards
cost 455, so weekly-at-120 is one full cycle a month and leaves ~1,500 for
people actually using the site. **Raise the limit when the plan changes, not
before.**

## Liquidity is read off one boolean — get it from the API

The band on the page ("Sells fast", "Slow mover") hangs almost entirely on
whether the result set was CAPPED. SoldComps returns one page of sales,
newest first, so for a fast card the window isn't 90 days — it's however long
those sales took.

Two things were wrong about that until 2026-08-23, and both were invisible
because the harness and the page each had their own copy of the logic:

- **The page guessed the cap from the comp count** (`comps.length >= 39`),
  because `price()` threw `hasNextPage` away. Measured over 40 cards, the guess
  is wrong on 21: when SoldComps says there is more it has returned between 35
  and 40 items, so 39 misses real caps, and nine sets of 39–55 items weren't
  capped at all. Two other harnesses passed no flag and read every fast card
  as slow. `assessLiquidity()` in `apps/public/lib/liquidity.js` is now the
  only definition, used by the page and all four audits.
- **The rate was measured over the span of the SURVIVING comps.** The cap
  truncates the *search*, not the card: a Xerneas keeps 3 sales out of 40
  listings, and those three sit 3 days apart inside a page reaching back 58
  days. That read as "Sells fast, 7 a week" for a card selling once every
  three weeks. The window page one actually supports is **[oldest listing on
  the page, now]** — complete data for that card over that period — which is
  what `visibleDays` passes to `assess()`. It moved 10 of 25 capped cards,
  in both directions.

`node scripts/audit-liquidity.mjs --n 40` scores all five policies side by
side against live data, and re-running it inside 24 hours is free.

**Cheap commons are thin for a different reason: the data isn't there.** Of 40
comps for a Weedle, almost none are single-card sales — eBay's market for a 1p
common is "Choose Your Card" pick-lists, correctly excluded. No rule change
conjures sold data that doesn't exist.

## Card images

The catalogue is Cardmarket-derived and has no art of its own, so image URLs
are matched in and stored on `card_catalog` (migration 022), never fetched
inside a visitor's request. Two reasons: a public page shouldn't depend on a
third party being up — pokemontcg.io spent an hour returning 500 to every call
on 2026-08-23, and did it again on 2026-08-26 — and we store links, not copies,
so the artwork stays The Pokémon Company's problem to license rather than ours
to redistribute.

```
node scripts/probe-images.mjs                       # measure coverage, writes nothing
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  node scripts/backfill-images.mjs --dry-run        # then without, to write
node scripts/backfill-images.mjs --refill           # retry every card that still has none
```

**`--refill` is the mode to run after a source is added or a rule changes.**
The default run is resumable — every row it looks at gets `image_checked_at`,
so the next run skips it — which means a rule that would now find art for a row
never gets the chance. `--refill` retries every row that still has no picture
and touches nothing else. `--recheck` re-asks about all 32,365 and is only
worth it if a source is suspected of having given a WRONG picture.

Or from the browser, with no checkout: **Actions → Backfill card images → Run
workflow** (`.github/workflows/backfill-images.yml`), which has `--refill` and
`--recheck` as tickboxes. Manual trigger only — it holds the service-role key,
so it never runs off a push. Needs the repository secrets
`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, and migration 022
applied first.

Backfilled 2026-08-23, tcgdex only: **21,162 of 32,365 English rows have art
(65%)** — the figure to beat once the second source below has been run in. That
whole-catalogue figure is dominated by things nobody prices here — sealed
products, World Championship decks, Play! Prize Packs and Japanese-named sets
tcgdex doesn't index. On the cards people actually search it is **84%, and 90%
of the chase set**. Non-English rows are skipped: tcgdex has them, but under
Japanese set names, which needs a name map we don't have.

Getting there took four rounds, and 52% of it was matching bugs rather than
missing data:

| fixed | worth |
|---|---|
| Cardmarket prefixes the 2003-07 era "EX Unseen Forces"; tcgdex doesn't | ~2,000 |
| Promos are numbered `SWSH001` there, bare numbers here | ~1,100 |
| `Dialga Lv.68`/`Dialga`, `Espeon Gold Star`/`Espeon ☆`, `Nidoran [M]`/`Nidoran♂` | ~1,300 |

A fourth spelling turned up on 2026-08-26: tcgdex writes most Gold Stars as
`Espeon ☆` but the five Holon-era ones as `Pikachu Star`, where Cardmarket
spells "Gold Star" throughout. A **trailing** bare "star" is that marker and
nothing else — the word only ever appears mid-name otherwise ("Team Star
Grunt", "Star Piece"), and VSTAR carries no word boundary before it, so
Charizard VSTAR is untouched. All five are chase cards.

**Two hazards the tests caught before they shipped**, both in the name guard:
it was folding Charizard, Charizard ex, Charizard V and Charizard LV.X into one
card, and the first fix for that merged Nidoran♂ with Nidoran♀. A suffix is
only ever accepted in one direction — ours carrying `LV.X` where tcgdex writes
the base name is the same card; theirs carrying `V` where ours doesn't is not.

**The match is set + collector number; the card NAME is a guard on the result,
never part of the key.** A missing picture is a gap; a picture of the wrong
card is a lie about what's being priced, and it's the most confident-looking
thing on the page. Two rules earn their place, both in `scripts/lib/card-images.mjs`:

- **Sub-sets are a whitelist**, not "any set name that extends another".
  Cardmarket keeps the Trainer Gallery, Galarian Gallery and Shiny Vault inside
  their parent with a TG/GG/SV number prefix; tcgdex splits them out. The naive
  rule also merges Base Set 2 into Base Set, Dragon Frontiers into Dragon, Team
  Rocket Returns into Team Rocket and eight XY Trainer Kits into XY. The tests
  caught it.
- **Zero-padding comes off after the letter prefix.** SV001, SV01 and SV1 are
  one card; SV1 and SV10 are not.

## Two sources, and the second one is where the chase cards were

tcgdex is asked first and answers for most of the catalogue. Its gaps are not
scattered, which is why "some images are missing" read on the site as *the
expensive ones* missing — measured 2026-08-26, tcgdex holds no art at all for
Shining Fates Shiny Vault (122 cards), Crown Zenith Galarian Gallery (70), all
four Trainer Galleries (120), Shining Legends (78), Dragon Majesty (78),
Aquapolis and Skyridge (72), and ~190 SM/SVP/MEP promos. 1,717 English cards.
A Trainer Gallery card *is* a chase card.

pokemontcg.io has every one of them, and is second rather than first because it
is the less reliable of the two — 30 calls a minute keyless, and it was down
entirely partway through this work. Second is where that belongs: it is asked
only about cards tcgdex had no art for, it is never on a request path, and its
"small" is a 180KB PNG against tcgdex's 35KB WEBP. `POKEMONTCG_API_KEY` lifts
its rate limit and the pacing with it; it is optional.

**A source that cannot answer must never look like a source that answered with
nothing.** Both return `null` for a failed call, and a row whose sources all
failed is left unwritten — no `image_checked_at` — so the next run tries again
rather than recording a gap that isn't one and then skipping it forever.

`lib/image-sources.mjs` is the only file that names either API host, and
`check-images.mjs` greps to keep it that way. The probe had already drifted
once: it looked our set names up EXACTLY where the backfill used `setFamily()`,
so every "EX Unseen Forces" came back as a set tcgdex has never heard of and
about a thousand cards were reported missing that were never missing. Both now
run through the same module in the same order, so what the probe reports is
what a backfill would write.

On the 455 published cards: **423 with tcgdex alone, 438 with both.** The 17
still without art are World Championship decks, Play! Prize Pack reprints and a
few one-off promos, which neither index holds.

## Last Comp: the public page's design system

Dark only, three fonts, four screens. `apps/public/app/globals.css` holds the
tokens; there is no light palette to fall back to, so nothing is behind a
`prefers-color-scheme` query.

- **Archivo at width 125%** for anything that shouts — headings, brand, labels,
  buttons, verdicts — always uppercase. The width axis is the identity, which
  is why `layout.js` asks next/font for `weight: "variable"` and `axes:
  ["wdth"]`: request fixed weights instead and next/font refuses the axis, the
  build still passes, and every heading quietly renders at normal width.
- **Martian Mono** for exactly two figures a screen (the buy-it-today price and
  the sells-for figure) and nothing else.
- **IBM Plex Mono** for rows, dates and inputs; **IBM Plex Sans** for prose.

Fonts are self-hosted through `next/font`, not linked to Google.

**The splash and the iOS launch image are one picture.** iOS draws a static PNG
before any of our code runs, and the splash animation continues from exactly
that state — so `lib/splash-frame.js` holds the geometry as numbers and both
`app/Splash.js` and `app/launch-image/route.js` are generated from it. Hand-
matching them is how the handoff becomes a visible jump. Frame one is
deliberately complete-looking on its own (wordmark all white, flat grey rule,
no holo, no tagline), because a slow network leaves the visitor sitting on it.

Two things learned building it. The launch image needs a real Archivo file —
`apps/public/assets/Archivo-Expanded-800.ttf`, read off disk and force-traced
via `outputFileTracingIncludes`, because `fetch(new URL(…, import.meta.url))`
resolves to a static asset path the bundler can't fetch at build time. And the
mock's teal bloom is absent from BOTH sides: Satori renders no radial gradient
at any syntax tried, and a bloom in the DOM against a flat PNG is exactly the
jump this file exists to prevent.

Startup images go through `metadata.appleWebApp.startupImage`, not a
hand-written `<head>` — the App Router hoists metadata and a `<head>` in the
root layout renders nothing.

```
/                        search
/changelog               what changed, and what was wrong
/card/[q]                which one? when ambiguous, otherwise the answer
/card/[q]?days=30        the same answer over a shorter sold window
/card/[q]/workings       every sale counted, every sale excluded, net after fees
/card/[q]/share.png      the answer as a 1200x630 PNG — POST any card, GET published
```

**The answer screen carries the mark, because it is the screen people
screenshot.** Price guidance gets given by snipping a rectangle of this site
into a thread, and the one screen most likely to be passed around was the one
screen with no brand on it. `Crumb` now ends with a horizontal `<Wordmark
inline />` — the same two-tone, on one line, because the stacked lockup would
double the height of a single-row bar. In that row the card NAME is the only
thing allowed to shrink: it is already on screen in larger type just below,
and a narrow phone pushing the mark off would undo the point of putting it
there.

**`share.png` answers to both methods, and the split is the point.** POST is
the Save-image button: the figures arrive in the body from the client that
already has them, so it works for EVERY card — including the one someone needs
to price for a customer, which usually isn't one of the 455. It costs nothing
upstream and there is nothing on it to scrape, because it renders what you
hand it. GET is the OpenGraph image, and it can only be the published set,
because a crawler hands us nothing and the only other source is the cache.
That is the right limit rather than a sad one: published cards are the ones
whose links get posted. **The GET reads the cache and never fills it** — the
same rule as `card-page.js` — and it 404s rather than throwing, because an
unfurler caches a 500 and the link then stays plain long after Supabase
recovers.

**Both methods draw through one `image()`.** Two renderers would eventually
disagree about which one is the shareable card; `check-share.mjs` counts the
`ImageResponse` calls. GET takes its headline from `priceCard`, the same
function the answer screen's figure comes from, so an unfurl and the page
cannot quote different numbers.

**A card page only claims an OG image it can actually draw.** `ogImageFor()`
gates on `findPublished` — a manifest lookup, free on a page render — and an
unpublished card falls back to `twitter:card=summary` rather than
`summary_large_image`, which would unfurl as a broken box.

**The catalogue's art is WEBP and Satori cannot draw it.** `image_small` is
`<card>/low.webp` (`scripts/lib/card-images.mjs`), which is right for the page
— a browser decodes WEBP without blinking — and took the Save-image button
down on every card that had art. Two things made it hard to see: it built
clean and passed a hand-written local test that used a `high.png` URL, and
Satori raises while PIPING the response rather than when `ImageResponse` is
constructed, so it surfaced as Next's own 500 page with nothing in it and no
try/catch of ours could reach it. `drawableArt()` swaps in the `high.png`
sibling, the content-type check is an ALLOW-LIST (`startsWith("image/")` is
what let it through), and the render is buffered so a draw failure falls back
to the image without art instead of killing the connection.

**The share sheet is for phones, and `canShare` does not tell you that.**
Chrome and Edge on Windows implement Web Share with files, so gating on
`navigator.canShare({files})` opened the Windows share dialog on a desktop
click — and the only route from there to a pasteable image was the snipping
tool the button exists to replace. `ShareButton` decides on `(pointer:
coarse)`: a phone gets the share sheet, everything else gets a download plus a
Copy button where the clipboard takes images. The clipboard is handed a
PROMISE inside the click, not an awaited blob, because Safari requires the
`ClipboardItem` be constructed within the gesture.

**Nothing on that image is an asking price.** "Buy it today for" is the
headline everywhere else and is forbidden here for the same reason it is never
server-rendered — except worse, because a PNG pasted into a Facebook group is
still being quoted in March while the listing sold in August. Sold figures are
facts about things that already happened. The image is also always DATED, for
the same reason. `check-share.mjs` greps for both.


**The cards you looked at are yours, and they stay on your device.**
`lib/recent-searches.js` owns the list behind the **Recent** button on the
search screen — localStorage, capped at eight, deduped on `normaliseQuery` so
one card can't sit in it twice under two spellings. It is recorded on the CARD
screen rather than at the search box, because the box is one of six ways in:
the dropdown, a typed query, a chip, a set page, a sibling link, a pasted URL.
Only a card that actually resolved is recorded — a search that failed is not
somewhere to send someone back to. `check-recent.mjs` pins the order, the cap,
the dedupe and that junk from an older build is dropped rather than drawn.

It is a different thing from `card-handoff.js` and deliberately not a mode on
it: a handoff is one card, carried across one navigation and deleted on read,
so it can never answer for a card nobody asked for. This is a list, kept. A
recents row still leaves a handoff on its way out, so coming back to a card
costs no resolve.

**The splash shows once a SESSION, and an installed app is not an exception.**
It used to skip that check when running standalone, reasoning that a
home-screen launch should always splash — which it still does, because a launch
starts a new session. What it also did was replay on every full page load
inside the app, so coming back from a card played the whole animation again.
iOS draws its launch PNG on a launch and not on a navigation, so that one had
nothing behind it to continue from. The back arrow and the wordmark are
`next/link` for the same reason: a full document load to leave a card is a
round trip and a splash where neither was wanted.

Both card screens run off `lib/use-card.js`. That is deliberate: the workings
exist to show the arithmetic behind the answer, and a second fetching path
would eventually have them explaining a different number than the one on the
previous screen.

**The sold window is in the URL, not in component state**, for the same
reason. `lib/windows.js` owns the list (30 and 90), and `/api/price` validates
against that same list rather than its own copy — an arbitrary number would
fragment the cache into near-duplicate entries that each cost a fresh API call.
Ninety is the default and is left out of the URL, so the ordinary link stays
the shareable one it has always been. A `days` state on the answer screen
renders identically and quietly leaves the workings explaining the 90-day
figure; `check-windows.mjs` fails on it.

**The answer screen waits on the sold comps, never on the live listings.**
Cold, a card was resolve 1.0s → sold 5.2s → active 7.7s, one after the other:
about fourteen seconds before anything appeared. The two price calls are now
started together and the screen renders as soon as the sold set lands, with the
buy-it-today figure filling in behind a "checking what's listed right now…"
line. Sold data is the answer; what is listed this minute is the upsell, and it
is the slower of the two. Roughly six seconds cold, and nothing on a cache hit.

**What the answer screen shows beyond the price.** All of it was already
computed and thrown away: the last comp (`sales[0]` — the product is named
after it), the graded tiers from `gradedBreakdown()`, and the daily-median
trend chart. Graded rows are a reference table, deliberately quieter than the
headline, because a slab is a different market and none of those sales feed the
price above.

**The changelog is written by hand, and the fixes matter more than the
features.** `lib/changelog.js` is prose for visitors, not generated from
commits — the messages in this repo are internal reasoning and a visitor should
not have to decode them. An entry earns its place by being something someone
using the site would notice; if you cannot write it without naming a file, it
is not an entry. The £44.75 entry is the most valuable one there precisely
because it is embarrassing: a site whose proposition is that it shows its
working cannot run a changelog that only lists new things. And a changelog that
stops being updated says the project is abandoned, louder than never having had
one — so keep entries cheap to add and only add them when something visible
ships.

**Anything quoting a constant must be generated from it.** The workings screen
prints "Based on £200.01 at 13.25% fees, 30p fixed, plus £1.35 postage" under a
net figure, and both come from `FEE_RATE`/`FEE_FIXED_PENCE` in `lib/verdict.js`.
The design prototype shipped a hardcoded version of that caption once and it
disagreed with the figure above it.

**The sale notes on the workings screen are derived, never invented.**
`lib/sale-note.js` reads condition wording, holo, postage and the seller's own
condition field out of the listing. The mock also shows "sold at auction",
"14 bids" and "private seller"; SoldComps returns none of those, so they are
absent rather than guessed.

## Before the public page goes live

Things deliberately set for a page with no visitors. Each one is wrong the
moment strangers can reach it.

- [x] **Rate limit back to 120/hour.** Done 2026-08-23. `PUBLIC_LIMIT` is the
      default in `apps/public/app/api/price/route.js`; `PUBLIC_RATE_LIMIT_PER_HOUR`
      still overrides it. Our own runs use `AUDIT_TOKEN` instead — every audit
      script sends it via `scripts/lib/audit-headers.mjs`, which warns loudly
      when it isn't set rather than letting a long run die of 429s an hour in.
- [x] **Throttle our own calls to SoldComps.** Done 2026-08-23, migration
      `021_soldcomps_global_pacer.sql`. A leaky bucket in Postgres hands out
      slots 1100ms apart (~54/min, short of their 60 on purpose); a request
      that would wait more than 4s is shed with a "try again in a few seconds"
      rather than queued. In Postgres because each Vercel invocation is its own
      process — an in-process bucket paces one lambda and leaves the rest
      unbounded. Every attempt claims a slot, retries included. Fails OPEN if
      the pacer is unreachable, so the deploy doesn't depend on the migration
      having been run.
- [x] **Bot protection** on `/api/price`. Done 2026-08-23. Turnstile, but as a
      pass rather than a per-request token: `/api/challenge` trades one solved
      token for a signed 30-minute cookie bound to the visitor, and `/api/price`
      checks the cookie on cache misses only. One challenge per half hour, and
      nobody re-reading a cached price is ever asked. **Inert until both
      `TURNSTILE_SECRET_KEY` and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` are set** —
      set both or neither, since the secret alone asks for a check the page
      can't solve.

      **The check is the one guard a phone can fail on its own**, and it did,
      for two months, on any card that missed the cache: the search stopped on
      "No luck — just checking you're human", which is the server's
      *interstitial* copy printed as a verdict. Three things had to change, and
      all three are worth keeping in mind before touching this again.

      **The pass binds to a NETWORK, not an address** (`clientNetwork()` in
      `lib/turnstile.js` — IPv4 /24, IPv6 /64). A phone's egress address moves
      while the visitor is waiting: carrier CGNAT rotation, or a dual-stack
      handset answering one request over IPv4 and the next over IPv6. Bound to
      the exact address, a pass earned a second earlier is not a pass any more.
      A /24 keeps what the binding is for — a proxy fleet spans the internet,
      not 256 neighbouring addresses. `::ffff:a.b.c.d` is unwrapped to its
      IPv4 /24 rather than bucketed by /64, or every mapped address on the
      internet would share one tag; `check-turnstile.mjs` pins that case.

      **An interactive challenge must be impossible to miss.** Cloudflare
      decides per visitor whether the check can be silent and asks a phone far
      more often than a desktop. The widget used to be pinned bottom-right at
      12px — a small box in the home indicator's lap, on a page still showing a
      spinner — so nobody tapped it and `timeout-callback` killed the search
      thirty seconds later. `before-interactive-callback` is Cloudflare saying
      a tap is needed; that is when the panel goes to the middle of the screen
      with a line of copy on it.

      **The widget's own hostname list is the thing that was actually
      broken, and it failed silently for two months.** Diagnosed 2026-08-28:
      the check reported `110200` — Turnstile for "domain not allowed" — and
      the cause was **a stale Home Screen icon**, not the widget. The sitekey
      was right and the widget listed both `lastcomp.co.uk` and
      `www.lastcomp.co.uk`. The phone was simply not on either of them: an
      iOS icon added before the domain went live keeps the origin it was
      installed from, so every page it opened came off an old Vercel
      hostname Turnstile had never been told about. Safari on the same phone
      worked. Deleting and re-adding the icon fixed it.

      **`start_url` in `manifest.js` is "/" — relative — and that is what
      makes this possible.** iOS resolves it against wherever the icon was
      installed from and keeps that origin permanently. Making it absolute
      does NOT fix it: a start_url outside the manifest's own origin is out of
      scope and ignored, so it would be a no-op dressed as a fix. The real
      remedies are a canonical-host redirect in middleware (gated to
      production, or a preview deploy bounces to live) or re-adding the icon.
      Neither is in place; the diagnostic below is.

      **This cost two wrong diagnoses, and both were confident.** First the
      mobile-network story — carrier drift, a corner-pinned widget — three
      plausible causes fixed blind because the site has no analytics and there
      was no route from "it fails on a phone" to why. Then, once `110200`
      named a domain refusal, the assumption that the widget's hostname list
      was short. Both were reasoned and neither was checked, because neither
      could be from here. **The lesson is the ordering: instrument first, then
      fix.** One line of small print carrying Cloudflare's own error code and
      `location.hostname` settled in one retry what two rounds of inference
      got wrong.

      **A client-reported error code must never unlock the server.** It is
      tempting to let `110200` fail open, since a challenge that cannot
      succeed is a wall rather than a guard. Don't: the code comes from the
      page, so anything can claim it, and /api/price would be spending money
      on whoever asked. A widget that genuinely is misconfigured is fixed in
      the dashboard.

      **Add every host the widget can render on**, including a vercel.app host
      if previews are meant to price anything — a preview on a host Turnstile
      doesn't know fails exactly this way, and looks like a broken build.

      **Nothing in `turnstile-client.js` may wait forever, and a failed search
      gets a Try again.** Every await there is bounded, because the state to
      degrade into is a page that says what went wrong and offers another go —
      not a spinner with no end. `price()` in `use-card.js` allows two
      challenge rounds rather than one, since a second challenge in a row is
      the normal outcome of drift rather than a failure, and it never lets the
      server's "one moment" reach the screen as a final answer.
- [x] **Privacy policy and affiliate disclosure.** Done 2026-08-24,
      `apps/public/app/privacy/page.js` with an `#affiliate` section, plus the
      disclosure inline in the home footer rather than only behind a link. The
      site had none of its own — only the business app's, a different Vercel
      project — so any link to `/privacy` 404'd. EPN review the live site, so
      this was blocking the application. The contact address on it,
      `privacy@lastcomp.co.uk`, is live and receiving — confirmed 2026-08-25.
- [x] **Apply to EPN, and set `NEXT_PUBLIC_EPN_CAMPID`** (5339194433). Done
      2026-08-25: the campaign is live and the ID is set on `compfinder-public`
      **only** — confirmed, and the thing to re-confirm if the projects are ever
      recreated, because commission on your own purchases ends the account and
      `apps/app/.env.local.example` carries the same variable name.

      Every tagged link now reports which card it was on, not just which module
      (`lib/epn-tag.js`, pinned by `check-epn-tag.mjs`). That matters more here
      than it would elsewhere: the privacy page promises no analytics and means
      it, so **the EPN dashboard is the only per-page traffic signal this site
      has**, and it only says as much as the sub-ID puts in. Reading it by set
      is what decides which cards to publish next — see `docs/MARKETING.md`.

      Still open, and worth a row in `MKRID` once there is evidence of the
      traffic: the rotation is UK-only, so a US visitor clicks an untagged
      link.
- [x] **Open the door to search engines.** Done 2026-08-25.
      `PUBLIC_ALLOW_INDEXING=1` on `compfinder-public`; robots.txt allows all
      but `/api/` and the `noindex` is gone. Search Console is a **Domain**
      property (verified by DNS TXT, so it covers www and the apex together),
      and `https://www.lastcomp.co.uk/sitemap.xml` is submitted — the full URL
      including www, because a Domain property prefills nothing and the apex
      308s. 450 URLs discovered.

      **URL Inspection confirmed Googlebot sees the price in the HTML** without
      running JavaScript — the whole point of the server-rendering work, and
      the one thing worth re-checking if the card page is ever refactored.

      **What to watch now, because there is no analytics.** The Pages report:
      "Crawled — currently not indexed" at scale is the thin-content verdict
      and the only real risk to the whole approach. "Discovered — currently not
      indexed" early on is just a queue. And the Performance report's query
      list is the closest thing to traffic data the site has — it tells you
      which cards to publish next.
- [ ] **Consent management** (a Google-certified CMP) before any ad code, and
      `ads.txt`, for UK/EEA traffic.

The configuration side is done as of 2026-08-25: `AUDIT_TOKEN`, both Turnstile
keys, `NEXT_PUBLIC_SITE_URL` (www, not the apex — the apex 308s) and
`NEXT_PUBLIC_APP_URL` are all set on `compfinder-public`, and the warmer has
the same `AUDIT_TOKEN` plus the Supabase pair as repository secrets. Migration
021 still has to be applied against Supabase or the pacer logs that it is
unreachable and lets everything through.

**Vercel functions run in `lhr1`.** They defaulted to Washington, which put the
Atlantic between every request and a UK Supabase — a cached price read went
from 0.81s to 0.33s on moving them. Worth remembering if the project is ever
recreated: the default is wrong for this product.

## The SoldComps terms question, settled 2026-08-25

This used to say the public page must not go on a domain until SoldComps
confirmed three things in writing. **That gate is lifted.** Re-reading their
own FAQ answered most of it, and the rest was a question worth less than the
delay it was causing.

Their FAQ: *"Every plan — including free — permits commercial use. Build it
into a paid SaaS, an internal tool, a client deliverable, a mobile app,
whatever. You pay for the requests; what you build on top of them is yours."*

Against the three questions that were open:

- **One server-side key serving anonymous visitors** — answered. They bless "a
  mobile app", and a mobile app cannot ship per-user API keys; it is one key
  serving users the operator never identifies. Same for the paid SaaS they also
  bless.
- **Caching their responses** — unaddressed, but there is no objection to
  construct. Caching *reduces* their load, and every plan is metered per
  request, so caching means we buy fewer. Their only interest runs the other
  way, and "what you build on top of them is yours" leans permissive.
- **Displaying individual comp rows** — the one genuinely open point, and
  weaker than it first looked: the rows are *eBay's* listings. SoldComps is a
  scraper; what they sell is the access, not ownership of the fact that a card
  sold for £X on a date.

**Why we stopped short of asking.** A question invites a policy where none
exists. Faced with a novel redistribution question, the safe answer for a
support person is "no" — and then we are bound by an answer we went and
fetched. Operating on a reasonable reading of terms they wrote and published is
the better position, and the realistic downside was never damages: it is being
asked to stop.

**What that means in practice.** The key can still be cut off, and the day it
is, every uncached search fails — the warmed cards keep serving and nothing new
prices. That risk is real, unchanged, and the reason the cache is worth as much
as it is. It was never a reason to keep the site off a domain.

If we ever do make contact, make it a customer email — what we are building, we
are on Starter, expect to grow, anything you would want us to know — rather
than a permission request. That gets a named human and an implicit blessing
without forcing a ruling.
