# The CardUploader export

CardUploader exports eBay's File Exchange bulk-listing format. Confirmed
against a real 97-row UK export (`26.08.06-001`, 31 Aug 2026), 67 columns.

## Columns this skill touches

| column | what it holds | confirmed value in a fresh export |
|---|---|---|
| `CustomLabel` | the SKU | `26.08.06-001-001` — batch date, batch no., position |
| `*Title` | listing title | `Pikachu 065/202 Sword & Shield Pokemon NM` |
| `PicURL` | **the scans** | two URLs, `front\|back`, pipe-separated, public |
| `*ConditionID` | eBay's numeric condition | `4000` on every row |
| `C:Card Condition` | the label | `Near Mint or Better:` (note the trailing colon) |
| `CD:Card Condition - (ID: 40001)` | label + sub-ID | `Near Mint or Better: -(ID: 400010)` |
| `*Description` | listing body, HTML | one identical boilerplate on every row |
| `*StartPrice` | price | `2.49` on every row |
| `*Quantity` | copies | `1` on every row |
| `*C:Set`, `*C:Card Number`, `*C:Card Name` | item specifics | used for duplicate grouping |

**A fresh export is a blank slate.** Every row comes out `Add` / `4000` /
`Near Mint or Better:` / `£2.49` / quantity 1. Nothing has been conditioned or
priced — those defaults are placeholders, not decisions, which is exactly why
this is the right handoff point.

## Writing a grade back — and why the default is not to

Three columns have to agree, and only the NM strings are known:

```
*ConditionID                        4000
C:Card Condition                    Near Mint or Better:
CD:Card Condition - (ID: 40001)     Near Mint or Better: -(ID: 400010)
```

eBay's numeric IDs for ungraded TCG singles are almost certainly `4000` NM,
`5000` Lightly Played, `6000` Moderately Played, `7000` Heavily Played, `8000`
Damaged — but **the exact label strings and the `-(ID: …)` sub-IDs for anything
other than NM have not been observed**, and they cannot be derived. A guessed
enum in an upload file does not fail loudly; it either rejects the batch or
lists a hundred cards at the wrong condition.

So by default this skill writes a **review sheet**, not a rewritten upload
file. The grades go into CardUploader, which knows the right strings.

To unlock direct writing: condition a handful of cards by hand in CardUploader
across LP / MP / HP / DMG, export, read the three columns off those rows, and
fill this table in. Then the skill can write the CSV and be trusted to.

| grade | `*ConditionID` | `C:Card Condition` | `CD:Card Condition - (ID: 40001)` |
|---|---|---|---|
| NM | 4000 | `Near Mint or Better:` | `Near Mint or Better: -(ID: 400010)` |
| LP | ? | ? | ? |
| MP | ? | ? | ? |
| HP | ? | ? | ? |
| DMG | ? | ? | ? |

## Flaw notes in the description

`*Description` is HTML (`<br>` for breaks) and identical across rows, so a flaw
note is an append to the shared boilerplate rather than a replacement. Keep the
guide's tone: name the real flaws, short, honest, no apology, no hiding.

## One quirk worth knowing

If the CSV is ever opened and re-saved in Excel or Sheets, a `*C:Card Number`
cell holding only something like `4/99` gets silently rewritten as `Apr-99`.
The repo's `apps/app/lib/carduploader.js` has `repairExcelDateMangling()` for
exactly this. Prefer not to open the file in a spreadsheet at all.
