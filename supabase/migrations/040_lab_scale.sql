-- Comp Finder — the quantity-listing lab, step 1 of scaling (docs/LAB_COPIES.md)
--
-- card_key: which card + condition a lab listing is, so new copies of that
-- card JOIN it rather than starting a second listing. Listings made before
-- this are matched on title + condition instead, so it is never required.
--
-- The item-id index is what a sale notification looks its listing up by.
--
-- Run once in the Supabase SQL editor. Purely additive; the lab works without
-- it except that new copies always start a new listing.

alter table public.lab_listings add column if not exists card_key text;
create index if not exists lab_listings_item on public.lab_listings (ebay_item_id) where ended_at is null;
create index if not exists lab_listings_user_key on public.lab_listings (user_id, card_key) where ended_at is null;
