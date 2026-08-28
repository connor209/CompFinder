# packages/core — the pricing engine

**Read the root `CLAUDE.md` first.** The rule that matters most is there: a
change to anything in this directory changes **both** products, so say so
explicitly and confirm the change is wanted in the app *and* on Last Comp
before editing. A pricing tweak that suits a batch run can be wrong for a
stranger's one-off lookup.

Nothing here may import React, Next, Supabase, or app code. That is what keeps
it shareable; breaking it breaks both apps.

**Run `npm run check` before touching anything in here** — twenty-three table
tests, listed in the root file, several of which exist specifically to fail
loudly when a rule in this directory is widened.

## A slab is not the card underneath it

The engine excluded every graded comp, always, on the reasoning that a slab is
a different object at a different price. Right — and it never asked whether the
card *being priced* was one. So a PSA 10 was fetched with "PSA 10" in the
query, came back with a page of the right card in the right slab, and dropped
all of it. What survived was a proxy, a sleeve and a raw copy, and the card
priced at the **£2.49 floor** — while the graded panel on the same screen
showed the PSA 10 tier at £875, worked out from the comps the price had just
thrown away. Nothing on the row said any of it had happened.

`settings.subjectGrade` (from `subjectGradeFrom()`, one definition in
`packages/core/pricing.js`) is what the engine was missing, and the exclusion
**inverts** on it rather than standing down: pricing a slab, the raw copies go
as `rawCopy` and slabs of a different grade go as `otherGrade`.

- **Grades are kept apart; grading companies are pooled.** A PSA 10 goes for
  several times the same card in a PSA 8, so pooling grades swaps one confident
  wrong number for another. PSA over CGC is a real premium but nothing like
  that gap, and splitting on it as well empties most pools. Worth revisiting
  with a corpus; not worth guessing at.
- **Below `gradedMinComps` there is NO price, and never a fall back to the raw
  market.** That fall back is the original fault, and it is silent. The tiers
  still ride along on `rec.graded`, so the screen shows what was found.
- **The subject test is where the blast radius is.** A false positive on a comp
  costs one comp out of forty; one on the subject throws away every comp that
  *is* the card. Hence `NOT_GRADED_PATTERN` — "not graded", "non-graded", "raw"
  — and why `check-exclusions.mjs` pins ACE SPEC, TAG TEAM and "pristine
  condition" as raw a second time on the subject side.
- **It costs nothing upstream.** `queryForCard()` is unchanged, so a graded and
  a raw search share one cache entry and one SoldComps call; only the filtering
  differs. On the public page the grade is read from what the visitor TYPED
  (`card.asked`), never from `card.q` — `q` is the canonical string the cache
  key hashes, with the grade already stripped out of it.

The rest of this section is about what the app then does with that price, and
the detail lives in `apps/app/CLAUDE.md` under "A show sticker is not a listing
price". It is written here because it only makes sense next to the rule above.

**On the Show Desk a graded sticker starts from what we already ask on eBay**,
rounded to the pound (`stickerRows`, `listed`). The only place a listing price
leads rather than sits beside the suggestion, and scoped to slabs on purpose:
slab sales are thin enough that plenty of cards have none at their grade in
ninety days, and the listing price is a decision already made about that exact
copy with the grade on the label. A raw card is untouched by it — the ladder
and the gate are right there. The sticker box still beats both, and every row
says which of the three it is.

## Measure before adding a pricing rule

The audit harness exists so a rule is judged on data rather than on the two
examples that prompted it. Twice now that has reversed a decision that looked
obvious: "read description" appeared on two £9.99 fakes and turned out to be
ordinary seller language on genuine full-price sales, and a symmetric price
outlier at 8x removes real played copies (which is why the low side sits at
median/12 with a cluster guard).

```
node scripts/build-bigset.mjs                 # English-only chase cards from the catalogue
node scripts/audit-big.mjs --json out.json    # price them all, from apps/public
node scripts/diff-runs.mjs before.json after.json   # per-card, flags LOST prices
node scripts/inspect-spans.mjs "Card 123 Set"       # read the comps behind one price
CORPUS_OUT=corpus.json node scripts/probe-rules.mjs # dump every title, test a regex offline
```

Sold comps cache for 24 hours, so re-running straight after an audit is free
and touches nothing at SoldComps.

## Where the pricing is trustworthy, measured

`scripts/wideset.json` is 371 cards built to be everything the chase-card set
is not — cheap Pokémon commons, trainers, energy, Yu-Gi-Oh and Magic. What it
found, on 2026-08-22:

| population | priced | median comps | wide spans |
|---|---|---|---|
| Pokémon chase (the 455-card set) | 100% | 15+ | 6 of 294 |
| Pokémon trainers | 69/77 | 15 | — |
| Pokémon commons | 188/201 | 5 | — |
| Yu-Gi-Oh | 44/60 | 8 | **14** |
| Magic | 26/33 | 4 | 3 |

**Decided 2026-08-22: the public page is Pokémon-only.** `/api/resolve` and
`/api/suggest` filter on `game = 'pokemon'`, and the copy says so. The engine
is unchanged — `packages/core` still prices any game, and the app still uses
it for all of them.

**Pokémon is reliable; the other games are not, and it isn't a bug.** The whole
engine is anchored on the collector number, which is what separates one
printing from another. Yu-Gi-Oh and Magic sellers mostly don't write it — 33
of 60 Yu-Gi-Oh cards priced only via the name-only fallback — so the tool
pools every printing of a card and reports a number with a 15–50x span. Giant
Growth came back as £5.59 from 30 comps spanning £0.99 to £19.84.

Both caveats fire on those cards ("matched on the card name alone", "matched
very different cards"), but a confident-looking number built on pooled
printings is worse than no answer — hence the scoping above. Lifting it means
giving those games set-anchored matching of their own, not just removing the
filter.
