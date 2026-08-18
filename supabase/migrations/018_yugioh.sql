-- Comp Finder — add Yu-Gi-Oh! to the catalogue
--
-- The original ten-game import didn't include Yu-Gi-Oh!, so its cards, its
-- (already-built) sell-sheet format and its price guide all had nothing to
-- hang off. This registers the game; the cards themselves come from the
-- yugioh_part1-3.csv import (see below).
--
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Register the game. Slotted after Magic — it's one of the big three.
-- ---------------------------------------------------------------------------
insert into public.cm_games (slug, name, short_name, icon, sort_order) values
  ('yugioh', 'Yu-Gi-Oh!', 'Yu-Gi-Oh!', '🃏', 25)
on conflict (slug) do update
  set name = excluded.name, short_name = excluded.short_name,
      icon = excluded.icon, sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- 2. Its daily price guide. Depends on cm_price_sources from migration 017,
--    and on the row above existing (the table's game column references
--    cm_games), which is why this runs after it.
-- ---------------------------------------------------------------------------
insert into public.cm_price_sources (game, url, enabled) values
  ('yugioh', 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_3.json', true)
on conflict (game) do update
  set url = excluded.url, enabled = true, last_error = null;

-- ---------------------------------------------------------------------------
-- 3. THEN import the cards: Table editor → card_catalog → Insert → Import from
--    CSV, for yugioh_part1.csv, yugioh_part2.csv and yugioh_part3.csv.
--    86,484 rows (86,064 real cards + 420 tokens/code cards) across 1,174 sets.
--    Headers already match the columns; no truncate, these are additive.
-- ---------------------------------------------------------------------------

-- Check afterwards — expect 86,484 once all three parts are in.
select
  (select count(*) from public.card_catalog where game = 'yugioh')                        as yugioh_rows,
  (select count(*) from public.card_catalog where game = 'yugioh' and category = 'card')  as real_cards,
  (select count(distinct expansion) from public.card_catalog where game = 'yugioh')       as sets,
  (select url from public.cm_price_sources where game = 'yugioh')                         as price_url;
