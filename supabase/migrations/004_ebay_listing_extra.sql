-- Comp Finder — extra eBay listing fields (for the table / column picker)
--
-- Stores less-critical eBay fields (listing format, condition, quantity sold,
-- watch count, start time, category) in a single flexible JSONB column so the
-- inventory table can expose them as optional columns without a migration per
-- field. Run once in the Supabase SQL editor.
--
-- Safe to run anytime: the sync and inventory read both work with or without
-- this column (they fall back gracefully), but the extra columns only populate
-- once it exists.

alter table public.ebay_listings
  add column if not exists extra jsonb not null default '{}'::jsonb;
