# Listing studio: settings, templates and the inventory view

23 Nov 2026 · **A and B built** (migration 041, `/panel/lab/settings`); C not yet

CompFinder owns listing; CardUploader is used once per stack, for
recognition only. The lab proved the listing method (`docs/LAB_COPIES.md`).
This plan covers the three things CardUploader's screens do that CompFinder
still can't:

- **A. Listing settings:** the account-wide defaults every listing goes up
  with.
- **B. Templates:** how a listing's title and description are written.
- **C. The inventory view:** the stock as cards, with each card's copies
  underneath.

**Still a side build.** All of it applies to lab listings only, lives in
the lab's files and its own tables, and changes nothing about how the rest of
the app lists. Folding it into the main app is step 2 of `LAB_COPIES.md`, and
comes later.

**CardUploader's Automatic eBay Inventory stays off** for any card
CompFinder lists. Two systems revising the same listing would each undo the
other.

## What CompFinder already has

| | Where | Reused how |
|---|---|---|
| eBay business policies, read from eBay | `/api/ebay/policies`, Settings → Listing policies | The lab already lists with them. A takes them as they are |
| Creating a listing with its card condition | `lib/lab-ebay.js` | Grows title, description, Best Offer, shop category and extra images |
| Price, quantity and photo revisions | `lib/ebay.js` | Bulk price, and re-applying a template |
| The card's details from the export | `CardUploaderCsv.extractItems()` | Name, number, set, rarity, year, illustrator, type, stage, language. Currently thrown away after grouping; B needs them kept |
| Catalogue art | `card_catalog.image_small` (migration 022) | English cards only. See the database image below |
| Sold-comps pricing | `/api/batch-comps` | Already used by List all |

## A. Listing settings

One page, `/panel/lab/settings`, saved as one row per account in a new
`listing_settings` table (named in one file).

| Setting | Notes |
|---|---|
| **Policies** | Shows the payment, shipping and return policies the lab lists with (your existing Settings choice), with a link to change them. Not a second copy of that setting. |
| **Shipping by price band** | Optional rules, for example £0–£49.99 → Flat 2nd class and £50+ → Signed For. The first matching band picks the shipping policy; bands may not overlap; no bands means the default. |
| **Category, location, postcode** | Default category 183454 (CCG individual cards). The listing settings the lab keeps on the device today move here. |
| **Best Offer** | Off by default. When on: auto-accept at X% and auto-decline below Y% of the price, which eBay applies itself. |
| **eBay shop categories** | **Sync from eBay** reads your shop's categories; optional rules put a game or set into a category. You have none today, so this is last in the order. |
| **Subtitle** | Left out. eBay charges for it on every listing, and nobody has asked for it. |

## B. Templates

### Title

A builder like CardUploader's:
- **The structure:** an ordered list of placeholders and custom text.
- **Any placeholder can be forced to capitals.**
- **Options:** abbreviate the condition, and use the condition as typed.
- **A live preview on a real card from the current file.**

**eBay's 80-character limit is shown in the preview**: the cut-off point is
marked, and the cards a template would cut are counted before anything is
listed. Today the lab uses CardUploader's title as it comes; with a template,
the template writes it.

Placeholders: name, number, set, set code, rarity, finish/variant, condition,
language, game, year, illustrator, type, stage, SKU and subtype. Graded-only
ones (company, grade, cert) wait until graded cards are in scope.

### Description

- **Up to three templates**, one marked active, with code and preview views.
- **The same placeholders as the title**, written `{name}`, `{set}` and so on.
- **The photo promise is added by the lab, always.** "The photos show the
  exact copy you will receive…" is what the whole method rests on, so a
  template can't remove it by accident. Your current CardUploader text
  already says the same thing in its own words; keep both if you like.
- **Plain HTML allowed, no scripts.** eBay refuses active content, so the lab
  refuses it at save time rather than at listing time.

### Fixed shop images

Up to six images, such as a banner or a condition guide. Each is placed
**first**, **second** or **last** around the copy's own scans and can be
switched on or off. They count towards eBay's 24-picture limit, and the photo
rotation keeps them in place: when a listing moves on to the next copy, only
that copy's scans change.

They need hosting somewhere eBay can fetch them (question 1).

### Subtypes

Your own labels, such as Stamped or Promo. One can be set on a copy group
before listing, used as a placeholder, and filtered on in C.

### Re-applying a template to live listings

**Apply template** on chosen listings revises their title and description on
eBay. It shows the old and new text side by side first, and acts only on
listings ticked on screen. eBay restricts some changes to a listing that
already has sales, so a refusal is shown per listing and the rest carry on.
**To check on one listing before relying on it:** whether eBay lets a
fixed-price listing with sales change its title.

### Left out, on purpose

- **Watermark.** It means editing the image, which needs our own copy of
  every scan. You chose CardUploader's hosting, so a watermark would mean
  reversing that. Add it later only if it's worth its own storage.
- **Database image on the listing.** A stock image on a listing that promises
  "the exact copy" breaks the promise. See the database image below.
- **CardUploader-managed SKUs** and the other marketplaces. CompFinder lists
  on eBay with your location SKUs.

## C. The inventory view

`/panel/lab/inventory`: the lab's stock, built for looking things up. The
existing lab page stays for listing and checking.

### One row per listing (a card in a condition)

| Column | |
|---|---|
| Picture | The card's database image when there is one (see below), otherwise the scan of the copy on show |
| Card | Name, set, number, subtype |
| Condition | NM / LP / MP / HP |
| Status | Live, sold out (quantity 0, still on eBay), or ended |
| Copies | For sale · sold, waiting to be picked · picked. For example "2 · 1 · 3" |
| Price | What the listing asks |
| Market | The sold-comps figure from when it was priced, and when |
| eBay | The item number, linked |
| Added | When the listing went up |

**Open a row** to see each copy in selling order:
- its SKU;
- its pile and live position (TEST2 #4);
- its state (on show, queued, sold to order …, picked);
- its own scan, larger on a tap;
- **✕ Remove** where allowed.

### Search, filters, sort

- **Search:** card name, SKU (any copy), set or eBay item number. Every word
  has to match, in any order, accents ignored.
- **Filters:** status, condition, pile, language, subtype, and "has copies
  waiting to be picked".
- **Sort:** date added, price, name, copies for sale.
- **Paging:** 50 rows a page, with the total count of what matched always
  shown.

### Bulk actions

Each one **acts only on rows ticked on screen**, the app's standing rule;
ticking nothing means nothing, not everything.

- **Set price:** an exact figure, or the latest sold-comps price. Shows old
  and new before anything is sent.
- **Apply template:** see B.
- **End listings.**

Each asks first with the count, logs every eBay change, and lists any
failures without stopping the rest.

### The database image

Useful in exactly one place: the card-level row, to recognise a card at a
glance, and for a card with no scan yet. **Never on a listing**, and never
where a specific copy is meant. That's the rule counter mode settled in the
main app: a mint stock image shown in place of a played copy is a picture of
something you're not selling.

Coverage is the problem. CompFinder's catalogue art is English cards only;
Japanese sets were skipped for want of a set-name map, and all the TEST cards
are Japanese. Options, cheapest first:

1. **CardUploader's database image, if its export carries one** (question 2).
   Kept as a link on the listing row, never fetched while a page loads.
2. **Map Japanese set names** so the catalogue backfill can match them. This
   is bigger work, and it benefits the main app too.
3. **Neither:** the row falls back to the scan of the copy on show, which is
   always there.

## New tables

| Migration | Adds |
|---|---|
| 041 | `listing_settings` (one row per account, the settings and templates as JSON); `lab_listings.card` (the card's details from the export, so templates and filters have them); `lab_listings.subtype`, `market_pence`, `market_at`, `db_image_url` |

Purely additive, like 039 and 040, and named in one file.

## Order

1. **A and B together.** Settings first, then the title and description
   templates with a preview, then fixed images. Done when a new listing goes
   up with your title format, your description and your banner, and the
   preview matched it.
2. **C.** Done when any card, SKU or eBay item number is found in one search,
   and a price change on five ticked listings goes through with one confirm.
3. **Re-apply template** last, once B has been used for a while. It's the one
   piece that rewrites live listings in bulk.

## Questions before building

**Answered 23 Nov:** the existing `listing-photos` bucket; one default
shipping policy, so no price bands; no watermark. The database image is in
the export: CardUploader appends it to `PicURL`, under `/catalog/` where
scans are under `/cards/`, and `splitScans()` separates them by that path.
The export must carry your location SKUs, which means CardUploader's
Automatic eBay Inventory is OFF; a `CS-` SKU is refused with that reason.

1. **Where should the shop images live?** The app already has one Supabase
   storage bucket, and six small images is nothing to store. Or you paste a
   link to images hosted elsewhere.
2. **Does CardUploader's export include a database image?** Send its header
   row, or one row from a recent export, and I'll know which columns there
   are.
3. **Do you want shipping by price band now,** or is one default policy
   enough to start?
4. **Watermark:** leave it out for now?
