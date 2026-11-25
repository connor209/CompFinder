-- Comp Finder — Add copies batches (apps/app/lib/lab-batches.js)
--
-- Add copies kept ONE working list per browser, in localStorage. Four tabs
-- loading four exports each saved their whole list into that one slot, the
-- last write won, and a refresh the next morning showed the same list in all
-- four — the other three batches' prices and costs gone (2026-11-25).
--
-- A batch is the list on the server: each upload makes one, it has its own
-- URL (/panel/lab/add?batch=<id>), so two tabs or two devices work on two
-- batches without touching each other. `rev` is the guard for the same batch
-- open twice: a save names the rev it started from, and a save from a stale
-- tab changes nothing and says so instead of overwriting the newer list.
--
-- `rows` is the working list exactly as lib/lab-draft.js serialises it. The
-- counts are copied out of it on every save so the batch list is one cheap
-- SELECT that never reads the rows.
--
-- Kept until deleted: a batch is a few hundred rows of text, and the day you
-- want one is the day you come back to finish it.
--
-- Named in apps/app/lib/lab-batches.js only.
--
-- Run once in the Supabase SQL editor. Until it is, Add copies keeps the old
-- one-list-per-browser behaviour and says batches need this migration.

create table if not exists public.lab_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  rev integer not null default 0,
  rows jsonb not null default '[]'::jsonb,
  files text[] not null default '{}',
  card_count integer not null default 0,
  copy_count integer not null default 0,
  listed_count integer not null default 0
);

create index if not exists lab_batches_user_idx on public.lab_batches (user_id, updated_at desc);

alter table public.lab_batches enable row level security;
create policy "own lab batches - select" on public.lab_batches for select using (auth.uid() = user_id);
create policy "own lab batches - insert" on public.lab_batches for insert with check (auth.uid() = user_id);
create policy "own lab batches - update" on public.lab_batches for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own lab batches - delete" on public.lab_batches for delete using (auth.uid() = user_id);

notify pgrst, 'reload schema';
