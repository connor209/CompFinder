# Why the app's batch prices a £2 Japanese common at £12.99

Findings from recursion-testing the **app's** batch pricing path (`apps/app`),
2026-08-25, against the Neo-era Japanese run exported as
`compfinderprices20260825.csv`. Last Comp is not involved and nothing here has
been changed in `packages/core` yet.

Reproduce with:

```
node scripts/recurse-batch.mjs --runs 4 --csv <the exported CSV>
node scripts/probe-nametokens.mjs
```

`recurse-batch.mjs` reproduces the shipped figures exactly — £12.97 for Xatu,
£10.24 for Snubbull, £12.31 for Gligar, from the same comp counts — before it
measures anything, so a number below is the app's behaviour rather than a model
of it.

## The one-line cause

`extractNameTokens("Xatu No. 178")` returns `["Xatu", "No.", "178"]`, and every
token must appear in a comp's title. The token `No.` compiles to `\bNo\.\b`,
and `\b` after a full stop demands a **word character next**:

| listing title | `\bNo\.\b` |
|---|---|
| `Xatu No.178 …` | matches |
| `Xatu No. 178 …` | **never matches** |
| `Xatu #178, …` | **never matches** |
| `Pokemon Xatu 178 …` | **never matches** |

So a sold comp survives the filter only if the seller typed the number with no
space after the stop. That is the whole discriminator. Every "Different card —
name didn't match" row in those screenshots is a listing that wrote `No. 178`
the ordinary way.

It bites here and not elsewhere because the number reaches the tokens as a bare
`No. 178`. Where a card number carries a slash — `215/203` — `simplifyTitle`
lifts it out as a number token before tokenising and the prefix never appears.
Japanese Neo-era cards are numbered `No. 178` with no denominator, so the
prefix survives into the token list on every card in the batch.

## What it costs, per card

47 to 85 comps excluded, 1 to 5 kept. The kept ones are not the best comps;
they are the ones whose seller used the unusual spacing.

On Snubbull No. 209, priced at £10.49, all four surviving comps are **Neo
Destiny and Neo Revelation** prints, and the one visible comp that does say
`NEO GENESIS` was thrown out as a name mismatch. The engine kept the wrong
card and discarded the right one, and the only thing on screen about it is
`⚠ Set "Neo Genesis" confirmed in only 0/4 comps used`.

## Why it turns into £12.99 rather than a slightly-off price

Three failures compound, and only the first is a bug.

**1. The pool is starved below every downstream guard's minimum.**
`splitPostageOutliers` needs 6 comps. `splitByCatalogSignal` needs 6. Every
card in this batch reaches them with 1–5. R4 in the harness lists them: on all
three cards both guards are silent, and nothing on screen says so.

**2. Postage is therefore never questioned.** `freePostage` adds the buyer's
postage to the seller's price, which is correct — a £2 card posted for £1.35
did cost somebody £3.35. These comps carry £8.39 to £14.17 of postage on £1–£4
cards. `splitPostageOutliers` exists to catch exactly that (`postage >
2× median item price` and `> the item's own price`) and it is one of the guards
that never runs. R5 re-runs the same comps with only the guards' minimum comp
counts relaxed — nothing about which comp is an outlier changes:

| card | as shipped | with the guards allowed to run |
|---|---|---|
| Snubbull No. 209 | £10.49 from 4 | **£2.49** from 2 |
| Gligar No. 207 | £12.49 from 5 | **£2.49** from 1 |
| Xatu No. 178 | £12.99 from 2 | £12.99 from 2 — every comp is high-postage, so the rule refuses to empty the set |

Xatu is the honest case: there is no clean UK-domestic sold data for it at all,
and the right output is no confident price, not £12.99.

**3. A pool that thin has no robustness left.** Same lesson as Last Comp's
"the hero is a minimum": a weighted median absorbs one bad comp when there are
fifteen. R3 jackknifes each used comp — the swing from a single comp appearing
or disappearing is **48% on Snubbull**, 12% on Gligar. That is not hypothetical
churn: the CSV proves it happens.

## The churn is real, and the CSV already measured it

The run priced 16 queries more than once, minutes apart, from separate
SoldComps calls. Four came back with a **different comp pool** (Ariados
71→70 excluded, Granbull 77→78, Shuckle 54→48, Stantler 73→72) and two moved
the price. Stantler No. 234 priced at £3.99 from 14 active comps on three rows
and returned **no price at all** on the fourth.

So page composition churns by roughly one item per call. Against a pool of 40
that is noise. Against a pool of 2 it is the answer.

## The collector number does not identify a Japanese Neo card

Four queries priced two genuinely different cards at one price, because the
query is built from name + number only and the set never reaches eBay:

| query | declared as | price |
|---|---|---|
| `Bayleef No. 153` | Neo Premium File 1 + Neo Genesis | £9.99 |
| `Chinchou No. 170` | Neo Genesis + Neo Revelation | £15.49 |
| `Snubbull No. 209` | Neo Genesis + Neo Revelation | £10.49 |
| `Flaaffy No. 180` | Neo Genesis + Neo Revelation | £17.49 |

`No. 178` on a Japanese Neo card is the **Pokédex number**, not a collector
number: the same Pokémon carries it across Neo Genesis, Neo Discovery, Neo
Revelation and Neo Destiny. This is the Yu-Gi-Oh and Magic finding in
`CLAUDE.md` arriving from a different direction — the engine is anchored on a
number that separates printings, and here that number separates nothing.

## What NOT to do, measured

The obvious repair is to drop the numbering prefix from the tokens. Run
`probe-nametokens.mjs` before shipping it. Against the 13 real titles:

| candidate | good comps kept | good comps lost | bad comps dropped | bad comps admitted |
|---|---|---|---|---|
| current (shipped) | 3 | 3 | 3 | 4 |
| drop the numbering prefix | 6 | 0 | 2 | 5 |

The bug is currently excluding a Walkers Tazo pog and a Neo Destiny print **by
accident**, on the same broken rule that is discarding the good comps. Lifting
it hands both to the price.

And `splitSetMismatch` will not catch them. It fires only when set-matching
comps are a **minority** (`ratio ≤ 0.5`) **and** there are at least 4 of them —
a narrow band that none of these cards is in. It stands down on Snubbull
(1 matching), on Gligar (2 matching), and on Xatu (4 of 5 matching, so the
ratio clause blocks it and the one Neo Discovery comp is priced in). The guard
is weakest exactly where the pool is thinnest, which is where this bug leaves
every card.

## What was actually wrong: postage, not matching

**74–82% of every recommended price in this batch was POSTAGE.** The cards
comped at £1.16–£4.37, which is right for a Japanese Neo common. The postage
attached to them was £8.39–£14.17.

| card | recommended | of which postage | the cards themselves |
|---|---|---|---|
| Xatu 178 | £12.66 | £10.06 (82%) | £2.20, £3.25, £1.49, £1.70 |
| Gligar 207 | £12.31 | £8.22 (74%) | £4.37, £2.69, £1.16, £2.69, £3.90 |

`freePostage: true` adds the buyer's postage to the seller's price, and that is
right — a £2 card posted for £1.35 did cost somebody £3.35. It stops being
right the moment the postage is somebody's international shipping. No UK seller
charges £14 to post one card: a live ebay.co.uk search for Sunkern No. 191 on
2026-08-25 showed twelve listings at **£1.99–£2.24**, every one of them free
delivery, £0.99 or £1.00, with a single £5.00 outlier.

`dropForeignPostage()` zeroes the postage on a comp charging more than
`£6.00` **and** more than the card itself. Both clauses matter: £8 of
signed-for on an £800 Umbreon is a real UK cost, and postage is only ever
material relative to a cheap card — which is exactly where this fires.

**The comp is kept and its postage zeroed, not excluded.** Excluding is what
`splitPostageOutliers` already does and it is measurably the wrong shape here:
it needs six comps to hold an opinion, it stands down rather than empty a pool
where every comp is foreign, and these pools are too thin to bin evidence. The
sale happened and the card did go for £2.20; only the shipping says nothing
about the UK market. Snubbull's pool actually **grows** from 3 to 6 under this
rule, because once the postage is gone those comps stop looking like outliers.

## Two comps is not a price

37% of the batch was priced from two comps or fewer — and those skew **high**:

| built from | median recommended price |
|---|---|
| ≤ 2 comps | **£15.49** |
| ≥ 4 comps | £9.99 |

Thinner pool, bigger number, because nothing absorbs a bad comp and every
downstream guard is under its own minimum.

**Sunkern No. 191 is the case to remember.** One sold comp at £19.36 became a
£19.49 recommendation, while twelve live UK listings for that card sat at
£2.00. The app had the means to know: it fetches active listings — but only
when there are *zero* sold comps, so with one bad comp it never looked.

Two changes follow, and they are the same change:

- Below `MIN_SOLD_COMPS_TO_PRICE` (3), the run now **checks the active market**
  rather than trusting one sale. The fallback already existed; only its trigger
  moved, from "no sold comps" to "too few sold comps to trust". It costs one
  extra SoldComps request on the thin rows only.
- If the actives are too thin as well, the price is **held**: `Recommended
  Price` is blank and the row says why. The comps are kept, so the deep dive
  still shows what was found and why it wasn't enough. A number you have to
  know to distrust is worse than no number — the same reasoning that holds a
  thin price back from a show sticker.

## Where that leaves the batch

Measured on the three cards whose comps we have, all four app rules together:

| card | as shipped | + matching rules | + foreign postage dropped |
|---|---|---|---|
| Xatu 178 | £12.99 / 2 comps | £12.99 / 4 | **£2.99** / 4 |
| Snubbull 209 | £10.49 / 4 | £2.49 / 3 | **£2.49** / 6 |
| Gligar 207 | £12.49 / 5 | £12.49 / 5 | **£3.49** / 5 |

Against a live market of about £2 for this tier of card.

## Stop tuning on three cards

Everything above is measured on **three** cards reconstructed from screenshots.
That is three anecdotes, and `CLAUDE.md` is explicit about what happens to a
rule judged on the examples that prompted it. `apps/public` has
`probe-rules.mjs` for this reason; the app had no equivalent because its comps
only ever lived in React state.

Migration 023 changed that and nobody noticed. **A saved run already stores the
full recommendation for every card** — `included[]` and `excluded[]`, each comp
with its price, postage, sold date, location and exclusion reason. The comps
behind a 67-card run are sitting in the database, and reading them costs
nothing upstream, because a saved run is a record of a price decision rather
than a live quote.

```
NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/dump-batch.mjs --list
NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/dump-batch.mjs --batch <id> --out corpus.json
node scripts/recurse-batch.mjs --corpus corpus.json
```

That prices every card in the run both ways and reports the median move, what
was held, how many comps had postage dropped, and — read this one — **anything
that went UP**. Don't commit the corpus: a run carries your SKUs and asking
prices.

## The two fixes, and why neither is in `packages/core`

Both live in **`apps/app/lib/matching.js`**. `packages/core` is untouched, and
`check-nametokens.mjs` asserts that it stays untouched — so a later tidy-up
that pushes one of these into the shared engine, and therefore into Last Comp,
fails the check rather than silently repricing a stranger's card.

The first attempt did put them in core, which dragged in the whole public-side
audit — a live corpus, `AUDIT_TOKEN`, the Turnstile gate. None of that was ever
necessary. Measured side by side, the app-side version produces **identical
results** on all three cards, so the shared-code route bought nothing and cost
an audit the app didn't need.

- **`appNameTokens()`** drops `no` / `no.` / `#` from the match tokens. The
  number stays required and already tolerates leading zeros, so nothing
  identifying is given up. The prefix stays in the **search query** — plenty of
  sellers write "No.178" and eBay's own search is the last thing to start
  guessing at. It is stripped only where it becomes a required *match* token,
  because there it is not a fact about the card.
- **`APP_SETTINGS.setMismatchExcludeBelowRatio: 1`** removes the set guard's
  ratio ceiling, so a confirmed set excludes even when it wins its own vote.
  `setMismatchMinKept` is untouched and still holds it off a sample too small
  to price from. **This is a setting, not a code change** — `recommend()`
  already took it, which is the main reason core needed no edit at all.

### Where the prefix actually comes from

Not the pricing engine. A CardUploader CSV's **`*C:Card Number`** column holds
whatever the lister typed, and for these cards that is literally `No. 178`.
`buildQueryFromItem` joined it straight onto the card name, so the engine was
faithfully requiring a token it had been handed. Last Comp gets a catalogue row
whose number is a bare `178` and never had the problem — which is exactly why
this is an app-side rule and not a shared one.

The app also had no settings module of its own: five screens read
`DEFAULT_SETTINGS` directly. `apps/public/lib/settings.js` is the mirror of
this file on the other side, and the app simply never had one. That was the
real architectural gap, and it is why the first attempt reached for core.

### `NR` is a set code, and the probe caught it

The first draft of the prefix pattern included `nr`. Run over 2,132 catalogue
cards, **`NR` turned out to be the set code for Neo Revelation** — "Shining
Magikarp NR 66". Dropping a set code is a looser and different change, nothing
in the batch ever wrote `Nr`, and it bought nothing measured. `nr` and `num`
are both out; the pattern is `no`, `no.`, `#`.

### What the two rules each do, measured

The set rule does **nothing on its own** — on all three cards it is identical
to what shipped. Its whole job is to catch what the token rule lets in:

| | Xatu 178 | Snubbull 209 | Gligar 207 |
|---|---|---|---|
| as shipped | £12.99 / 2 comps | £10.49 / 4 | £12.49 / 5 |
| token rule only | £12.99 / 4 | **£2.49** / 3 | £13.49 / 6 ← Neo Destiny admitted |
| set rule only | £12.99 / 2 | £10.49 / 4 | £12.49 / 5 |
| both | £12.99 / 4 | **£2.49** / 3 | £12.49 / 5 |

Snubbull is the headline: the pool finally reaches six, so `splitPostageOutliers`
fires on three comps carrying £10–£14 of postage. Gligar is why the two ship
together — alone, the token rule admits a Neo Destiny print and pushes the price
*up*. Xatu holds at £12.99 on twice the evidence, which is the honest outcome:
every comp is high-postage, so the guard refuses to empty the set and there is
no clean UK-domestic sold data for that card.

### Verification

`npm run check` is 17 of 17, including `check-exclusions.mjs`'s 55 real titles
from the 11,063-comp audit corpus and `check-listings.mjs`'s £44.75 Umbreon
case. Both apps build. `recurse-batch.mjs --legacy` prices the same fixture the
way 2026-08-25 did, so R0 stays a reproduction of the run that prompted this.

**No public-side audit is required**, because nothing shared changed. If either
rule is ever moved into `packages/core`, it needs one — the set guard is live
on all 455 published cards, and only comps can say what it does to them.

## The rest of the work

1. **Tell the user a guard was starved.** The app already says how many comps
   were excluded and why. It should also say when a rule could not run —
   "priced from 2 comps; the postage and catalogue checks need 6" is the
   sentence that would have made this visible on the day.
2. **Put the set in the query.** `Snubbull No. 209 Neo Genesis` is a different
   search from `Snubbull No. 209`, and for Japanese Neo cards it is the only
   thing that separates four different cards.
3. **Make the thin-pool case say so.** A price from 1–2 comps on a card with
   70+ fetched is not a Low-confidence price, it is a failed match.

## Files

- `scripts/recurse-batch.mjs` — R0 reproduction, R1 determinism, R2 fixed
  point, R3 jackknife, R4 guard starvation, R5 counterfactual, plus the CSV
  cross-run test. No network, no quota.
- `scripts/fixtures/neo-batch.json` — the comps, each marked `screenshot`
  (read verbatim off the results panel) or `backsolved` (one Gligar row the
  panel did not scroll to, solved from the published £12.31 — its title is
  written to the observed template and is not evidence about wording).
- `scripts/probe-nametokens.mjs` — scores candidate repairs against the real
  titles. Writes nothing.
- `apps/app/lib/matching.js` — all four rules, and the app's first settings
  module of its own.
- `scripts/check-matching.mjs` — table check for all four plus the tripwire
  asserting `packages/core` is unchanged. In `npm run check`.
- `scripts/dump-batch.mjs` — a saved run out of Supabase and into a corpus.
  Costs nothing at SoldComps.

R1 and R2 both pass on every card: given the same comps the pipeline is
deterministic and reaches its fixed point in one pass. The instability is
entirely upstream churn arriving at a pool too small to absorb it.
