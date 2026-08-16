-- =============================================================================
-- CompFinder — what's actually installed?
--
-- Read-only. Changes nothing. Run either query any time you're unsure whether
-- a migration or import is still needed.
--
-- Supabase dashboard → SQL Editor → New query → paste ONE query → Run.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- QUERY 1 · Schema — is each migration applied?
-- Every row should read ✅. Anything ❌ means that migration still needs
-- running (APPLY_PENDING.sql covers all of them, safely).
-- ---------------------------------------------------------------------------
select * from (
  values
    ('012 · listing photos', 'listing-photos storage bucket',
      case when exists (select 1 from storage.buckets where id = 'listing-photos')
        then '✅ present' else '❌ missing' end, 1),
    ('012 · listing photos', 'upload/delete policies',
      case when (select count(*) from pg_policies
                 where schemaname = 'storage' and tablename = 'objects'
                   and policyname in ('listing photos - insert own','listing photos - delete own')) = 2
        then '✅ present' else '❌ missing' end, 2),

    ('013 · deals', 'deal_cards table',
      case when to_regclass('public.deal_cards') is not null
        then '✅ present' else '❌ missing' end, 3),
    ('013 · deals', 'purchases.pricing_mode column',
      case when exists (select 1 from information_schema.columns
                        where table_schema='public' and table_name='purchases' and column_name='pricing_mode')
        then '✅ present' else '❌ missing' end, 4),

    ('014 · receipts', 'purchases.receipt_paths column',
      case when exists (select 1 from information_schema.columns
                        where table_schema='public' and table_name='purchases' and column_name='receipt_paths')
        then '✅ present' else '❌ missing' end, 5),

    ('015 · catalogue', 'card_catalog.game column',
      case when exists (select 1 from information_schema.columns
                        where table_schema='public' and table_name='card_catalog' and column_name='game')
        then '✅ present' else '❌ missing' end, 6),
    ('015 · catalogue', 'card_catalog.category column',
      case when exists (select 1 from information_schema.columns
                        where table_schema='public' and table_name='card_catalog' and column_name='category')
        then '✅ present' else '❌ missing' end, 7),
    ('015 · catalogue', 'cm_games table',
      case when to_regclass('public.cm_games') is not null
        then '✅ present' else '❌ missing' end, 8),
    ('015 · catalogue', 'cm_sets view (set names + codes)',
      case when to_regclass('public.cm_sets') is not null
        then '✅ present' else '❌ missing' end, 9),
    ('015 · catalogue', 'cm_game_counts view',
      case when to_regclass('public.cm_game_counts') is not null
        then '✅ present' else '❌ missing' end, 10),

    ('016 · show desk', 'stock_checkouts table',
      case when to_regclass('public.stock_checkouts') is not null
        then '✅ present' else '❌ missing' end, 11),
    ('016 · show desk', 'stack_cards.checked_out_at column',
      case when exists (select 1 from information_schema.columns
                        where table_schema='public' and table_name='stack_cards' and column_name='checked_out_at')
        then '✅ present' else '❌ missing' end, 12),

    ('eBay', 'account connected',
      coalesce((select '✅ connected ' || to_char(connected_at, 'DD Mon YYYY')
                from public.ebay_accounts order by connected_at desc limit 1),
               '❌ not connected'), 13)
) as t(area, item, status, sort)
order by sort;


-- ---------------------------------------------------------------------------
-- QUERY 2 · Catalogue data — is the import still needed?
--
-- Healthy result: ten games listed, each with sets and codes.
-- A row labelled "(stale — pre-015 rows)" means old Pokémon-only rows are
-- still in there and a re-import would clean them up.
-- Nothing returned at all = the table is empty and the import IS needed.
--
-- Reads the columns via jsonb so it works — and never errors — whether or not
-- migration 015 has added `game`/`category` yet.
-- ---------------------------------------------------------------------------
select
  coalesce(to_jsonb(c) ->> 'game', '(stale — pre-015 rows)')        as game,
  count(*)                                                          as rows,
  count(*) filter (where to_jsonb(c) ->> 'category' = 'card')       as real_cards,
  count(distinct c.expansion)                                       as sets,
  count(distinct c.expansion_code)
    filter (where c.expansion_code is not null
                and c.expansion_code <> '')                         as sets_with_codes
from public.card_catalog c
group by 1
order by rows desc;
