---
name: card-conditioning
description: Condition a batch of Pokémon TCG cards from a CardUploader CSV export — assign NM/LP/MP/HP/DMG grades against the house guide, write flaw notes, flag scan pairs that must not be listed, and group duplicate copies for multi-quantity listings. Use this whenever someone mentions conditioning, grading, or assessing the condition of trading cards, has a CardUploader export or a batch of card scans to work through, asks what condition some cards are in, wants card wear or damage assessed from images, or is preparing a batch of cards for an eBay listing upload. Also use it when someone has a folder of card scans and wants them sorted, triaged, or checked before listing, even if they don't say the word "conditioning".
---

# Card conditioning

Grade a batch of Pokémon singles from their scans and hand back a review sheet
the seller can act on.

The house guide in `references/conditioning-guide.md` is the authority on every
call. Read it before grading anything — it is short, it is specific, and it
carries house lines ("fewer than three countable wear points") that turn
judgement into counting so two graders land on the same step. Where the guide
and anything else disagree, the guide wins.

## Why this skill exists

The slow way to condition a batch is to look at every card: fetch two scans,
straighten them, crop four corners, look at all of it, next card. A hundred
cards is four hundred images, and almost all of that effort goes into
confirming that a clean card is clean.

Writing files costs almost nothing. **Looking** at an image is the expensive
part. So the work is arranged to look at as few as possible: a script does the
pixel work locally and ranks the batch, and only the cards the ranking cannot
settle get opened.

## The workflow

### 1. Find the inputs

A CardUploader CSV export. The scans do not need to be supplied separately —
they are in the file, two public URLs per row in the `PicURL` column. If
someone offers a Drive folder of images as well, the CSV alone is still enough.

`references/carduploader-csv.md` describes the columns.

### 2. Run the prep script

```bash
pip install pillow numpy    # once
python3 scripts/prep_scans.py <export.csv> --out <output-dir>
```

About two minutes per hundred cards. Point `--out` at a synced folder (Drive
for Desktop, Dropbox) if the crops should be available outside this session.

It writes deskewed front and back per card, two review sheets from the back,
and `triage.csv` — one row per card, **already sorted worst corner first**.

- `corners-back.jpg` — the four corners at 2.7x. Corner nicks.
- `edges-back.jpg` — the four edges flattened and stretched, outer edge of the
  card along the top of each strip. Edge whitening along its whole run.

If the run reports `base` values much below 40, or puts nearly everything in
`likely-worse`, the card-edge detection has missed and the scores mean nothing.
Say so rather than grading from them.

### 3. Work down the ranking, not through the batch

`triage.csv` sorts the batch so the cards most likely to be worn come first.
Read it before opening a single image.

- **`likely-worse`** — open `cards/<sku>/corners-back.jpg` for each. These earn
  a look.
- **`review`** — keep going down the list. The scores fall away; when cards
  stop being interesting, stop opening them. Not opening the tail is the point
  of the ranking, not a corner being cut.
- **`likely-nm`** — leave them.
- **`check_back_era` = yes** — open `front.jpg` and `back.jpg` together. This
  flags WotC-era sets (1999–2003), where a vintage front scanned against a
  modern swirl back means the scanner paired the wrong two images. That is a
  hold under the guide, not a grade.

When a card genuinely needs a close look, read the two sheets rather than the
full-size scans — between them they cover every corner and every edge in two
images instead of eight separate reads.

**The two sheets answer different questions, and the guide asks both.** Corner
nicks are what the NM line counts ("fewer than three countable wear points").
Edge wear along a whole run is what the MP line turns on ("consistent
full-perimeter back edge wear") — which no corner crop can show, because it is
a judgement about the length of an edge rather than about any point on it.

Both sheets are sized to arrive without being downscaled — an image is shrunk
to 1568px on its longest edge before it reaches you, so a bigger sheet is not a
clearer one. Reading both costs about 2,100 tokens a card. If a call is still
too close to make, the answer is a tighter crop of that one card, never a
larger version of the same sheet.

**On the edge sheet, a continuous hairline right along the outer edge is the
scanner catching the card, not wear.** It shows up on cards with nothing wrong
with them. Real edge wear is DISCRETE: distinct blobs with dark border between
them, and "full-perimeter" means those blobs run the length of several edges.
Reading the hairline as whitening is the guide's "do not describe scanner
streaks as scratches" failing in its most tempting form.

### 4. Grade against the guide

Apply `references/conditioning-guide.md`. Three of its rules do the most work
and are the easiest to drift from:

**The score is not a grade, and it is back-only.** It measures bright pixels on
the navy back border — whitening and corner nicks. Fronts vary too much by card
to threshold, so creases, surface scratches, print lines and holo scratches are
invisible to it. **A card can score clean and still be LP.** Where the score
and the guide disagree, grade by the guide.

**Do not invent wear from a crop.** A corner magnified 6× shows JPEG artefacts,
paper fibre and scanner noise. The guide is explicit that scanner streaks, scan
rainbow, moiré on holos and dust that would wipe are *not* grade hits. A
countable wear point is a distinct nick, chip, whitening patch or scratch — not
every pixel on a zoomed corner. If a mark is only visible because the crop is
magnified, it is not a wear point.

**Hold rather than guess.** Mismatched front/back eras, a card that cannot be
identified, or a scan that is not a usable listing photo all go on hold. A hold
is a better outcome than a confident wrong grade, and far better than listing a
card whose photo is of something else.

### 5. Hand back a review sheet

Write `conditioning-review.csv` next to the triage, one row per card:

| column | contents |
|---|---|
| `sku` | from `CustomLabel` |
| `title` | the listing title |
| `grade` | NM / LP / MP / HP / DMG, or `HOLD` |
| `flaw_note` | one line for the listing, or blank for a clean card |
| `confidence` | high / medium / low |
| `evidence` | what was actually seen — "four corner-tip nicks, back" |
| `looked` | yes if a crop was opened, no if it was taken on the score |

`evidence` and `looked` matter more than they look. A grade nobody can trace
back to something seen is indistinguishable from a guess, and the seller needs
to know which cards were graded from a picture and which were sorted by a
number.

**Do not rewrite the upload CSV by default.** Only the NM condition strings are
known; the rest cannot be derived, and a guessed enum either rejects the batch
or lists a hundred cards at the wrong condition. `references/carduploader-csv.md`
explains what to harvest to unlock direct writing.

### 6. Report the two things that are not grades

**Holds**, individually, with what is wrong and what to do — usually rescan the
matching back.

**Duplicate groups.** `triage.csv` carries `duplicate_of` and `copies`: same
title and condition means interchangeable copies of one card. These are
multi-quantity candidates, and a copy joining an existing listing inherits its
price rather than needing one of its own — so they are worth knowing about
*before* the batch is priced, not after.

## Grading without the script

If Python is unavailable, the work still holds — it is just slower. Fetch the
two `PicURL` images per row, look at each card front and back at card size
first (the guide is explicit that a tight crop alone is not enough), then
closer only where something shows. Grade by the guide, produce the same review
sheet, and say that the batch was graded unranked so the seller knows every
card was looked at rather than triaged.

## What good looks like

A batch comes back with: every card graded or held, flaw notes only where there
are flaws, the holds named, the duplicate groups listed, and an honest split of
which grades were seen and which were inferred from the ranking. Nothing is
graded more confidently than the evidence supports.
