-- Comp Finder — recommended sticker prices on checked-out show stock
--
-- The Show Desk checks cards out to a show (migration 016). Those open
-- `stock_checkouts` rows are the show stock list, and the Batch screen can now
-- price the whole pool in one run and write the resulting sticker price back
-- here.
--
-- It lives on the checkout rather than on `stack_cards` because a sticker is a
-- fact about ONE trip: the card goes to a show at £12, comes home unsold, and
-- next month it is worth something else. Checking the card back in resolves the
-- row and the price retires with it, which is the behaviour we want — a stale
-- sticker price is exactly the thing that would otherwise get reprinted.
--
-- `sticker_batch_id` points at the `price_batches` run it came from (migration
-- 023), so months later you can still open the working behind a price you sold
-- a card at. It is deliberately NOT a foreign key: a saved run is swept after
-- 30 days (RETENTION_DAYS in apps/app/lib/batch-store.js) and the sticker on a
-- card must not go with it.
--
-- Run once in the Supabase SQL editor.

alter table public.stock_checkouts
  add column if not exists sticker_pence integer,
  add column if not exists sticker_set_at timestamptz,
  add column if not exists sticker_batch_id uuid;

comment on column public.stock_checkouts.sticker_pence is
  'Recommended cash price for the show table, rounded by stickerPence() in apps/app/lib/showstock.js. Null means no sticker was issued — a thin price is held back rather than printed.';

-- The saved run remembers which show it priced. `source` already says 'stock',
-- but the trip is the useful part: re-opening the run at the table days later
-- is how labels get reprinted, and "43 cards pasted" would say nothing about
-- which box is in front of you.
alter table public.price_batches
  add column if not exists pool_name text;
