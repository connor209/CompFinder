-- =============================================================================
-- CompFinder — apply everything outstanding, in one go.
--
-- This is a SAFELY RE-RUNNABLE superset of migrations 012 → 016. If you're not
-- sure which you've already applied, it doesn't matter: run the whole file.
-- Every statement is idempotent (policies are dropped before being recreated,
-- columns/tables/indexes use IF NOT EXISTS), so running it twice changes
-- nothing and throws nothing.
--
-- WHAT IT TURNS ON
--   012  photos on your eBay listings          (public listing-photos bucket)
--   013  deals — multi-card purchases          (deal_cards table)
--   014  receipts / invoices on purchases      (purchases.receipt_paths)
--   015  multi-game card catalogue             (card_catalog + cm_games/cm_sets)
--   016  show checkout / check-in              (stock_checkouts + away flag)
--
-- HOW TO RUN
--   Supabase dashboard → SQL Editor → New query → paste all of this → Run.
--
-- IT DOES NOT TOUCH YOUR DATA. The catalogue import needs a separate,
-- deliberate `truncate table public.card_catalog;` — that is NOT in this file
-- on purpose. Do it only when you're ready to import the CSVs.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 012 · Listing photos (public bucket — eBay fetches images from a public URL)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('listing-photos', 'listing-photos', true)
on conflict (id) do nothing;

-- Public read comes from the bucket being public, so only writes need policies,
-- scoped to each user's own top-level folder.
drop policy if exists "listing photos - insert own" on storage.objects;
create policy "listing photos - insert own"
  on storage.objects for insert
  with check (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "listing photos - delete own" on storage.objects;
create policy "listing photos - delete own"
  on storage.objects for delete
  using (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = auth.uid()::text);


-- ---------------------------------------------------------------------------
-- 013 · Deals — one purchase row is the deal, its cards live in deal_cards
-- ---------------------------------------------------------------------------
alter table public.purchases add column if not exists pricing_mode text;

create table if not exists public.deal_cards (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  amount_pence integer,                      -- per-unit cost basis
  quantity integer not null default 1,
  allocated boolean not null default false,  -- price auto-shared from the deal total
  position integer,
  created_at timestamptz not null default now()
);

create index if not exists deal_cards_purchase_idx on public.deal_cards (purchase_id);
create index if not exists deal_cards_user_idx on public.deal_cards (user_id);

alter table public.deal_cards enable row level security;

drop policy if exists "Users manage their own deal cards - select" on public.deal_cards;
create policy "Users manage their own deal cards - select"
  on public.deal_cards for select using (auth.uid() = user_id);
drop policy if exists "Users manage their own deal cards - insert" on public.deal_cards;
create policy "Users manage their own deal cards - insert"
  on public.deal_cards for insert with check (auth.uid() = user_id);
drop policy if exists "Users manage their own deal cards - update" on public.deal_cards;
create policy "Users manage their own deal cards - update"
  on public.deal_cards for update using (auth.uid() = user_id);
drop policy if exists "Users manage their own deal cards - delete" on public.deal_cards;
create policy "Users manage their own deal cards - delete"
  on public.deal_cards for delete using (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- 014 · Receipts / invoices, kept separate from the haul photo
-- ---------------------------------------------------------------------------
alter table public.purchases
  add column if not exists receipt_paths text[] not null default '{}';


-- ---------------------------------------------------------------------------
-- 015 · Multi-game card catalogue
-- ---------------------------------------------------------------------------
create extension if not exists pg_trgm;

alter table public.card_catalog add column if not exists game text;
alter table public.card_catalog add column if not exists category text not null default 'card';

-- Rows from the original Pokémon-only import predate the `game` column.
update public.card_catalog set game = 'pokemon' where game is null;

create index if not exists card_catalog_game_idx on public.card_catalog (game);
create index if not exists card_catalog_game_expansion_idx on public.card_catalog (game, expansion);
create index if not exists card_catalog_game_category_idx on public.card_catalog (game, category);

create table if not exists public.cm_games (
  slug text primary key,
  name text not null,
  short_name text,
  icon text,
  sort_order int not null default 100
);

insert into public.cm_games (slug, name, short_name, icon, sort_order) values
  ('pokemon',       'Pokémon',                       'Pokémon',      '⚡', 10),
  ('magic',         'Magic: The Gathering',          'Magic',        '🔮', 20),
  ('lorcana',       'Disney Lorcana',                'Lorcana',      '🏰', 30),
  ('onepiece',      'One Piece Card Game',           'One Piece',    '🏴‍☠️', 40),
  ('dragonball',    'Dragon Ball Super Card Game',   'Dragon Ball',  '🐉', 50),
  ('digimon',       'Digimon Card Game',             'Digimon',      '🦖', 60),
  ('fleshandblood', 'Flesh and Blood',               'FAB',          '⚔️', 70),
  ('riftbound',     'Riftbound: League of Legends',  'Riftbound',    '🌀', 80),
  ('vanguard',      'Cardfight!! Vanguard',          'Vanguard',     '🛡️', 90),
  ('weissschwarz',  'Weiss Schwarz',                 'Weiss Schwarz','🎴', 100)
on conflict (slug) do update
  set name = excluded.name, short_name = excluded.short_name,
      icon = excluded.icon, sort_order = excluded.sort_order;

alter table public.cm_games enable row level security;
drop policy if exists "Games are readable" on public.cm_games;
create policy "Games are readable" on public.cm_games for select using (true);

-- One row per (game, set) with counts. security_invoker so it respects the base
-- table's public-read RLS. Cards with no expansion bucket under "Other / Promos".
drop view if exists public.cm_sets;
create view public.cm_sets
  with (security_invoker = on) as
select
  game,
  coalesce(nullif(expansion, ''), 'Other / Promos') as set_name,
  coalesce(nullif(expansion_code, ''), '')          as set_code,
  count(*)                                          as total_count,
  count(*) filter (where category = 'card')         as card_count
from public.card_catalog
group by game, coalesce(nullif(expansion, ''), 'Other / Promos'), coalesce(nullif(expansion_code, ''), '');

drop view if exists public.cm_game_counts;
create view public.cm_game_counts
  with (security_invoker = on) as
select
  game,
  count(*)                                  as total_count,
  count(*) filter (where category = 'card') as card_count
from public.card_catalog
group by game;

grant select on public.cm_sets to anon, authenticated;
grant select on public.cm_game_counts to anon, authenticated;
grant select on public.cm_games to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 016 · Show checkout / check-in
-- ---------------------------------------------------------------------------
alter table public.stack_cards add column if not exists checked_out_at timestamptz;

create index if not exists stack_cards_checked_out_idx
  on public.stack_cards (user_id)
  where checked_out_at is not null;

create table if not exists public.stock_checkouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stack_card_id uuid references public.stack_cards(id) on delete set null,
  stack_id uuid,                 -- snapshot: stack it left
  stack_name text,               -- snapshot: stack name at checkout time
  sku text,
  title text,
  ebay_item_id text,
  event text,                    -- optional show name
  hide_method text,              -- 'quantity' | 'ended' | 'none'
  hide_error text,
  checked_out_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text,               -- 'returned' | 'sold' | 'cancelled'
  return_mode text,              -- 'spot' | 'back' | 'new_stack'
  return_stack_id uuid,
  sold_price_pence integer,
  relisted_item_id text,
  note text
);

create index if not exists stock_checkouts_user_open_idx
  on public.stock_checkouts (user_id, checked_out_at desc)
  where resolved_at is null;
create index if not exists stock_checkouts_user_resolved_idx
  on public.stock_checkouts (user_id, resolved_at desc);

alter table public.stock_checkouts enable row level security;

drop policy if exists "own checkouts - select" on public.stock_checkouts;
create policy "own checkouts - select" on public.stock_checkouts for select using (auth.uid() = user_id);
drop policy if exists "own checkouts - insert" on public.stock_checkouts;
create policy "own checkouts - insert" on public.stock_checkouts for insert with check (auth.uid() = user_id);
drop policy if exists "own checkouts - update" on public.stock_checkouts;
create policy "own checkouts - update" on public.stock_checkouts for update using (auth.uid() = user_id);
drop policy if exists "own checkouts - delete" on public.stock_checkouts;
create policy "own checkouts - delete" on public.stock_checkouts for delete using (auth.uid() = user_id);


-- =============================================================================
-- Done. Expect "Success. No rows returned."
--
-- Sanity check (optional) — should return 5 rows:
--   select table_name from information_schema.tables
--   where table_schema = 'public'
--     and table_name in ('deal_cards','stock_checkouts','cm_games','card_catalog','purchases');
-- =============================================================================
