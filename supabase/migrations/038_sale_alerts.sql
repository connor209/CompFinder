-- Comp Finder — which eBay orders have already been announced on Discord
--
-- /api/cron/sale-alerts runs every ten minutes (a GitHub Action calls it) and
-- posts each NEW order to a Discord webhook, with where each card is. This
-- table is the only memory it has of what it already said: an order is
-- recorded after its message posted, so a failed post is retried next run and
-- a missed run catches up rather than skipping.
--
-- Written only by the cron with the service-role key; the browser may read
-- its own rows and nothing else.
--
-- Run once in the Supabase SQL editor. Until it is, the cron posts NOTHING
-- and says so — without this table every run would announce every open order
-- again.

create table if not exists public.sale_alerts (
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id text not null,
  alerted_at timestamptz not null default now(),
  primary key (user_id, order_id)
);

create index if not exists sale_alerts_user_alerted_idx
  on public.sale_alerts (user_id, alerted_at);

alter table public.sale_alerts enable row level security;
create policy "own sale alerts - select" on public.sale_alerts for select using (auth.uid() = user_id);
