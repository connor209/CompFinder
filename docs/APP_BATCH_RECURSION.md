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

## The two fixes, and where the audit stands

Both are implemented in `packages/core/pricing.js` behind settings flags, so
`audit-rulechange.mjs` can price the same comps under both rule sets in one
process. **They are flags to be collapsed once the audit lands, not a knob to
keep.**

- **`dropNumberingPrefixTokens`** — `no` / `no.` / `#` stop being required
  match tokens. The number stays required and already tolerates leading zeros,
  so nothing identifying is given up.
- **`setMismatchPreferConfirmed`** — the set guard's ratio ceiling is dropped,
  so a confirmed set excludes even when it wins its own vote.
  `setMismatchMinKept` still holds it off a sample too small to price from.

### What the offline evidence says

**The full check suite passes, 17 of 17**, including `check-exclusions.mjs`'s
55 real titles from the 11,063-comp audit corpus and `check-listings.mjs`'s
£44.75 Umbreon case. `check-nametokens.mjs` is new and pins both rules.

**`probe-tokenchange.mjs`: the token rule is provably inert on Last Comp.**
Across every card set in the repo — bigset, bigset-en, bigset-en2, wideset and
the 455 published cards, 2,132 cards in all — it changes **zero** tokens on the
public path and zero on the app path. Last Comp tokenises the card *name* and
appends the bare number itself, so a numbering prefix can only reach the tokens
if a card is literally named with one, and no Pokémon card is.

That probe also caught a real false positive before it shipped. The first draft
of the pattern included `nr`, and **`NR` is the set code for Neo Revelation** —
"Shining Magikarp NR 66". Dropping a set code is a looser, different change
from dropping a prefix, nothing in the Neo batch ever wrote `Nr`, and it bought
nothing measured. `nr` and `num` are both out; the pattern is `no`, `no.`, `#`.

**On the app's own batch (R6 in `recurse-batch.mjs`), both fixes together:**

| card | before | after | what changed |
|---|---|---|---|
| Snubbull No. 209 | £10.49 from 4, **0/4** say Neo Genesis | **£2.49** from 3, 1/3 say Neo Genesis | pool reached 6, so `highPostage` finally fired on 3 comps |
| Xatu No. 178 | £12.99 from 2, 1/2 say Neo Genesis | £12.99 from **4**, 3/4 say Neo Genesis | better evidence, same answer — every comp is high-postage, so the guard refuses to empty the set |
| Gligar No. 207 | £12.49 from 5, 3 × `nameMismatch` | £12.49 from 5, `nameMismatch` + `nonUkLocation` + `setMismatch` | same price, but the Neo Destiny print is now excluded as a set mismatch instead of by accident |

Xatu is the honest outcome: the fix improves the evidence and leaves the answer
alone, because there is no clean UK-domestic sold data for that card.

### What is still outstanding

**The live public audit has not run.** The set flag is live on all 455 published
cards and only comps can say what it does to them.

`/api/price` serves its cache to anyone, but a **miss** is gated on Turnstile —
and the sold cache is 24h while the warmer runs weekly, so an audit is all
misses. Every query returns `403 needsChallenge` without `AUDIT_TOKEN`, which
is the bot protection working rather than a fault. The token lives on
`compfinder-public` and is not in this environment.

```
AUDIT_TOKEN=… node scripts/audit-rulechange.mjs --corpus-out corpus.json --json before-after.json
node scripts/audit-rulechange.mjs --corpus-in corpus.json    # every re-run after that is free
```

Run it from `apps/public`, like `audit-big.mjs`. Read the **LOST** column
first. One invariant is worth checking against: neither flag can lose a price —
the token rule only ever loosens matching, and the set rule cannot cut below
`setMismatchMinKept` — so a non-zero LOST count means something else is going
on and the flags should not ship.

### Why not audit-big + diff-runs

That pair is right for "did the site get better between Tuesday and Thursday":
two runs, two fetches, diffed. It is the wrong tool for judging a *rule*, and
the finding above is why — diffing two live runs measures the rule change
**plus** a day of upstream churn, with nothing separating them, and on a thin
card the churn is big enough to hide or invent a result. `audit-rulechange.mjs`
fetches once and prices both ways from the same bytes, so every difference is
the rule. It also halves the SoldComps cost and makes re-runs free, which
matters when a threshold wants trying at four values.

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
- `scripts/probe-tokenchange.mjs` — blast radius of the token rule across every
  card set in the repo. Writes nothing, fetches nothing, needs no token.
- `scripts/audit-rulechange.mjs` — the public-side gate. One fetch, both rule
  sets, diffed, with attribution per flag.
- `scripts/fixtures/rulechange-smoke.json` — synthetic, and a mechanism test
  only: proof the audit prices and detects movement before a token run is spent
  on it. Never quote it as a result.
- `scripts/check-nametokens.mjs` — table check for both rules, in
  `npm run check`.

R1 and R2 both pass on every card: given the same comps the pipeline is
deterministic and reaches its fixed point in one pass. The instability is
entirely upstream churn arriving at a pool too small to absorb it.
