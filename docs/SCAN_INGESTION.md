# Scans, and where they should live

Research note, 2026-08-30. Question: if the digital binder needs a photograph
of every card — front and back — where do those images live, and does the
listing draft need to be ingested into CompFinder and pushed to eBay rather
than assembled elsewhere?

Written after reading `SOP_STACK_TO_LISTING.md` end to end against the code.
The answer to the second question turned out to be mostly "you already do
this", and the interesting finding is what falls on the floor in between.

## TL;DR

- **Host on Supabase Storage. Do not add a vendor.** eBay does not hot-link us
  — it copies each picture into its own picture service at list time — so our
  bucket is on eBay's path for a few seconds per listing and on the binder's
  path forever. That is a small problem, and `listing-photos` (migration 012)
  already solves the hard half of it by being public.
- **Three changes to what exists:** store a storage PATH rather than a public
  URL, make the thumbnail and display sizes at upload with the
  `resizeImage()` we already have, and add one table linking a picture to a
  SKU and a face.
- **The listing draft is already ingested.** `price_batch_items` (migration
  023) holds the SKU, title, set, collector number, the CardUploader row
  verbatim and the priced recommendation. There is no draft table to build.
- **What is missing is that the scans never enter the platform.** Stage 1 of
  the SOP puts fifty images in a Drive folder; Stage 4.4 says *"Add photos —
  paste a URL or upload per row"*. We re-add, one at a time, images we already
  have.
- **`position` is scan order**, because the SOP insists the physical order is
  preserved and CardUploader imports the folder in it. So fifty scans attach to
  fifty SKUs positionally, in one action, with a visual confirm — no filename
  convention and no per-card upload.
- **Photos belong on the SKU, not on the batch.** A saved run is swept after 30
  days by design; a photograph of a card is not a working document.
- **The one genuinely broken thing found on the way:** `AddFixedPriceItem`
  sends no `<SKU>`, so Route A — the SOP's *normal* route — produces listings
  that cannot be matched back to a stack by SKU. See "The SKU hole".

## What eBay actually does with a picture

This is the fact the whole hosting decision rests on, and it is already proven
by our own data rather than assumed.

`ListForm.uploadPhoto()` puts a resized JPEG in the public `listing-photos`
bucket and passes its public URL to `AddFixedPriceItem` as `<PictureURL>`. What
comes back later from `GetMyeBaySelling` into `ebay_listings.image_url` is not
that URL — it is `https://i.ebayimg.com/…/s-l140.jpg`. `showcounter.js` relies
on exactly that, swapping `s-l140` for `s-l1600` to get a bigger copy.

So eBay fetches our URL once, copies the file into eBay Picture Services and
serves its own copy from then on. Two consequences:

- **Storage going down cannot break a live listing.** Whatever we choose, the
  blast radius of an outage is "new listings can't be created", not "every
  listing loses its pictures".
- **The binder is the only long-lived consumer**, which is where the
  performance requirement comes from — not from eBay.

One trap that follows from the same fact: **eBay caches its copy against the
URL it fetched.** Re-scanning a card and writing the new image to the same path
risks eBay serving the old picture on the next listing. Filenames therefore
carry a unique suffix; the path is descriptive, not an identity.

## Where to host

| Option | Verdict |
|---|---|
| **Supabase Storage** (`listing-photos`, migration 012) | **Chosen.** Already public, already wired, one vendor, one set of credentials. |
| Cloudflare R2 | Right answer *later*. Zero egress is what you would be buying, and nothing yet needs it. |
| Vercel Blob | Egress billed, and Hobby limits are tight against a project that has already hit a deploy cap. |
| Google Drive public links | No. Rate-limited, not CDN-backed, and eBay's fetch would be the thing that discovers it. |

**Volume is not the constraint.** Fifty cards, two faces, three sizes is about
35 MB a stack; a hundred stacks a year is ~3.5 GB. That clears the Supabase
free tier, so this assumes Pro — but it is nowhere near a reason to shop
around.

**Bandwidth is the constraint, and it is a venue problem.** A nine-pocket page
is nine pictures at once on a hall sharing one mast. Full-size scans there is
the difference between the binder working and the binder being abandoned
mid-scroll.

### Three sizes, made at upload

`lib/resizeImage.js` already downscales and re-encodes client-side. Call it
three times rather than once:

| Size | Max dimension | Roughly | Used by |
|---|---|---|---|
| `thumb` | 320 px | ~25 KB | the binder grid, the counter list |
| `display` | 900 px | ~90 KB | the card inspector, the eBay `PictureURL` |
| `full` | 1600 px | ~300 KB | zoom, condition inspection, disputes |

Made on the client, so **no dependency on Supabase's paid image
transformations** and no server work. Three uploads instead of one; the upload
is not the slow part of a stack.

A nine-pocket page then costs ~225 KB rather than ~2.7 MB.

### Store a path, not a URL

Both current upload paths call `getPublicUrl()` and keep the string. That bakes
the host into every row: moving to R2 later, or changing bucket, becomes a
migration of every record and a hunt for every place that assumed the shape.

Store `path` and derive the URL in **one** function, the same discipline
`batch-store.js` applies to its table names. `ebay_listings.image_url` stays a
full URL because that one genuinely is eBay's and we do not own its lifetime.

```
listing-photos/
  {user_id}/
    {sku}/
      front-thumb-{id}.jpg
      front-display-{id}.jpg
      front-full-{id}.jpg
      back-thumb-{id}.jpg
      ...
```

The SKU in the path is for a human reading a bucket listing at 11pm. The `{id}`
suffix is what keeps eBay from serving a stale copy after a re-scan. Neither is
the identity — the table is.

## The table

```sql
create table if not exists public.card_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sku text not null,
  face text not null,            -- 'front' | 'back' | 'detail'
  position integer not null default 0,
  path text not null,            -- storage path, NOT a public URL
  width integer,
  height integer,
  bytes integer,
  stack_code text,               -- '260820-001' — ties back to the Drive folder
  captured_at timestamptz not null default now(),
  unique (user_id, sku, face, position)
);
```

Named in exactly one file — `apps/app/lib/card-photos.js` — with a check script
grepping for a second definition, the rule `batch-store.js` and `wants-store.js`
already follow.

**Keyed on SKU rather than on a batch row, deliberately.** `price_batches`
sweeps after `RETENTION_DAYS` (30) because a priced run is a working document
whose value decays fast. A photograph of a card is not that: it is worth as
much in a year, it is evidence in a dispute, and it is what the binder draws.
Tying the two lifetimes together would delete the pictures a month after the
stack was listed.

**`face` is a string with three values rather than a boolean**, because
`detail` is the one people will want third — a photograph of a specific crease
or a signature, on the cards where the disagreement actually happens.

**A pending migration must degrade, not break.** Migrations here are applied by
hand and the code ships first, so every read returns an empty list and every
write returns `{ ok: false, missing: true }` until it is run. The sticker panel
and `wants-store.js` already work this way, and the reason is the same: a
white screen because a migration is pending is a worse outcome than the feature
not being there.

## The draft is already ingested

The question "would we ingest new listing drafts into our platform and then
push to eBay?" has a surprising answer: **we already do, and have since
migration 023.**

`price_batch_items` carries, per card:

| Column | What it is |
|---|---|
| `position` | the row's index in the run — **and therefore the scan order** |
| `sku` | CardUploader's `CustomLabel` |
| `title` | the eBay title |
| `set_name`, `card_number` | the catalogue identity |
| `csv_item` | **the whole CardUploader row**, condition included |
| `rec` | the priced recommendation, comps and all |

and `price_batches` keeps `csv_text` — the upload verbatim — so the eBay export
still runs days later.

That is a listing draft. It has the identity, the condition, the price, the
working behind the price and the original file. `BulkListModal` already reads
it and already calls `AddFixedPriceItem`. **CompFinder is already the place a
listing is assembled and already the thing that publishes it.**

So there is no draft-first rebuild to argue about. There are two holes in a
model that otherwise exists.

### Hole 1 — the scans

SOP Stage 1 produces fifty images in `Drive/260820-001/`. CardUploader consumes
them to identify the cards and they are never referenced again. Stage 4.4 then
says:

> **4.** Add **photos** — paste a URL or upload per row.

Fifty images that already exist, re-added by hand, one row at a time. This is
the largest avoidable cost in the pipeline and it is the reason the binder
cannot be built today.

**The fix is positional, and it is nearly free.** SOP 1.4 requires the physical
order to be preserved through scanning; CardUploader imports the folder in that
order; the CSV exports in that order; `position` is that order. So:

1. At CSV import, also accept the folder of scans (a multi-file input — no
   Drive API, no OAuth, drag the folder in).
2. Attach the nth image to the nth row.
3. **Show the result as a grid and make someone look at it.** A card that
   slipped is obvious at a glance and invisible in a spreadsheet.
4. Resize to three sizes, upload, write `card_photos` rows keyed on the SKU.

The confirm step is the binder grid itself, pointed inward. Building it as the
verification UI first means the binder gets tested by us, on our own data,
before a customer ever sees it — the same argument that put counter mode on a
tablet before it went near an anonymous route.

**Backs are a second pass and are optional per card.** Scanning every back
doubles the slowest stage for a picture that is identical on every card. Its
value is condition evidence, so it earns its place above a value threshold —
the same shape of rule `SHOW_STOREFRONT.md` proposes for photographs at all.
Below the threshold, front plus a condition word is what a buyer needs.

### Hole 2 — the SKU

`addFixedPriceListing()` in `apps/app/lib/ebay.js` builds `<Title>`,
`<StartPrice>`, `<Quantity>`, `<ConditionID>`, `<PictureDetails>` and
`<ItemSpecifics>`. It does not build `<SKU>`, and neither `ListForm` nor
`BulkListModal` passes one — `price_batch_items.sku` is right there and is
dropped.

Route B does not have this problem: File Exchange carries `CustomLabel` and
`ebayexport.js` matches on it explicitly, "never on row order".

So **Route A — the route the SOP calls the normal one — produces listings with
no SKU on eBay**, while Route B produces listings with one. Every SKU-keyed
thing in the app then degrades to fuzzy name matching for those cards:
`checkRow()`'s in-stock column, the Show Desk sticker write-back (which matches
"by SKU rather than row order — the results list gets filtered and re-sorted,
and a sticker on the wrong card is a card sold for the wrong money"), stack
reconciliation, and `stackpos.js`.

It degrades rather than breaks, which is exactly why nobody has noticed. But
SOP Stage 5.2 states the promise plainly — *"The SKU on the listing is what ties
the eBay sale back to the card in the box"* — and on the normal route that is
currently not true.

**Fix it first, and independently of any of the above.** It is one element in
one XML body, it costs nothing, and every other thing in this note assumes it.

## Where the boundary sits

Once both holes are closed, the ownership question answers itself and is worth
writing down so it is not re-litigated:

- **Before a card is listed, CompFinder is the record.** The SKU is minted
  outside (CardUploader) but persisted by us, the identity and condition are
  ours, the price is ours, the scans are ours.
- **Once it is live, eBay is the truth for price, quantity and state.**
  `syncUserListings()` already keeps `ebay_listings` as that cache and should
  keep doing so. We do not shadow it.
- **The handover is the item id returned by `AddFixedPriceItem`**, written back
  onto the draft.
- **`card_photos` spans both** and outlives both, because it is keyed on the
  SKU and the SKU is the card.

The useful consequence: eBay becomes *a* publish target rather than the only
one. That is what a between-shows storefront needs, and it covers the
`SHOW_STOREFRONT.md` open question about stock that never went through eBay at
all.

**Do not rebuild CardUploader.** Identification is the expensive, fiddly part
and theirs works. The ambition here is to stop dropping what it hands us.

## Drive stays

Drive is the archive of the raw scans and the three CSVs, and SOP Stage 5.3 is
right that a complete folder answers "why was this priced at £14" six months
later without anybody remembering.

Supabase holds web-sized derivatives for the app to draw. It is not an archive
and should not be made into one — the full-resolution scanner output belongs
where it is, and paying object-storage rates to duplicate it buys nothing.

## What this does not settle

- **The value threshold for back scans.** Named as a rule above, no number
  behind it. It wants the same treatment the pricing rules get: measure before
  choosing, rather than picking a figure that sounds right.
- **Cards that never went through CardUploader.** Held out of scope, and the
  thing most likely to be wanted second — a card bought at a show, photographed
  on a phone, straight into the binder with no CSV anywhere.
- **Whether the eBay listing should carry the back too.** It costs nothing —
  extra pictures are free — and buyers of played singles ask for backs
  constantly, so it is probably a straightforward conversion win. Untested, and
  worth measuring rather than assuming.
- **Timings.** `SOP_STACK_TO_LISTING.md` still lists "real timings per stage"
  as outstanding. Every claim in this note about where the cost sits is
  reasoned from the steps, not measured. The Turnstile lesson in `CLAUDE.md`
  applies exactly: instrument first, then fix.
