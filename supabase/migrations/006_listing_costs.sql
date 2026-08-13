-- Comp Finder — cost basis per listing (for true margin)
--
-- Stores what you paid per item, keyed by eBay item id, so inventory and the
-- dashboard can show real margin (value/market − cost), not just market price.
-- Run once in the Supabase SQL editor.

create table if not exists public.listing_costs (
  user_id uuid not null references auth.users(id) on delete cascade,
  ebay_item_id text not null,
  cost_pence integer,
  note text,
  updated_at timestamptz not null default now(),
  primary key (user_id, ebay_item_id)
);

alter table public.listing_costs enable row level security;

-- The user owns their cost data and edits it directly from the browser.
create policy "Users manage their own costs - select"
  on public.listing_costs for select using (auth.uid() = user_id);
create policy "Users manage their own costs - insert"
  on public.listing_costs for insert with check (auth.uid() = user_id);
create policy "Users manage their own costs - update"
  on public.listing_costs for update using (auth.uid() = user_id);
create policy "Users manage their own costs - delete"
  on public.listing_costs for delete using (auth.uid() = user_id);
