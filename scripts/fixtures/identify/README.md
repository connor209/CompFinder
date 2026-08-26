# The photo corpus

`corpus.json` is a list of photographs and the card that was actually in each
one. It is the only thing that can say whether the scan panel is any good, and
it is the expensive part of `docs/CARD_IMAGE_RECOGNITION.md` — everything else
there is a weekend.

`corpus.json` and the photos are **not committed**: they are ours, they are
tens of megabytes, and a card photo taken off a customer's stack is not
something to put in a public repo. `corpus.example.json` is committed as the
documented shape, and `check-identify.mjs` validates it against the loader so
the two cannot drift.

## Building one

```
mkdir -p scripts/fixtures/identify/photos          # drop the photos in here
node scripts/audit-identify.mjs --stub scripts/fixtures/identify/photos
```

That writes a row per photo with the labels blank. Fill them in **from the
card**, not from what the tool says — a corpus labelled by the thing being
measured measures nothing. Re-running `--stub` adds new photos and leaves
labelled rows alone.

```json
{
  "file": "photos/0001.jpg",
  "name": "Umbreon VMAX",
  "number": "215/203",
  "set": "Evolving Skies",
  "note": "sleeved, hall lighting"
}
```

- **`file`** — relative to `corpus.json`.
- **`name`** — as the catalogue spells it. `Nidoran [M]` and `Nidoran♂` are
  the same card to the grader; `Charizard` and `Charizard ex` are not.
- **`number`** — `"215/203"`. Give both halves when the card prints both: the
  denominator is the entire difference between Charizard ex 223/165 and
  223/197, and the grader scores it separately.
- **`set`** — optional and scored leniently. `"Evolving Skies"` matches
  `"Sword & Shield Evolving Skies"`.
- **`expect: "abstain"`** — a decoy. A photo with no card in it: the table, a
  hand, a sealed pack, a frame taken mid-swing. Leave `name` and `number` off.
  These are in the corpus because the panel prices whatever comes back, so a
  card invented out of an empty frame gets a price and a confidence badge like
  any other.

## What to put in it

Roughly 150 photos, shot the way the tool is actually used — on the phone, at
a table, in the light that happens to be there. Weight it toward what the
scan is for rather than toward what is easy to photograph:

- **Sleeved and double-sleeved cards**, because that is how anything worth
  scanning is stored, and the glare lands across the bottom of the card where
  the number is.
- **Holo and reverse holo**, for the same reason.
- **Cheap commons** as well as chase cards. A £1 card misread costs nothing; a
  £1 card misread as a £300 one is how you overpay for a box of bulk.
- **Promos and old sets** — `SWSH039` with no denominator, a 1999 Base Set
  card whose number sits somewhere else entirely.
- **Bad photos you would actually take**: at an angle, half in shadow, one
  card in a stack, a thumb in the corner. The failures worth knowing about are
  the ones the tool meets on a Sunday morning at a fair.
- **A dozen decoys.**

Photos should be about what the browser sends: JPEG, longest edge 1024 (see
`frameToBase64FromVideo` in `apps/app/app/panel/Scan.js`). The audit warns
about anything much larger — a 4000px original measures a model on an image the
app will never send it, and the bill is per input token.

## Running it

```
node scripts/audit-identify.mjs                         # score what ships
node scripts/audit-identify.mjs --model claude-sonnet-5 # is a bigger model worth it?
node scripts/audit-identify.mjs --json runs/haiku.json  # keep the run
```
