# How the app prices a card

Plain English, for reading rather than for the code. What actually happens to
one card when you press **Run search & price** on the Batch screen.

If this and the code disagree, the code is right and this file is stale — say
so. The behaviour is pinned by `scripts/check-matching.mjs` and
`scripts/check-exclusions.mjs`, and the reasoning behind each rule is in
`docs/APP_BATCH_RECURSION.md`.

**This is the app, not Last Comp.** The public page answers "what is this card
worth"; the app answers "what should I list it at". The pricing engine is
shared (`packages/core`), the rules below are the app's own
(`apps/app/lib/matching.js`), and that separation is deliberate — a rule that
suits a batch run can be wrong for a stranger's one-off lookup.

---

## 1. Build the search

From your CSV row it assembles a search string:

> `Sunkern` + `No. 191` + `Neo Genesis` + `Japanese`
>
> card name · card number · set · language

**The set and language matter more than they look.** A Japanese Neo-era card's
number is its *Pokédex* number — Xatu is No. 178 in Neo Genesis, Neo Discovery,
Neo Revelation and Neo Destiny alike. Without the set there is nothing in the
query separating four different cards, and without the language nothing
separating them from the English prints. Leaving them out was the single
biggest source of wrong prices in the 2026-08-25 batch.

- The **set** is skipped when your CSV says something generic
  ("Miscellaneous Cards & Products", "Other").
- The **language** is read off the eBay title, from a closed list — Japanese,
  Korean, Chinese, German, French, Italian, Spanish, Portuguese. Not on the
  list means nothing is added, rather than a guess: a wrong word here narrows
  the search to nothing.
- **"Use full title"** overrides all of it and searches your literal eBay
  title.

## 2. Ask eBay, with filters

Via SoldComps. The filters are the dropdowns on the Batch screen:

| filter | default | what it does |
|---|---|---|
| Marketplace | `ebay.co.uk` | which eBay site |
| Item location | `domestic` | ask for UK sellers only |
| Condition | `any` | any condition |
| Sold within | `90 days` | how far back to look |
| Min / max price | blank | hard price bounds, off by default |

It asks for up to 240 results and typically gets 40–90 sold listings back.

**Each card costs one request.** A card that needs the live-market check in
step 6 costs two.

## 3. Drop postage that isn't a UK cost

Before anything is priced. Postage over **£6** *and* more than the card itself
is zeroed.

No UK seller charges £14 to post a single card, so that is somebody's
international shipping and it is not what the card is worth. Both conditions
have to hold — £8 of signed-for on an £800 card is a real UK cost, and postage
is only ever material next to a cheap card.

**The sale still counts.** Only the shipping is dropped. Throwing the whole
comp away would be worse: these pools are thin enough already, and the card
genuinely did sell for £2.20.

## 4. Decide which listings are actually your card

Where most of them go. In order:

1. **Name check.** The title must contain the card name and the number.
   Nothing else is required — the set and language steered the *search*, but
   are never demanded in the title. Requiring "Neo Genesis" would bin every
   seller who wrote "Neo", or nothing.
2. **Reverse holo mismatch.** A separately-priced printing. Only kept if you
   searched for one.
3. **Not this kind of thing.** Graded slabs, bundles and counted lots, "choose
   your card" pick-lists, custom/fan-made/proxy cards, promo variants.
4. **Non-UK sellers**, by eBay's own location field.
5. **Wrong set** — when your CSV names a set and at least 4 comps confirm it,
   the ones that don't are dropped.
6. **eBay says it's a different product** — using eBay's own catalogue ID, when
   6+ comps carry one and a clear majority agree. No clear majority, and it
   says so rather than picking a side.
7. **Silly prices** — above 8× the middle, or below a twelfth of it.
8. **Silly postage** — 8× the others', or dwarfing the card, on 6+ comps.

Every listing dropped is kept on screen with its reason. The deep dive shows
all of them.

## 5. Work out the number

Each surviving sale counts as **item price + postage** — what the buyer
actually paid.

The figure is a **recency-weighted median**: a sale's influence halves every
30 days, so last week's sale counts about twice last month's.

Then it rounds **up** onto a 50p ladder off a £2.49 floor — £2.49, £2.99,
£3.49, £3.99. **That is a listing price, not a valuation**, and it is why the
public page deliberately uses a different figure.

**Confidence is just the comp count.** 1–3 Low, 4–9 Medium, 10+ High — knocked
down to Low if the comps visibly disagree with each other.

## 6. Refuse, when it can't be trusted

Two triggers:

- **Fewer than 3 usable sold comps.** Across the 2026-08-25 batch, prices built
  from 2 comps or fewer had a median of £15.49 against £9.99 for those from 4
  or more. Thinner pool, bigger number.
- **Comps spanning more than 8× top to bottom.** They cannot all be the same
  card. Golbat No. 042 came back as 15 comps at £12.99, 6 at £5.08 and 3 at
  £2.60, and blended to £7.99 — right for none of them.

Either one, and it asks **what the card is listed at right now** instead of
trusting the sales. That is what took Sunkern No. 191 from £19.49 to £2.49
against a live market of £2.00.

If the live listings don't agree either, it gives **no price** and says why.
A number you have to know to distrust is worse than no number — the same
reasoning that holds a thin price back from a show sticker.

---

## Two ideas underneath all of it

**Search wide, match narrow.** The query is deliberately specific, so eBay
returns the right printing. The title check is deliberately loose, so good
comps aren't thrown away over wording. Every bad price in the 2026-08-25 batch
came from having that backwards — a query too vague to find one card, and a
title check strict enough to reject the ones it did find.

**Nothing is dropped quietly.** Every exclusion is counted, reasoned and on
screen. If the tool can't answer, it says so rather than printing a number and
a warning nobody reads.

## What this does NOT do

- **No valuation figure.** Everything is a recommended *listing* price, floored
  at £2.49 and rounded up. "What is this worth" is a different number and the
  app doesn't show it.
- **No fee or postage maths.** The number is what to list at, not what you take
  home.
- **Sold data only, unless it says otherwise.** A row marked `active` is
  asking prices, which run higher than sales.
- **It cannot conjure data that isn't there.** For a 1p common, eBay's market
  is "choose your card" pick-lists, correctly excluded — so there is nothing to
  price from, and that is the honest answer rather than a bug.
