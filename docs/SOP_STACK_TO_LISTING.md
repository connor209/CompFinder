# SOP — from a stack of cards to live eBay listings

**Who this is for:** anyone processing cards for the first time. It assumes no
prior knowledge of the tools. Follow it top to bottom; each stage ends with a
check so you know you can move on.

**What one pass through this covers:** 50 cards, scanned, identified,
conditioned, priced and listed, with every file kept together so anyone can
retrace what happened months later.

> 📸 **Screenshots and a walkthrough video are still to be added.** Anywhere you
> see `[screenshot: …]`, a picture is coming. The words are correct as they
> stand — the pictures will just make them faster to follow.

---

## Before you start

You need access to five things. Get all five sorted before touching a card,
because stopping halfway through a stack is how cards get mixed up.

| What | What it's for |
|---|---|
| The office scanner | Turning physical cards into images |
| Google Drive (shared area) | Where every scan and file lives |
| CardUploader | Identifying and conditioning each card |
| CompFinder | Pricing each card against real eBay sales |
| eBay Seller Hub | Publishing the finished listings |

### Words you'll see

- **Stack** — one batch of 50 cards processed together, start to finish.
- **Stack code** — the stack's name. Everything is filed under it.
- **SKU** — the code that identifies one individual card in our system and on
  eBay. It travels with the card from CardUploader all the way to the listing,
  which is how a sold card can be traced back to its physical stack.
- **Comp** — a completed eBay sale of the same card. Prices come from these,
  not from guesswork.
- **Condition** — NM (near mint), LP (lightly played), MP (moderately played),
  HP (heavily played), DMG (damaged).

---

## Stage 1 — Scanning

**1.1 Build a stack of 50 cards.** Fifty is the working unit. Don't scan 200
cards as one job — if something goes wrong you have to unpick all of it.

**1.2 Give the stack its code, and put it on top.** The format is the date
backwards, then a dash, then the stack number for that day:

```
YYMMDD-NNN
```

So the first stack on 20 August 2026 is **`260820-001`**. The second stack that
same day is `260820-002`, the third `260820-003`, and tomorrow starts again at
`-001`. Write the code on a slip and place it as the top card of the stack, so
the stack is identifiable at a glance on the desk, in the scanner tray, and in
the scanned images.

> **Why backwards dates?** Written this way, folders sort themselves into date
> order automatically. `260820` always sits after `260819` and before `260821`.

**1.3 Feed the scanner a maximum of 10 cards at a time.** This is the one rule
people break. The feeder will physically take more, but it jams, and clearing a
jam risks creasing cards. Ten in, scan, ten more, and so on — five passes gets
you through the stack of fifty.

**1.4 Keep the cards in order.** As each group of ten comes out, put it back
face-down on the finished pile in the same order it went in. The physical order
should still match the scan order at the end.

**1.5 Confirm the scans landed in Google Drive.** Create (or confirm) a folder
named **exactly** the stack code:

```
Google Drive/…/260820-001/
```

Every image for this stack goes in here, and nothing from any other stack does.

✅ **Stage 1 is done when:** 50 card images sit in a Drive folder named after
the stack code, and the physical cards are banded together with the code slip
still on top.

`[screenshot: the scanner tray with ten cards loaded]`
`[screenshot: the Drive folder 260820-001 with its scans]`

---

## Stage 2 — Identify and condition in CardUploader

**2.1 Open CardUploader and start a new batch.** Name the batch the stack code
— `260820-001`. Same name as the Drive folder, always.

**2.2 Import the scans** for that stack from the Drive folder.

**2.3 Work through the cards, identifying each one.** CardUploader proposes a
card; your job is to check it's right. Watch for:
- the **set** — the same artwork is often reprinted across sets
- the **card number** — this is what makes it unique inside its set
- **reverse holo / foil** versions, which are different cards with different
  prices to the plain version

**2.4 Condition each card.** Be honest and be consistent — the condition sets
the price, and an over-graded card comes back as a return.

**2.5 Check your count.** The batch should hold exactly 50 cards, with none
left unidentified. Fix any strays now; every problem left here gets harder in
every stage that follows.

**2.6 Export the CSV.** At the **bottom of the batch page** there's an export
button. Download the CSV, then save it into the same Drive folder as the scans:

```
Google Drive/…/260820-001/260820-001-carduploader.csv
```

> ⚠️ **Do not open that CSV in Excel or Google Sheets.** Excel silently turns a
> card number like `4/99` into the date `Apr-99` and saves it that way.
> CompFinder detects and repairs that specific damage when it reads the file,
> but eBay wouldn't — so a mangled file that goes to eBay produces wrong
> listings. If you need to look inside it, look, don't save.

✅ **Stage 2 is done when:** the Drive folder holds the scans **and** the
CardUploader CSV, and all 50 cards are identified and conditioned.

`[screenshot: CardUploader batch page with the export button at the bottom]`

---

## Stage 3 — Pricing in CompFinder

**3.1 Open CompFinder and go to `Pricing → Batch`.**

**3.2 Upload the CardUploader CSV.** Use the **Upload CardUploader CSV** button
below the divider. CompFinder reads the card name, number, set, condition and
SKU straight out of the file — you don't retype anything. It confirms how many
rows it found; check that number is 50.

**3.3 Check the search filters** before running. The defaults are usually
right, but glance at them:
- **eBay marketplace** — United Kingdom
- **Sold within** — how far back to look for sales. Longer windows find more
  comps for scarce cards, but older sales are less relevant for hot ones.
- **Min / max price** — leave empty unless you're deliberately filtering
- **Include condition in the search text** — on, so a NM price isn't set by
  played copies
- **Also fetch active listings** — optional, and it uses roughly twice the
  search quota. Leave it off for a routine stack; you can check active prices
  on individual cards afterwards.

**3.4 Press "Run search & price".** It works through the list card by card.
The chip at the top of the page tracks how many searches you've used this
month — worth a glance, since the quota is shared.

**3.5 Review the results. This is the part that matters.** Each card comes back
with a recommended price and a confidence badge:

- **High** — plenty of clean matching sales. Accept it.
- **Medium** — worth a look, especially on anything valuable.
- **Low** — few or noisy comps. Check it yourself.
- **Skipped** — nothing usable was found. This one needs doing by hand.

Useful controls on the results panel:
- the **confidence filter** — set it to `Low` to deal with the awkward ones as
  a group
- **Show current price & highlight big changes** — displays the price
  CardUploader had on the card next to CompFinder's recommendation, and
  highlights any big gap. A large jump either way usually means a
  mis-identification, not a bargain.
- clicking the **comps count** on a card opens the actual sales used and the
  ones excluded, with the reason for each

**3.6 Handle the Low and Skipped cards by hand.** Use **Quick Search** (or
**Deep dive ↗** from the card) to search the card yourself, adjusting the
wording until you get sensible comps. Typical causes: an unusual set name, a
promo or misprint, a reverse holo not flagged as one, or a card so scarce that
nothing has sold recently. If nothing genuinely comparable exists, price it
against the nearest equivalent and note that you did.

**3.7 Check what we already have listed.** Search the card name in **My
Listings** to see whether we're already selling one, and at what price — you
generally want your new copy priced in line with the existing one rather than
undercutting yourself.

> **How this works today:** that check is a manual look-up in My Listings.
> CompFinder does not yet automatically match a batch against our own live
> stock and show the price we used last time.

**3.8 Export the results.** Press **Export CSV** on the results panel and save
it into the same Drive folder:

```
Google Drive/…/260820-001/260820-001-compfinder.csv
```

That file is the record of what each card was priced at and why — the comps
used, the confidence, and any note.

✅ **Stage 3 is done when:** every card has a price you're happy to stand
behind, nothing is left as Skipped without a manual decision, and the
CompFinder export sits in the Drive folder alongside the other two files.

`[screenshot: the Batch upload area]`
`[screenshot: results with a High, a Low and a Skipped card]`

---

## Stage 4 — Getting them onto eBay

There are two routes. **Route A is the normal one.** Route B exists for bulk
uploads through eBay's own reports tool.

### Route A — list directly from CompFinder

1. On the results panel, press **🏷️ List on eBay**. The number in brackets is
   how many priced cards it will list.
2. Set the **title template** and the **default condition**. The template fills
   in each card's name, number and set automatically.
3. Check the **postage and returns** settings. If our eBay business policies are
   linked, it says so and uses them; if not, fill in the postage fields.
4. Add **photos** — paste a URL or upload per row.
5. Set **quantity** (normally 1 — each card is a single item).
6. Press the create button and let it run.

`[screenshot: the List on eBay dialog]`

### Route B — bulk upload through eBay Reports (File Exchange)

Use this when you want everything to go up as one upload rather than
card-by-card.

The CardUploader CSV is already in eBay's File Exchange format — it has the
`*Title`, `CustomLabel` (the SKU) and `*StartPrice` columns eBay expects. So
the job is to put CompFinder's prices into it:

1. Open the CardUploader CSV **in a text-safe way** (see the Excel warning
   above — if you must use a spreadsheet, keep the card-number column formatted
   as text and check `4/99` still looks like `4/99` before saving).
2. For each row, replace `*StartPrice` with the recommended price from the
   CompFinder export. **Match the rows on the SKU** (`CustomLabel`), never on
   the row order.
3. Save it into the Drive folder as `260820-001-ebay-upload.csv`.
4. In **eBay Seller Hub → Reports**, upload that file, then check the upload
   result report eBay produces for any rejected rows.

> **How this works today:** CompFinder's export is a pricing report, not an
> eBay upload file, so step 2 is a manual merge. A one-click "export as eBay
> upload file" would remove it — worth asking for if Route B becomes routine.

✅ **Stage 4 is done when:** the cards are live on eBay and any rejected rows
from the upload report have been fixed and re-uploaded.

---

## Stage 5 — Filing it away

1. **Sync My Listings** in CompFinder so the new listings appear in our own
   records.
2. **Put the cards away as a stack** and record it in **Stacks**, so a sold
   card can be found physically. The SKU on the listing is what ties the eBay
   sale back to the card in the box.
3. **Leave the Drive folder complete.** By the end it holds:

```
260820-001/
├── (50 card scans)
├── 260820-001-carduploader.csv    ← what each card is, and its condition
├── 260820-001-compfinder.csv      ← what it was priced at, and why
└── 260820-001-ebay-upload.csv     ← only if you used Route B
```

If someone asks in six months why a card was priced at £14, that folder answers
it without anyone having to remember.

---

## The whole thing on one page

1. 50 cards → stack code `YYMMDD-NNN` on top
2. Scan **10 at a time**, never more
3. Drive folder named the stack code
4. CardUploader: import → identify → condition → export CSV → save to the folder
5. CompFinder → Pricing → Batch: upload that CSV → run → review Low/Skipped →
   export CSV → save to the folder
6. eBay: **List on eBay** (Route A) or merge prices and upload via Reports
   (Route B)
7. Sync My Listings, record the stack, leave the folder complete

---

## When something goes wrong

| Problem | What to do |
|---|---|
| Scanner jams | You loaded more than ten. Clear it gently, check for creased cards, reload ten. |
| A scan is missing or unreadable | Rescan that single card into the same folder before starting CardUploader. |
| CardUploader identifies the wrong card | Correct it there and then. A wrong card ID makes every price after it wrong. |
| CompFinder says fewer than 50 rows | The CSV is incomplete or was damaged after export. Re-export it from CardUploader. |
| A card number shows as `Apr-99` | The file went through Excel. Re-export from CardUploader rather than fixing it by hand. |
| Lots of Low confidence results | Usually the set name or the reverse-holo flag. Try Quick Search with the wording adjusted. |
| A recommended price looks wildly wrong | Open the comps. It's normally a graded copy or a sealed item in the results — price it against the raw singles. |
| The search quota chip is high | Turn off "also fetch active listings" and avoid re-running whole batches unnecessarily. |
| eBay rejects rows on upload | Read eBay's upload report — it names the row and the reason. Usually a missing item specific or a bad category. |

---

## Still to add

- Screenshots at every `[screenshot: …]` marker
- A short screen-recording of one full stack, start to finish
- Real timings per stage, once we've measured a few stacks
- The office scanner's own settings (resolution, file naming), once confirmed
