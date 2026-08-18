-- Comp Finder — daily Cardmarket price guide
--
-- Cardmarket publish a free daily price-guide JSON per game, keyed on the same
-- product id our `card_catalog` uses — every one of our Pokémon and Riftbound
-- cards matched a price row, so the join is exact with nothing left over.
--
-- Two tables, split on purpose:
--   cm_price_latest   one row per product, overwritten daily. Small (~300k),
--                     indexed, and what the app reads for "what's it worth".
--   cm_price_history  the time series, but only for cards worth charting —
--                     storing every 2p common every day would be ~112M rows a
--                     year for nothing. Threshold + retention keep it sane.
--
-- Run once in the Supabase SQL editor.

-- ---------------------------------------------------------------------------
-- Where to fetch each game's guide. The download page lists a file per game;
-- paste its URL here and the nightly job picks it up — no redeploy needed.
-- ---------------------------------------------------------------------------
create table if not exists public.cm_price_sources (
  game text primary key references public.cm_games(slug) on delete cascade,
  url text not null,
  enabled boolean not null default true,
  last_run_at timestamptz,
  last_as_of date,
  last_rows integer,
  last_error text
);

alter table public.cm_price_sources enable row level security;
drop policy if exists "Price sources are readable" on public.cm_price_sources;
create policy "Price sources are readable" on public.cm_price_sources for select using (true);

-- ===========================================================================
--  ▼▼▼  PRICE-GUIDE URLS  ▼▼▼
--
--  Filled in from the Cardmarket price-guide page. The pattern is
--  `price_guide_<idGame>.json` on the downloads host.
--
--  Re-running is safe: a changed URL updates in place and clears any previous
--  failure, and a line left as PASTE_URL_HERE is skipped entirely.
--
--  Yu-Gi-Oh! is added separately in migration 018, since the game itself has
--  to exist in cm_games before its prices can reference it.
-- ===========================================================================
insert into public.cm_price_sources (game, url, enabled)
select g.game, g.url, true
from (values
  ('pokemon',       'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json'),
  ('magic',         'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_1.json'),
  ('lorcana',       'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_19.json'),
  ('onepiece',      'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_18.json'),
  ('dragonball',    'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_13.json'),
  ('digimon',       'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_17.json'),
  ('fleshandblood', 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_16.json'),
  ('riftbound',     'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_22.json'),
  ('vanguard',      'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_8.json'),
  ('weissschwarz',  'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_10.json')
) as g(game, url)
where g.url not like 'PASTE\_URL\_HERE'          -- unfilled lines are ignored
  and g.url ~ '^https?://'                       -- and anything that isn't a URL
on conflict (game) do update
  set url = excluded.url,
      enabled = true,
      last_error = null;                         -- a corrected URL clears the old failure

-- ---------------------------------------------------------------------------
-- Latest price per product
-- ---------------------------------------------------------------------------
create table if not exists public.cm_price_latest (
  cardmarket_id bigint primary key,
  game text,
  id_category integer,          -- 51 = Pokémon singles, 1655 = Riftbound singles…
  as_of date not null,
  avg numeric(12,2), low numeric(12,2), trend numeric(12,2),
  avg1 numeric(12,2), avg7 numeric(12,2), avg30 numeric(12,2),
  premium_kind text,            -- 'foil' | 'holo' — whichever that game publishes
  p_avg numeric(12,2), p_low numeric(12,2), p_trend numeric(12,2),
  p_avg1 numeric(12,2), p_avg7 numeric(12,2), p_avg30 numeric(12,2),
  updated_at timestamptz not null default now()
);

create index if not exists cm_price_latest_game_idx on public.cm_price_latest (game);
create index if not exists cm_price_latest_trend_idx on public.cm_price_latest (game, trend desc nulls last);

alter table public.cm_price_latest enable row level security;
drop policy if exists "Prices are readable" on public.cm_price_latest;
create policy "Prices are readable" on public.cm_price_latest for select using (true);

-- ---------------------------------------------------------------------------
-- Price history — narrow on purpose: four numbers are all a chart needs, and
-- every extra column multiplies by the row count.
-- ---------------------------------------------------------------------------
create table if not exists public.cm_price_history (
  cardmarket_id bigint not null,
  as_of date not null,
  trend numeric(12,2),
  avg7 numeric(12,2),
  low numeric(12,2),
  p_trend numeric(12,2),
  primary key (cardmarket_id, as_of)
);

create index if not exists cm_price_history_date_idx on public.cm_price_history (as_of);

alter table public.cm_price_history enable row level security;
drop policy if exists "Price history is readable" on public.cm_price_history;
create policy "Price history is readable" on public.cm_price_history for select using (true);

-- ---------------------------------------------------------------------------
-- Retention: keep every day for the recent window, then thin older rows to one
-- per ISO week. Called by the nightly job; safe to run by hand.
--   select public.prune_price_history(120);
-- ---------------------------------------------------------------------------
create or replace function public.prune_price_history(keep_days integer default 120)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  with ranked as (
    select cardmarket_id, as_of,
           row_number() over (
             partition by cardmarket_id, date_trunc('week', as_of)
             order by as_of desc
           ) as rn
    from public.cm_price_history
    where as_of < current_date - keep_days
  )
  delete from public.cm_price_history h
  using ranked r
  where h.cardmarket_id = r.cardmarket_id
    and h.as_of = r.as_of
    and r.rn > 1;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- ---------------------------------------------------------------------------
-- A card with its current price, for the app to read in one go.
-- ---------------------------------------------------------------------------
drop view if exists public.cm_card_prices;
create view public.cm_card_prices
  with (security_invoker = on) as
select
  c.cardmarket_id, c.game, c.name, c.collector_number, c.rarity,
  c.expansion, c.expansion_code,
  p.as_of, p.trend, p.avg7, p.avg30, p.low, p.avg,
  p.premium_kind, p.p_trend, p.p_avg7, p.p_low,
  coalesce(p.trend, p.avg7, p.avg30, p.avg, p.low)               as market,
  coalesce(p.p_trend, p.p_avg7, p.p_avg30, p.p_avg, p.p_low)     as market_premium
from public.card_catalog c
join public.cm_price_latest p on p.cardmarket_id = c.cardmarket_id;

grant select on public.cm_card_prices to anon, authenticated;
grant select on public.cm_price_latest to anon, authenticated;
grant select on public.cm_price_history to anon, authenticated;
grant select on public.cm_price_sources to anon, authenticated;


-- ===========================================================================
--  Where things stand — this is the last statement, so its result is what the
--  SQL editor shows you. One row per game: "ready to pull" once a URL is in.
-- ===========================================================================
select
  g.slug                                as game,
  g.name,
  case
    when s.game is null      then '— no URL yet'
    when s.last_error is not null then '⚠ last run failed: ' || s.last_error
    when s.last_rows is null      then '✅ ready to pull'
    else '✅ ' || s.last_rows || ' prices as of ' || coalesce(s.last_as_of::text, '?')
  end                                   as status,
  s.url
from public.cm_games g
left join public.cm_price_sources s on s.game = g.slug
order by (s.game is null), g.sort_order;


-- ===========================================================================
--  Afterwards
--
--  1. Test ONE game before the nightly job runs for real:
--       GET /api/cron/prices?game=pokemon
--     (add `Authorization: Bearer <CRON_SECRET>` if that's set)
--
--  2. Check it landed:
--       select count(*), max(as_of) from public.cm_price_latest;
--       select * from public.cm_card_prices order by market desc nulls last limit 20;
--
--  3. The nightly cron (04:30, see vercel.json) then keeps every configured
--     game current on its own.
--
--  To pause a game without deleting its URL:
--       update public.cm_price_sources set enabled = false where game = 'magic';
-- ===========================================================================
