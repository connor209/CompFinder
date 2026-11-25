-- Comp Finder — the pricing queue (apps/app/lib/pricing-queue.js)
--
-- Pricing ran in the tab that asked for it, each tab pacing only itself, so
-- ten batches priced at once were ten callers against SoldComps' one limit of
-- 60 a minute — and the lookups past it fail. The queue makes pricing ONE
-- consumer per account: a batch is queued as a job, a single server worker
-- prices the jobs in order at a fixed rate under the limit, and the tabs only
-- read the answers back.
--
-- pricing_jobs   one queued request to price some of a batch's rows. `cards`
--                is the snapshot priced (row id + card fields), `results`
--                the answers by row id, written as each card is done, so a
--                tab can fill rows in while the job runs and a worker that
--                stops picks up where the last left off.
-- pricing_leases one row per account: which worker holds the queue, until
--                when. A worker takes it only once it has expired, so two
--                workers never run for one account — that is the rate limit.
--
-- Named in apps/app/lib/pricing-queue.js only. Run once in the Supabase SQL
-- editor; until it is, Add copies prices in the tab as before.

create table if not exists public.pricing_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  batch_id uuid references public.lab_batches(id) on delete cascade,
  batch_name text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  total integer not null default 0,
  done integer not null default 0,
  priced integer not null default 0,
  no_price integer not null default 0,
  failed integer not null default 0,
  searches integer not null default 0,
  cache_hits integer not null default 0,
  cards jsonb not null default '[]'::jsonb,
  results jsonb not null default '{}'::jsonb,
  error text
);

create index if not exists pricing_jobs_user_idx on public.pricing_jobs (user_id, created_at);
create index if not exists pricing_jobs_batch_idx on public.pricing_jobs (batch_id, created_at);

alter table public.pricing_jobs enable row level security;
create policy "own pricing jobs - select" on public.pricing_jobs for select using (auth.uid() = user_id);
create policy "own pricing jobs - insert" on public.pricing_jobs for insert with check (auth.uid() = user_id);
create policy "own pricing jobs - update" on public.pricing_jobs for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own pricing jobs - delete" on public.pricing_jobs for delete using (auth.uid() = user_id);

create table if not exists public.pricing_leases (
  user_id uuid primary key references auth.users(id) on delete cascade,
  holder uuid,
  lease_until timestamptz not null default 'epoch'
);

alter table public.pricing_leases enable row level security;
create policy "own pricing lease - select" on public.pricing_leases for select using (auth.uid() = user_id);

notify pgrst, 'reload schema';
