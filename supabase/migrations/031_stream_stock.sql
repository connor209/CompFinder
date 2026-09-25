-- Comp Finder — stream stock: cards pulled for eBay Live auctions
--
-- A live stream runs off a pool of ~200 cards pulled out of the stacks. A card
-- stays in that pool until it sells or has been AIRED three times without
-- selling, and only then comes home. Between streams the pool is topped back
-- up to size from what is still in the stacks.
--
-- The pool is not a table of its own. A card in it is CHECKED OUT, exactly as
-- it is for a show (migration 016): the stack numbering closes up behind it
-- and its eBay listing is hidden so it cannot sell twice. What 016 could not
-- say is WHERE a checked-out card went, and every screen that reads open
-- checkouts reads them as "at a show" — the Show Desk, the counter, the
-- binder, the QR storefront, Show history. So:
--
--   stock_checkouts.pool   'show' (the default, and every row before this) or
--                          'stream'. Readers filter on it; a row with no value
--                          is a show row, so code shipped before this
--                          migration and rows written before it agree.
--
--   live_streams           one row per stream. Named, dated, closed once the
--                          packing is done.
--
--   stream_airings         which card went on air in which stream, and what
--                          happened: 'sold', 'unsold', or null while the
--                          stream is still being packed. The count of these
--                          per checkout is how many times a card has had its
--                          chance — the rule is AIRINGS, not streams attended,
--                          because a card sitting unaired in a 200-card box
--                          has not been offered to anyone.
--
-- `hammer_pence` is what it went for on the stream, for the stream's own
-- tally. It is deliberately NOT stock_checkouts.sold_price_pence: an eBay Live
-- sale is an eBay order and reaches Accounts through ebay_sales, and writing
-- it into the cash-sale column as well would count it twice.
--
-- The two new tables are named in apps/app/lib/stream-store.js only.
--
-- Run once in the Supabase SQL editor. Until it is, the Stream stock screen
-- says so and nothing else changes.

alter table public.stock_checkouts
  add column if not exists pool text not null default 'show';

do $$ begin
  alter table public.stock_checkouts
    add constraint stock_checkouts_pool_check check (pool in ('show', 'stream'));
exception when duplicate_object then null;
end $$;

create index if not exists stock_checkouts_user_pool_open_idx
  on public.stock_checkouts (user_id, pool)
  where resolved_at is null;

create table if not exists public.live_streams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  streamed_on date not null default current_date,
  closed_at timestamptz,          -- set once the stream has been packed
  created_at timestamptz not null default now()
);

create index if not exists live_streams_user_idx
  on public.live_streams (user_id, streamed_on desc);

create table if not exists public.stream_airings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stream_id uuid not null references public.live_streams(id) on delete cascade,
  checkout_id uuid not null references public.stock_checkouts(id) on delete cascade,
  aired_at timestamptz not null default now(),
  outcome text check (outcome in ('sold', 'unsold')),  -- null until packed
  hammer_pence integer check (hammer_pence is null or hammer_pence >= 0),
  unique (stream_id, checkout_id)
);

create index if not exists stream_airings_user_checkout_idx
  on public.stream_airings (user_id, checkout_id);

alter table public.live_streams enable row level security;
create policy "own streams - select" on public.live_streams for select using (auth.uid() = user_id);
create policy "own streams - insert" on public.live_streams for insert with check (auth.uid() = user_id);
create policy "own streams - update" on public.live_streams for update using (auth.uid() = user_id);
create policy "own streams - delete" on public.live_streams for delete using (auth.uid() = user_id);

alter table public.stream_airings enable row level security;
create policy "own airings - select" on public.stream_airings for select using (auth.uid() = user_id);
create policy "own airings - insert" on public.stream_airings for insert with check (auth.uid() = user_id);
create policy "own airings - update" on public.stream_airings for update using (auth.uid() = user_id);
create policy "own airings - delete" on public.stream_airings for delete using (auth.uid() = user_id);
