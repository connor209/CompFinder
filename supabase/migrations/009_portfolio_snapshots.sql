-- Comp Finder — daily portfolio snapshots (value over time)
--
-- One row per user per day capturing the state of the inventory: total ask
-- value, recorded cost basis, and item count. Written by the daily cron and
-- on-demand when the user opens the dashboard (upsert on the date, so at most
-- one row per day). Powers the "Portfolio value over time" chart. Run once in
-- the Supabase SQL editor.

create table if not exists public.portfolio_snapshots (
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_date date not null,
  inventory_value_pence bigint not null default 0,
  cost_basis_pence bigint not null default 0,
  item_count integer not null default 0,
  listing_count integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, snapshot_date)
);

create index if not exists portfolio_snapshots_user_date_idx
  on public.portfolio_snapshots (user_id, snapshot_date);

alter table public.portfolio_snapshots enable row level security;

-- Users read their own snapshots directly from the browser (powers the chart).
-- Writes come only from the server (service role), which bypasses RLS — there
-- are deliberately no insert/update policies here.
create policy "Users can view their own portfolio snapshots"
  on public.portfolio_snapshots for select
  using (auth.uid() = user_id);
