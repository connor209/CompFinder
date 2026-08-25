-- Comp cache for the business app's own lookups.
--
-- The app had none: every batch run re-fetched every card. Measured over the
-- 2026-08-25 Neo-era work, four runs of the same 89-card list cost 417
-- SoldComps requests where one day's cache would have cost 104. Re-running a
-- list is the normal case, not the exception — you price, you look, you fix a
-- title, you price again.
--
-- SEPARATE from soldcomps_cache, which serves Last Comp. Same idea, and
-- deliberately not the same table: the public page caches one fixed set of
-- search parameters (worldwide, 90 days, one marketplace) while the app varies
-- location, condition, price bounds and window per run, so the keys mean
-- different things. Sharing the table would also put a batch run's misses into
-- the numbers we read to see what visitors search for.
--
-- Applied by hand like every migration here. The code ships first and treats
-- this as OPTIONAL — a missing table degrades to no caching rather than taking
-- the Batch screen down. See CACHE_TTL_SECONDS in apps/app/lib/comp-cache.js.
create table if not exists public.app_comp_cache (
  -- Hash of the query AND every search parameter that changes what comes back.
  -- Built in the app, not here, for the same reason the public one is: the
  -- normalisation has to match how the request was actually made.
  cache_key   text primary key,
  -- Kept readable for debugging and for seeing what a run actually asked for.
  query       text not null,
  sold        boolean not null default true,
  payload     jsonb not null,
  comp_count  integer not null default 0,
  fetched_at  timestamptz not null default now()
);

-- Serving filters on age; pruning walks oldest-first.
create index if not exists app_comp_cache_fetched_at_idx
  on public.app_comp_cache (fetched_at);

alter table public.app_comp_cache enable row level security;

-- Comps are public eBay listing data, not anyone's private information, and
-- this app is operated by one business — so any signed-in user may read and
-- write. The row carries no user_id on purpose: two operators pricing the same
-- card should share the answer rather than each pay for it.
create policy "app_comp_cache readable by authenticated"
  on public.app_comp_cache for select
  to authenticated using (true);

create policy "app_comp_cache writable by authenticated"
  on public.app_comp_cache for insert
  to authenticated with check (true);

create policy "app_comp_cache updatable by authenticated"
  on public.app_comp_cache for update
  to authenticated using (true) with check (true);
