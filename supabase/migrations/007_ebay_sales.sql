-- Comp Finder — completed eBay sales (for P&L tracking)
--
-- Cache of recent sold orders pulled via the Fulfillment API. Needs the
-- sell.fulfillment.readonly scope, so users must RECONNECT their eBay account
-- once (the scope was added after the initial connect). Run this once in the
-- Supabase SQL editor.

create table if not exists public.ebay_sales (
  user_id uuid not null references auth.users(id) on delete cascade,
  line_item_id text not null,
  order_id text,
  ebay_item_id text,
  sku text,
  title text,
  quantity integer,
  sold_pence integer,
  currency text,
  sold_date timestamptz,
  synced_at timestamptz not null default now(),
  primary key (user_id, line_item_id)
);

create index if not exists ebay_sales_user_date_idx on public.ebay_sales (user_id, sold_date desc);

alter table public.ebay_sales enable row level security;

-- Users read their own sales (writes come from the server / service role).
create policy "Users can view their own sales"
  on public.ebay_sales for select
  using (auth.uid() = user_id);
