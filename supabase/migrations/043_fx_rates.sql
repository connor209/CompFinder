-- Comp Finder — exchange rates (2026-11-24)
-- Cardmarket's price guide is in euros. The nightly price job (/api/cron/prices)
-- fetches the European Central Bank's daily reference rate and keeps the latest
-- here, so every Cardmarket figure on screen is shown in pounds at a rate with a
-- date on it. One row per pair, overwritten daily. Run once in the SQL editor.

create table if not exists public.fx_rates (
  pair text primary key,              -- 'EURGBP': pounds per euro
  rate numeric(12,6) not null,
  as_of date not null,                -- the ECB's own reference date
  source text not null default 'ecb',
  updated_at timestamptz not null default now()
);

alter table public.fx_rates enable row level security;
drop policy if exists "Exchange rates are readable" on public.fx_rates;
create policy "Exchange rates are readable" on public.fx_rates for select using (true);

notify pgrst, 'reload schema';
