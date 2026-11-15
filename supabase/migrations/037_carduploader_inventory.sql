-- Comp Finder — cards CardUploader lists, and which order line took a copy
--
-- CardUploader lists our newer stock as "pick your card" variation listings.
-- Each card still has a location SKU (IR19 — stack IR, card 19), but eBay
-- never hears it: the variation is sold under CardUploader's own SKU
-- (CS-P3NSJY_982a1be2), one per card AND condition, shared by every copy of
-- it. Fourteen LP copies of one common are fourteen stack cards and one eBay
-- SKU. So the pull sheet could not get from an order line to a stack, and
-- the nightly import never stacked these cards at all.
--
-- listing_sku   the SKU eBay reports when this copy's variation sells.
--               Written by Stacks → Import CardUploader inventory, from the
--               inventory export's "eBay SKU" column.
-- pulled_line   the eBay order line a pulled card was pulled FOR. With one
--               card per SKU, "the SKU is pulled" meant "this line is done".
--               With several copies behind one SKU it does not: after a
--               commit the next copy is still there, and a reload would hand
--               the same order line the next copy and pull that one too.
--
-- Run once in the Supabase SQL editor. Until it is, the inventory import
-- refuses to run (the cards would be unmatchable) and Commit writes
-- pulled_at alone, as before.

alter table public.stack_cards
  add column if not exists listing_sku text,
  add column if not exists pulled_line text;

create index if not exists stack_cards_user_listing_sku_idx
  on public.stack_cards (user_id, listing_sku);
