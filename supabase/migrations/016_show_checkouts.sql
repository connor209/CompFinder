-- Comp Finder — show checkout / check-in for stack stock
--
-- Cards can be CHECKED OUT of their stack (taken to a show or trade day).
-- While away: live stack numbering skips them, and their eBay listing is
-- hidden (quantity 0 where the seller has out-of-stock control, otherwise
-- ended with a relist log). Checked-out cards either come back in (to their
-- old spot, to the back of a stack, or into a fresh stack) or are marked sold
-- at the show — a permanent pull plus a cash-sale record for P&L.
--
-- Run once in the Supabase SQL editor.

alter table public.stack_cards
  add column if not exists checked_out_at timestamptz;

create index if not exists stack_cards_checked_out_idx
  on public.stack_cards (user_id)
  where checked_out_at is not null;

create table if not exists public.stock_checkouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stack_card_id uuid references public.stack_cards(id) on delete set null,
  stack_id uuid,                 -- snapshot: stack it left (survives card moves)
  stack_name text,               -- snapshot: stack name at checkout time
  sku text,
  title text,
  ebay_item_id text,
  event text,                    -- optional show name, e.g. "London Expo Aug"
  hide_method text,              -- how the listing was hidden: 'quantity' | 'ended' | 'none'
  hide_error text,               -- set when hiding was attempted but failed
  checked_out_at timestamptz not null default now(),
  resolved_at timestamptz,       -- null while still away
  resolution text,               -- 'returned' | 'sold' | 'cancelled'
  return_mode text,              -- 'spot' | 'back' | 'new_stack'
  return_stack_id uuid,
  sold_price_pence integer,      -- cash-sale takings (feeds the P&L)
  relisted_item_id text,         -- new item id when an ended listing was relisted
  note text
);

create index if not exists stock_checkouts_user_open_idx
  on public.stock_checkouts (user_id, checked_out_at desc)
  where resolved_at is null;
create index if not exists stock_checkouts_user_resolved_idx
  on public.stock_checkouts (user_id, resolved_at desc);

alter table public.stock_checkouts enable row level security;
create policy "own checkouts - select" on public.stock_checkouts for select using (auth.uid() = user_id);
create policy "own checkouts - insert" on public.stock_checkouts for insert with check (auth.uid() = user_id);
create policy "own checkouts - update" on public.stock_checkouts for update using (auth.uid() = user_id);
create policy "own checkouts - delete" on public.stock_checkouts for delete using (auth.uid() = user_id);
