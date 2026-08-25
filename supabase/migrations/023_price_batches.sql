-- Comp Finder — saved batch runs
--
-- price_checks already keeps one flat row per priced card, which is what the
-- History page reads. It deliberately throws the comps away, so it can answer
-- "what did we price this at" and nothing else.
--
-- A batch RUN is the thing that was being lost. Pricing 59 cards takes 59
-- SoldComps requests and several minutes, and the results only ever lived in
-- React state: opening a deep dive navigates to another section, which
-- remounts the panel, and the whole run was gone with no way back short of
-- paying for it again.
--
-- So this stores the run: the recommendation for every card INCLUDING the
-- comps it was built from, the filters it ran under, and the CardUploader CSV
-- verbatim so the eBay upload export still works when the run is re-opened
-- days later. Re-opening a run costs nothing upstream — the comps are frozen
-- as they were priced, which is the point: it is a record of a price decision,
-- not a live quote.
--
-- Retention is deliberate, not incidental. These rows are fat (a 60-card run
-- is roughly a megabyte of comps) and their value decays fast — a run is a
-- working document you process over a few days, not an archive. Every row
-- carries expires_at and the panel sweeps its own expired rows whenever the
-- saved-runs list loads, so nothing accumulates silently. RETENTION_DAYS in
-- apps/app/lib/batch-store.js is what sets it; keep the two in step.
--
-- Run once in the Supabase SQL editor.

create table if not exists public.price_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  label text,                 -- "59 cards from stock-aug.csv" — shown in the list
  source text,                -- 'csv' | 'paste'
  csv_name text,
  csv_text text,              -- the upload verbatim, so the eBay export still runs
  filters jsonb not null default '{}'::jsonb,
  item_count integer not null default 0,
  priced_count integer not null default 0,
  status text                 -- 'complete' | 'stopped'
);

create index if not exists price_batches_user_created_idx
  on public.price_batches (user_id, created_at desc);
create index if not exists price_batches_expires_idx
  on public.price_batches (expires_at);

alter table public.price_batches enable row level security;
create policy "own batches - select" on public.price_batches for select using (auth.uid() = user_id);
create policy "own batches - insert" on public.price_batches for insert with check (auth.uid() = user_id);
create policy "own batches - update" on public.price_batches for update using (auth.uid() = user_id);
create policy "own batches - delete" on public.price_batches for delete using (auth.uid() = user_id);

-- One row per card in the run. `rec` is the full recommendation object the
-- results screen renders — including included[] and excluded[], which is what
-- makes a saved run interrogable rather than just a list of prices.
create table if not exists public.price_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.price_batches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  position integer not null,  -- the row's index in the run; also the key the
                              -- panel's active-listing lookups are stored under
  title text not null,
  sku text,
  query text,
  failed text,                -- why this card produced no price, when it didn't
  rec jsonb,
  active_rec jsonb,           -- asking prices, when they were fetched
  csv_item jsonb,             -- the CardUploader row, for the current-price column
  name_tokens jsonb,          -- kept so a re-check of active listings can re-run
  set_name text,              -- "set" is reserved in SQL
  card_number text
);

create index if not exists price_batch_items_batch_idx
  on public.price_batch_items (batch_id, position);

alter table public.price_batch_items enable row level security;
create policy "own batch items - select" on public.price_batch_items for select using (auth.uid() = user_id);
create policy "own batch items - insert" on public.price_batch_items for insert with check (auth.uid() = user_id);
create policy "own batch items - update" on public.price_batch_items for update using (auth.uid() = user_id);
create policy "own batch items - delete" on public.price_batch_items for delete using (auth.uid() = user_id);
