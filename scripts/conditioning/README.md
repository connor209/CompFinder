# Conditioning prep

Straightens a batch of CardUploader scans, writes the crops a grader actually
needs, and scores the back border so the batch arrives **ranked** instead of
raw.

```
pip install pillow numpy
python3 scripts/conditioning/prep_scans.py <carduploader.csv> --out ~/Drive/batches/26.08.06
```

Point `--out` at a Google Drive for Desktop folder and the crops sync without
anything being uploaded through a chat.

## Why it exists

Conditioning by eye is slow because the pixel work happens inside the model's
loop: fetch two images, straighten them, crop four corners, look at all of it,
next card. A hundred cards is four hundred images and a hundred round trips,
and most of it confirms that a clean card is clean.

Writing files is nearly free in tokens. **Looking** at an image is not — about
1,300–1,600 each. So the saving is not in where the files live, it is in how
many of them a grader has to open. This script does the pixel work locally in
about two minutes and hands back a ranking, so the cards that need eyes get
them and the rest do not.

## What comes out

```
<out>/raw/<sku>_front.jpg     as downloaded, cached — never re-fetched
<out>/cards/<sku>/front.jpg   deskewed, cropped, normalised to 700x980
<out>/cards/<sku>/back.jpg
<out>/cards/<sku>/corners-back.jpg   four corner tips at 6x, unenhanced
<out>/triage.csv              one row per card, worst corner first
```

About 55MB of crops and 22MB of originals for a hundred cards.

`triage.csv` carries the per-corner and per-edge scores, the deskew angle
applied, the duplicate group, and a `check_back_era` flag for WotC-era sets.

## Three things it encodes that cost an afternoon to find

**The card cannot be found by brightness.** A Pokémon back's navy border
measures `R0 G0 B47` — luminance 5, because blue carries 11% of it — against a
scanner bed of 0. By brightness the border and the bed are the same thing, so a
luminance mask locks onto the bright *interior* and reports the artwork as the
border. Every measurement then lands on the swirl and a worn card scores clean.
Masking is on `max(R,G,B)`, which separates them 47 to 0 and still works on a
yellow front.

**Scans are not square.** Cards sit 0.3–0.6° off in the feeder. Crop the
bounding box and take its corners and you do not get the card's corners — you
get interior artwork, and it looks plausible enough to grade from. The deskew
fits the left edge over the straight middle only; include the rounded corners
and the fit is dragged to zero, which looks exactly like a deskew that ran.

**Contrast enhancement manufactures wear.** Auto-contrast on the navy border
turns JPEG noise into speckle indistinguishable from whitening — the guide's
"do not describe scanner streaks as scratches" failing in a form it doesn't
anticipate. Crops are magnified but never enhanced, and the score is taken
against each card's own border median so a darker scan doesn't read as a
cleaner card.

## The score is not a grade

It is back-only. A Pokémon back is the one surface measurable without knowing
the card: the border is a known colour in a known place, so whitening is bright
pixels on dark ground. Fronts vary by card and nothing here reads them — so
creases, surface scratches, print lines and anything on the front are invisible
to it. A card can score clean and still be LP.

On the guide's six calibration cards the **worst corner** orders the grades
where the whole-card total does not, which is what the rubric counts:

| grade | sku | worst corner | total |
|---|---|---|---|
| NM | 002 | 0.05 | 0.00 |
| LP | 001 | 0.41 | 0.04 |
| LP | 004 | 0.63 | 0.05 |
| LP | 003 | 2.49 | 0.41 |
| MP | 038 | 2.85 | 0.52 |
| MP | 057 | 9.76 | 1.73 |

Six points is a sanity check, not a measurement, and LP 003 sits right next to
MP 038 — so the bands are deliberately wide and default to `review`. A wrong
unattended NM costs a return; a needless look costs seconds.

```
python3 scripts/conditioning/prep_scans.py <csv> --out DIR --calibrate grades.csv
```

`grades.csv` is `sku,grade`. It prints the score spread per grade so the
thresholds can be set from data rather than from the examples that suggested
them — the same discipline the pricing rules get, and for the same reason.

## Also in the output

`triage.csv` reports duplicate groups: same title, same condition, so
interchangeable copies of one card. A copy joining an existing listing inherits
its price and does not need one of its own, which is why detection belongs
*before* pricing rather than after it.

`check_back_era` flags WotC-era sets (1999–2003) for a look at the pair before
listing. It is not a wear check — it is the guide's hold rule, where a vintage
front has been scanned against a modern swirl back.
