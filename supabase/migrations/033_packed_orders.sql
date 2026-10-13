-- Comp Finder — which orders WE have packed
--
-- The pull sheet used to read "still to do" straight off eBay: every order
-- whose fulfilment status was NOT_STARTED or IN_PROGRESS. Printing a postage
-- label through eBay uploads its tracking number, and eBay counts that as
-- DISPATCHED — so an order whose label was printed first vanished from the
-- sheet before anybody had pulled or packed the card. Labels could not be
-- printed before the piles were made.
--
-- eBay's "dispatched" now means "label printed". This table is ours: an order
-- is done when its pile is completed on the Pack screen, and the sheet keeps a
-- label-printed order until then.
--
-- Named in apps/app/lib/packed-store.js only.
--
-- Run once in the Supabase SQL editor. Until it is, the pull sheet works as it
-- always did (label-printed orders drop off) and says this migration is why.

create table if not exists public.packed_orders (
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id text not null,
  packed_at timestamptz not null default now(),
  primary key (user_id, order_id)
);

create index if not exists packed_orders_user_packed_idx
  on public.packed_orders (user_id, packed_at);

alter table public.packed_orders enable row level security;
create policy "own packed orders - select" on public.packed_orders for select using (auth.uid() = user_id);
create policy "own packed orders - insert" on public.packed_orders for insert with check (auth.uid() = user_id);
create policy "own packed orders - update" on public.packed_orders for update using (auth.uid() = user_id);
create policy "own packed orders - delete" on public.packed_orders for delete using (auth.uid() = user_id);
