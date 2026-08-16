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
--   SCHEMA rows     ✅ present / ❌ missing — anything ❌ is fixed by running
--                   APPLY_PENDING.sql (safe to run whatever state you're in).
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
  select 20, 'CATALOGUE', game,
         to_char(rows,'FM999,999') || ' rows · ' || to_char(cards,'FM999,999') || ' cards · '
           || sets || ' sets · ' || codes || ' with codes'
  from cat
  union all
  select 20, 'CATALOGUE', '— empty —', 'no rows: the import is needed'
  where not exists (select 1 from cat)
),
ebay_row as (
  select 30, 'EBAY', 'account',
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
