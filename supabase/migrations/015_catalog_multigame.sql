-- Comp Finder — multi-game card catalog
--
-- Extends the existing single-game `card_catalog` (Pokémon only, migration 005)
-- into a browsable catalog across every Cardmarket-supported game we hold:
-- Pokémon, Magic, One Piece, Weiss Schwarz, Vanguard, Digimon, Flesh and Blood,
-- Dragon Ball Super, Lorcana and Riftbound. ~287k real cards (+ ~22k tagged
-- tokens/code/oversized/tip that the browse UI hides by default).
--
-- Non-cards (playmats, sleeves, deck boxes, sealed boosters, binder pages,
-- board games, bulk lots) were filtered out before export — a row is a real
-- product here only if it has a rarity OR a collector number.
--
-- SETUP (run once, in order):
--   1. Run this SQL in the Supabase SQL editor.
--   2. Re-base the catalog data (the old Pokémon rows lack game/category):
--        truncate table public.card_catalog;
--   3. Import each per-game CSV: Table editor → card_catalog → Insert →
--      Import from CSV. The CSV headers already match the columns
--      (incl. game + category). Do the big ones (magic, pokemon) last;
--      each takes a minute or two.

-- ---- 1. New columns on card_catalog -----------------------------------------
-- `game`     : slug tying each card to a game (pokemon, magic, onepiece, …).
-- `category` : card | token | code | oversized | tip — lets the browse UI show
--              real cards by default and reveal the rest on demand.
alter table public.card_catalog add column if not exists game text;
alter table public.card_catalog add column if not exists category text not null default 'card';

-- Existing rows (migration 005) were all Pokémon.
update public.card_catalog set game = 'pokemon' where game is null;

-- ---- 2. Browse indexes ------------------------------------------------------
create index if not exists card_catalog_game_idx on public.card_catalog (game);
create index if not exists card_catalog_game_expansion_idx on public.card_catalog (game, expansion);
create index if not exists card_catalog_game_category_idx on public.card_catalog (game, category);

-- ---- 3. Game metadata (display name, ordering, emoji) -----------------------
create table if not exists public.cm_games (
  slug text primary key,
  name text not null,
  short_name text,
  icon text,
  sort_order int not null default 100
);

insert into public.cm_games (slug, name, short_name, icon, sort_order) values
  ('pokemon',       'Pokémon',                       'Pokémon',   '⚡', 10),
  ('magic',         'Magic: The Gathering',          'Magic',     '🔮', 20),
  ('lorcana',       'Disney Lorcana',                'Lorcana',   '🏰', 30),
  ('onepiece',      'One Piece Card Game',           'One Piece', '🏴‍☠️', 40),
  ('dragonball',    'Dragon Ball Super Card Game',   'Dragon Ball','🐉', 50),
  ('digimon',       'Digimon Card Game',             'Digimon',   '🦖', 60),
  ('fleshandblood', 'Flesh and Blood',               'FAB',       '⚔️', 70),
  ('riftbound',     'Riftbound: League of Legends',  'Riftbound', '🌀', 80),
  ('vanguard',      'Cardfight!! Vanguard',          'Vanguard',  '🛡️', 90),
  ('weissschwarz',  'Weiss Schwarz',                 'Weiss Schwarz','🎴', 100)
on conflict (slug) do update
  set name = excluded.name, short_name = excluded.short_name,
      icon = excluded.icon, sort_order = excluded.sort_order;

alter table public.cm_games enable row level security;
drop policy if exists "Games are readable" on public.cm_games;
create policy "Games are readable" on public.cm_games for select using (true);

-- ---- 4. Set list per game (aggregate view for browsing) ---------------------
-- One row per (game, set), with card counts. security_invoker so it respects
-- the base table's public-read RLS. Cards with no expansion are bucketed under
-- an "Other / Promos" pseudo-set so nothing is unreachable.
drop view if exists public.cm_sets;
create view public.cm_sets
  with (security_invoker = on) as
select
  game,
  coalesce(nullif(expansion, ''), 'Other / Promos') as set_name,
  coalesce(nullif(expansion_code, ''), '')          as set_code,
  count(*)                                           as total_count,
  count(*) filter (where category = 'card')          as card_count
from public.card_catalog
group by game, coalesce(nullif(expansion, ''), 'Other / Promos'), coalesce(nullif(expansion_code, ''), '');

-- ---- 5. Per-game counts (for the game grid) ---------------------------------
drop view if exists public.cm_game_counts;
create view public.cm_game_counts
  with (security_invoker = on) as
select
  game,
  count(*)                                    as total_count,
  count(*) filter (where category = 'card')    as card_count
from public.card_catalog
group by game;

-- ---- 6. Grants (views need explicit select for the API's roles) -------------
grant select on public.cm_sets to anon, authenticated;
grant select on public.cm_game_counts to anon, authenticated;
grant select on public.cm_games to anon, authenticated;
