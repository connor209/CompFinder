# Recognising a card from a photograph

Research, 2026-08-26, prompted by: could we train a model to identify cards
from pictures?

Numbers below are either **measured** (from the code, or from the image
backfill of 2026-08-23) or **researched**. Proposals are marked as proposals.
The only thing implemented so far is the stage 0 harness at the bottom, and
its corpus does not exist yet.

---

## The short version

1. We already ship a card reader and have never measured it. That is the first
   job, and it is an afternoon's work — `scripts/audit-identify.mjs`.
2. If we do go further, it is a **retrieval** problem, not a classification
   one. Nobody should train a 32,000-class classifier that needs retraining
   every set release.
3. Two things buy more accuracy than a better model: **straightening the card
   before reading it**, and **cropping the collector number**.
4. The metric is not accuracy. It is **how often it confidently prices the
   wrong card**, because that is the failure that costs money at a table.

---

## What we ship today

`apps/app/app/api/identify/route.js` sends a photo to Claude Haiku 4.5 and gets
back the text printed on the card — name, collector number, set, variant — plus
a search query built from the parts it could read. `Scan.js` then prices that
query straight from sold comps. The prompt, the schema and the model id now
live in `apps/app/lib/identify.js` so that something other than a browser can
call them; the route is auth and transport.

Two things are worth saying plainly about it.

**It is OCR, and that is the right instinct.** The whole pricing engine is
anchored on the collector number — it is what separates one printing from
another, and it is why the tool works on Pokémon and doesn't on Yu-Gi-Oh (see
CLAUDE.md). A model that recognised the *artwork* perfectly would still hand
back "Charizard, Base Set era" and leave us pooling six printings at six
prices. Whatever we build, the number has to come out of it.

**Nothing confirms the read, so no scan produces a label.** The route's comment
says the identification is a suggestion the user confirms before anything is
priced. They don't: `identifyAndPrice` in `Scan.js` goes from `/api/identify`
straight to `/api/soldcomps`. Every scan is therefore a photograph and a human
who knows what it was, and we throw both away. That is the cheapest training
data this project will ever have access to and we are currently binning it.

## Why not train a classifier

The obvious shape — a softmax over every card — is the wrong one here:

- **32,365 English catalogue rows**, and about 200 new ones every set release.
  A classifier has to be retrained for each, and is helpless on a set it has
  never seen. New sets are precisely when scanning matters most, because that
  is when prices move and when nobody knows what anything is worth.
- **One image per class.** The catalogue has exactly one reference picture per
  card (migration 022). That is a fine anchor and a hopeless training set for
  a 32,000-way classifier.

The shape that fits is **retrieval**: turn the photo into a vector, turn every
reference image into a vector once, and take the nearest neighbours. A new set
costs 200 forward passes and an index append — no retraining, ever. That
property is worth more than a few points of accuracy, and it is what makes the
difference between a model and a maintenance liability.

We already own the reference set: **21,162 catalogue rows carry art** — 65% of
all English rows, but **84% of the cards people actually search and 90% of the
455-card chase set**, because the missing rows are sealed product, World
Championship decks and Japanese-named sets tcgdex doesn't index. That is the
part of this most projects have to scrape, and it is already keyed to the same
`cardmarket_id` the pricing runs off.

## The two things that buy more than a better model

**Rectify before you recognise.** Detect the card's rectangle, correct the
perspective to the fixed 63×88mm aspect, and everything downstream sees a
canonical image instead of a hand-held one at 20° with a table in the corner.
OpenCV contour detection does this with no training at all, and it improves the
reader *we already ship* — Haiku would be reading a clean card rather than a
photograph of a room. It is also the step that makes every later stage cheaper:
a rectified card can be cropped by fixed proportions.

**Then crop the number and read that.** On a rectified card the collector
number sits at a known fraction of the frame for each era. A crop of that
corner, read on its own, collapses a 32,000-way problem into a catalogue
lookup — and a crop is a fraction of the input tokens of a whole card.

Put together, the architecture is the one `scripts/lib/card-images.mjs` already
uses to match art to catalogue rows, which is not a coincidence — it is the
same problem from the other side:

> **art narrows the candidates → the number picks one → the name is a guard on
> the result.**

The name is never the key. A name match with a wrong number is the most
confident failure mode there is.

## The ladder

Cheapest first. Each stage is judged on the same harness, and each one is
allowed to end the project.

| Stage | What | Training | Effort | Cost |
|---|---|---|---|---|
| **0** | Score the reader we already ship | none | an afternoon + labelling | ~50p a run |
| **1** | Rectify, then ORB/pHash against the 21,162 reference arts | none | a day or two | free after the index |
| **2** | Off-the-shelf CLIP or DINOv2 embeddings, k-NN | none | a day | free after the index |
| **3** | Fine-tune an embedding on augmented art | GPU hours | a week | ~£10-15 |

**Stage 0** is the only one that is unambiguously worth doing, and it is
implemented below.

**Stage 1** is classical computer vision: perceptual hashes are near-free but
fall over on holo glare, which is most of what we care about; ORB keypoint
matching against the printed artwork is more robust and still needs no
training. Worth an afternoon because if it works on the rectified card, stages
2 and 3 are moot.

**Stage 2** is where "a model" first enters, and it involves no training. A
frozen DINOv2-S or CLIP ViT-B produces an embedding per image; the reference
index is 21,162 vectors, about **16-22MB at fp16** depending on the backbone,
which is small enough to hold in memory, ship to a browser, or put in pgvector
next to the catalogue it belongs to. The task is *same-artwork* matching, which
is what these backbones are already good at, so the honest expectation is that
this is most of the way there. It has to be measured, not assumed.

**Stage 3** is the only stage that is actually "training a model", and it needs
data we do not have: photographs of cards in the wild. Two sources, in order of
value:

- **Synthetic, from the art we already hold.** One reference image becomes
  fifty plausible phone photos: perspective warp, specular highlights and holo
  sheen, sleeve reflection, motion blur, JPEG artefacts, colour temperature,
  cluttered backgrounds, crop jitter, partial occlusion by a thumb. The label
  is free because we generated it. Train with ArcFace using card-as-class, then
  **throw the classifier head away and keep the embedding** — which is what
  keeps the new-set property from the section above.
- **Real photographs, which we own already.** `purchase-photos` and
  `listing-photos` (migrations 011 and 012) are private and public Supabase
  buckets full of our own cards, shot on the phone the scanning happens on, and
  the listings say what they are. That is a real corpus of exactly the right
  distribution, and it costs nothing to mine.

A note on that last one: those buckets are per-user and RLS'd to their owner.
Today that is one user and the answer is easy. If Pro ever has other users,
training on their photos is a decision to make deliberately and say out loud in
the terms, not something to inherit from a script that was convenient once.

## Measure first: stage 0

The house rule is that a rule gets judged on data rather than on the two
examples that prompted it, and it has already reversed two decisions that
looked obvious (the "read description" fake filter, the symmetric price
outlier). The same applies here, and more so — everything above is an argument
about a system whose current accuracy is unknown.

```
node scripts/audit-identify.mjs --stub scripts/fixtures/identify/photos
node scripts/audit-identify.mjs                          # score what ships
node scripts/audit-identify.mjs --model claude-sonnet-5  # is a bigger model worth it?
node scripts/audit-identify.mjs --json runs/haiku.json   # keep the run
```

It calls `lib/identify.js` directly — the same prompt, schema and model the
panel uses — over a corpus of photographs labelled with the card that was
actually in front of the camera. `scripts/fixtures/identify/README.md` says how
to build one; roughly 150 photos, shot the way the tool is used, weighted
toward sleeved and holo cards because that is where the glare lands on the
number.

**It scores four outcomes, and they are not a scale from good to bad.**

| outcome | what it means | what it costs |
|---|---|---|
| **right** | the query would have priced the card in the photo | nothing |
| **name-only** | no number read, so the search pools every printing | a wide span and a caveat |
| **abstained** | it said it couldn't read a card | a re-scan |
| **wrong** | a clean, confident query for a *different* card | money |

The headline number is **wrong-when-it-priced-anything**, not accuracy. An
abstention is a good outcome for a tool whose answer you act on with cash in
your hand at a fair, so a model that abstains more and is wrong less is the
better model even when its headline accuracy is lower — and an accuracy figure
alone cannot tell those two apart. This is the same argument as the £44.75
hero: everywhere else on a card page a bad match is absorbed by a median, and
here it is the answer.

The corpus carries **decoys** — photos with no card in them — because the panel
prices whatever comes back. A card invented out of an empty frame gets a price
and a confidence badge like any other, and nobody has ever checked whether that
happens.

`scripts/check-identify.mjs` is the grader's own table, and its false-positive
cases matter more than its true ones, same as `check-exclusions.mjs`: every one
is a read that a lenient grader would have called correct. Charizard against
Charizard ex, Eevee against Eevee V, 223/165 against 223/197. A grader that
flatters the model is worse than no grader, because it ends the investigation
with a number nobody should have believed.

Running the whole thing costs **under 50p** at Haiku rates for 150 photos, or
about twice that for a Sonnet comparison run. The labelling is the expensive
part, and there is no way around doing it by hand — a corpus labelled by the
thing being measured measures nothing.

## Where it would run

Vercel functions have no GPU, and the ones we have are deliberately in `lhr1`
next to Supabase. So:

- **Training** happens offline, on a rented GPU for a few hours. Nothing about
  it touches the deployment.
- **Reference embedding** happens once, offline, in the same shape as
  `scripts/backfill-images.mjs`: a script, run by hand or from Actions, writing
  to `card_catalog`. pgvector is the least new infrastructure — the vectors
  belong next to the rows they describe.
- **Inference** is either a small server endpoint (simple, costs a function
  invocation) or ONNX in the browser (no server cost, works with a bad signal
  at a fair, but ships a 20MB index and a model to the phone). The second is
  more attractive than it sounds for exactly the use case scanning exists for,
  and it is a decision to make after stage 2, not before.

## What this cannot do, at any stage

Worth writing down so it doesn't get promised:

- **Condition.** A phone photo at 1024px cannot grade edges or surface, and a
  price that assumed near-mint on a played card is wrong in the expensive
  direction. The engine now prices played cards off played comps; the scan has
  no way to know which it is looking at.
- **Fakes.** The cheap tail of a chase card's listings is where counterfeits
  collect, and telling one from a photograph is a different and much harder
  problem than telling one card from another.
- **First edition and print-run stamps** at that resolution — those are text
  problems, and they belong to the number crop rather than to art matching.

## Open, and unmeasured

- The current reader's accuracy. Everything above is an argument until the
  corpus exists.
- Whether rectification alone closes most of the gap. It is cheap enough to
  test before anything else.
- Whether a bigger model is worth it, and at what abstention rate. `--model`
  answers this the day the corpus lands.
- What proportion of scans are of cards outside the 21,162 with art — Japanese
  cards especially, where we have no reference image at all and OCR is the only
  route.
