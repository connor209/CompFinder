-- Public price page (apps/public): a shared response cache and IP rate limiting.
--
-- The public page has no accounts, so it can't use the per-user BYOK key the
-- business app uses — it calls SoldComps with one server-side key. That makes
-- two things load-bearing rather than nice-to-have:
--
--   1. CACHE. Card lookups are extremely head-heavy (the current chase cards
--      are most of the traffic), so serving repeats from here is what keeps
--      the API bill proportional to distinct cards rather than to visitors.
--      It doubles as an asset: SoldComps only exposes a 90-day window, so
--      accumulating results here builds price history we otherwise can't get.
--
--   2. RATE LIMITING. An unauthenticated endpoint that spends money per call
--      gets scraped. Cache-first ordering means a repeat query costs nothing
--      no matter who asks; this table bounds the damage from someone walking
--      the catalogue for *distinct* queries.
--
-- Both tables are written only by the service-role client in the public app's
-- route handler. RLS is on with no policies, so the anon key cannot read or
-- write either one.

create table if not exists public.soldcomps_cache (
  -- Hash of the normalised request (query + site + sold/active + window), so a
  -- lookup is a single primary-key hit. Built in the route, not the DB, since
  -- normalisation has to match how the query was built.
  cache_key    text primary key,
  -- Kept for debugging and for spotting which queries are actually popular.
  query        text not null,
  ebay_site    text not null default 'ebay.co.uk',
  sold         boolean not null default true,
  payload      jsonb not null,
  comp_count   integer not null default 0,
  fetched_at   timestamptz not null default now()
);

-- Serving from cache filters on age, and pruning walks oldest-first.
create index if not exists soldcomps_cache_fetched_at_idx
  on public.soldcomps_cache (fetched_at);
-- "What are people actually searching for" — worth having before we guess.
create index if not exists soldcomps_cache_query_idx
  on public.soldcomps_cache (query);

alter table public.soldcomps_cache enable row level security;

create table if not exists public.public_rate_limit (
  ip           text not null,
  -- Truncated to the hour by the caller, so a row is one IP-hour bucket.
  window_start timestamptz not null,
  count        integer not null default 0,
  primary key (ip, window_start)
);

create index if not exists public_rate_limit_window_idx
  on public.public_rate_limit (window_start);

alter table public.public_rate_limit enable row level security;

-- Increment-and-return in one round trip. Doing this as select-then-update
-- from the route would race between concurrent requests from the same IP and
-- undercount exactly when the limit matters most.
create or replace function public.bump_rate_limit(p_ip text, p_window timestamptz)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count integer;
begin
  insert into public.public_rate_limit (ip, window_start, count)
  values (p_ip, p_window, 1)
  on conflict (ip, window_start)
    do update set count = public.public_rate_limit.count + 1
  returning count into new_count;
  return new_count;
end;
$$;

-- Housekeeping: neither table needs history beyond its useful window.
create or replace function public.prune_public_price_page()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.soldcomps_cache where fetched_at < now() - interval '180 days';
  delete from public.public_rate_limit where window_start < now() - interval '2 days';
$$;
