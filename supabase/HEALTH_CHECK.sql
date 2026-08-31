-- =============================================================================
-- CompFinder — what's actually installed?
--
-- Read-only. Changes nothing. ONE query, so you can paste the whole file and
-- hit Run — the Supabase SQL editor only shows the LAST result set, which is
-- why this is deliberately a single statement rather than several.
--
-- Supabase dashboard → SQL Editor → New query → paste all → Run.
--
-- HOW TO READ IT
--   SCHEMA rows     ✅ present / ❌ missing, one group per migration, in order.
--                   A ❌ in 012–016 is fixed by running APPLY_PENDING.sql (safe
--                   to run whatever state you're in). A ❌ in 017 and later is
--                   fixed by running that migration's OWN file from
--                   supabase/migrations/ — APPLY_PENDING stops at 016 and is
--                   not going to grow, because the later ones import data,
--                   replace functions and hold locks, and lumping those into a
--                   paste-the-whole-thing file is how one gets run by accident.
--                   Every migration here is applied BY HAND, so this list is
--                   the only answer to "what's still to do".
--                   018 is not listed: it imports Yu-Gi-Oh! rather than
--                   changing the schema, so it shows in the CATALOGUE rows
--                   below — a "yugioh" line means it ran.
--   CATALOGUE rows  one per game, with cards / sets / set-codes. Ten games =
--                   fully imported. Only "pokemon" = Pokémon works, the other
--                   nine games are absent. "(stale — pre-015)" = rows that
--                   never got tagged. "— empty —" = nothing imported at all.
--   EBAY row        can't be checked in SQL (no scopes stored). The app is the
--                   test: if Pull sheet / Sales show a "Reconnect" banner, do it.
-- =============================================================================

with schema_checks as (
  select * from (values
    (1, 'SCHEMA · 012 listing photos', 'listing-photos storage bucket',
      case when exists (select 1 from storage.buckets where id = 'listing-photos')
        then '✅ present' else '❌ missing' end),
    (2, 'SCHEMA · 012 listing photos', 'upload/delete policies',
      case when (select count(*) from pg_policies
                 where schemaname = 'storage' and tablename = 'objects'
                   and policyname in ('listing photos - insert own','listing photos - delete own')) = 2
        then '✅ present' else '❌ missing' end),
    (3, 'SCHEMA · 013 deals', 'deal_cards table',
      case when to_regclass('public.deal_cards') is not null
        then '✅ present' else '❌ missing' end),
    (4, 'SCHEMA · 013 deals', 'purchases.pricing_mode column',
      case when exists (select 1 from information_schema.columns
                        where table_schema='public' and table_name='purchases' and column_name='pricing_mode')
        then '✅ present' else '❌ missing' end),
    (5, 'SCHEMA · 014 receipts', 'purchases.receipt_paths column',
      case when exists (select 1 from information_schema.columns
                        where table_schema='public' and table_name='purchases' and column_name='receipt_paths')
        then '✅ present' else '❌ missing' end),
    (6, 'SCHEMA · 015 catalogue', 'card_catalog.game column',
      case when exists (select 1 from information_schema.columns
                        where table_schema='public' and table_name='card_catalog' and column_name='game')
        then '✅ present' else '❌ missing' end),
    (7, 'SCHEMA · 015 catalogue', 'card_catalog.category column',
      case when exists (select 1 from information_schema.columns
                        where table_schema='public' and table_name='card_catalog' and column_name='category')
        then '✅ present' else '❌ missing' end),
    (8, 'SCHEMA · 015 catalogue', 'cm_games table',
      case when to_regclass('public.cm_games') is not null
        then '✅ present' else '❌ missing' end),
    (9, 'SCHEMA · 015 catalogue', 'cm_sets view (set names + codes)',
      case when to_regclass('public.cm_sets') is not null
        then '✅ present' else '❌ missing' end),
    (10, 'SCHEMA · 015 catalogue', 'cm_game_counts view',
      case when to_regclass('public.cm_game_counts') is not null
        then '✅ present' else '❌ missing' end),
    (11, 'SCHEMA · 016 show desk', 'stock_checkouts table',
      case when to_regclass('public.stock_checkouts') is not null
        then '✅ present' else '❌ missing' end),
    (12, 'SCHEMA · 016 show desk', 'stack_cards.checked_out_at column',
      case when exists (select 1 from information_schema.columns
                        where table_schema='public' and table_name='stack_cards' and column_name='checked_out_at')
        then '✅ present' else '❌ missing' end),
    (13, 'SCHEMA · 017 price guide', 'cm_price_latest table',
      case when to_regclass('public.cm_price_latest') is not null
        then '✅ present' else '❌ missing' end),
    (14, 'SCHEMA · 017 price guide', 'cm_price_history table',
      case when to_regclass('public.cm_price_history') is not null
        then '✅ present' else '❌ missing' end),
    (15, 'SCHEMA · 019 public page', 'soldcomps_cache table',
      case when to_regclass('public.soldcomps_cache') is not null
        then '✅ present' else '❌ missing' end),
    (16, 'SCHEMA · 019 public page', 'public_rate_limit table',
      case when to_regclass('public.public_rate_limit') is not null
        then '✅ present' else '❌ missing' end),
    (17, 'SCHEMA · 020 fuzzy search', 'card_catalog.name_plain column',
      case when exists (select 1 from information_schema.columns
                        where table_schema='public' and table_name='card_catalog' and column_name='name_plain')
        then '✅ present' else '❌ missing' end),
    (18, 'SCHEMA · 020 fuzzy search', 'search_catalog_fuzzy() function',
      case when exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                        where ns.nspname = 'public' and p.proname = 'search_catalog_fuzzy')
        then '✅ present' else '❌ missing' end),
    (19, 'SCHEMA · 021 soldcomps pacer', 'soldcomps_pacer table',
      case when to_regclass('public.soldcomps_pacer') is not null
        then '✅ present' else '❌ missing' end),
    (20, 'SCHEMA · 021 soldcomps pacer', 'claim_soldcomps_slot() function',
      case when exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                        where ns.nspname = 'public' and p.proname = 'claim_soldcomps_slot')
        then '✅ present' else '❌ missing' end),
    (21, 'SCHEMA · 022 card images', 'card_catalog.image_small column',
      case when exists (select 1 from information_schema.columns
                        where table_schema='public' and table_name='card_catalog' and column_name='image_small')
        then '✅ present' else '❌ missing' end),
    (22, 'SCHEMA · 022 card images', 'card_catalog.image_checked_at column',
      case when exists (select 1 from information_schema.columns
                        where table_schema='public' and table_name='card_catalog' and column_name='image_checked_at')
        then '✅ present' else '❌ missing' end),
    (23, 'SCHEMA · 023 saved batches', 'price_batches table',
      case when to_regclass('public.price_batches') is not null
        then '✅ present' else '❌ missing' end),
    (24, 'SCHEMA · 023 saved batches', 'price_batch_items table',
      case when to_regclass('public.price_batch_items') is not null
        then '✅ present' else '❌ missing' end),
    (25, 'SCHEMA · 024 show stickers', 'stock_checkouts.sticker_pence column',
      case when exists (select 1 from information_schema.columns
                        where table_schema='public' and table_name='stock_checkouts' and column_name='sticker_pence')
        then '✅ present' else '❌ missing' end),
    (26, 'SCHEMA · 024 show stickers', 'price_batches.pool_name column',
      case when exists (select 1 from information_schema.columns
                        where table_schema='public' and table_name='price_batches' and column_name='pool_name')
        then '✅ present' else '❌ missing' end),
    (27, 'SCHEMA · 025 app comp cache', 'app_comp_cache table',
      case when to_regclass('public.app_comp_cache') is not null
        then '✅ present' else '❌ missing' end),
    (28, 'SCHEMA · 026 show wants', 'show_wants table',
      case when to_regclass('public.show_wants') is not null
        then '✅ present' else '❌ missing' end)
  ) as v(sort, area, item, detail)
),
-- Columns read via jsonb so this works whether or not 015 has been applied.
cat as (
  select
    coalesce(to_jsonb(c) ->> 'game', '(stale — pre-015)') as game,
    count(*)                                              as rows,
    count(*) filter (where to_jsonb(c) ->> 'category' = 'card') as cards,
    count(distinct c.expansion)                           as sets,
    count(distinct c.expansion_code)
      filter (where c.expansion_code is not null and c.expansion_code <> '') as codes
  from public.card_catalog c
  group by 1
),
catalogue_rows as (
  select 100, 'CATALOGUE', game,
         to_char(rows,'FM999,999') || ' rows · ' || to_char(cards,'FM999,999') || ' cards · '
           || sets || ' sets · ' || codes || ' with codes'
  from cat
  union all
  select 100, 'CATALOGUE', '— empty —', 'no rows: the import is needed'
  where not exists (select 1 from cat)
),
ebay_row as (
  select 200, 'EBAY', 'account',
    coalesce((select 'connected ' || to_char(connected_at,'DD Mon YYYY') || ' — check the app for a Reconnect banner'
              from public.ebay_accounts order by connected_at desc limit 1),
             '❌ not connected')
)
select area, item, detail
from (
  select * from schema_checks
  union all select * from catalogue_rows
  union all select * from ebay_row
) all_rows(sort, area, item, detail)
order by sort, item;
