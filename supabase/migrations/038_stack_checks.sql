-- Comp Finder — a record of every stack check
--
-- ✓ Check stack walks a stack in the hand against the app's order and saves
-- the result, but nothing said afterwards that it had been done: not when, not
-- by whom, not whether it got to the end. This is that record — one row per
-- check that was saved, including a check that found nothing to change, which
-- is the most useful kind to know about.
--
-- Append-only on purpose: select, insert and delete policies, and NO update.
-- An audit trail that can be edited in place is a note, not a trail.
--
-- `stack_name` is copied in at the time, so a renamed or deleted stack's
-- history still reads sensibly. `checked_by` is the signed-in account's name
-- or email at the time.
--
-- Named in apps/app/lib/stack-check-store.js only.
--
-- Run once in the Supabase SQL editor. Until it is, checks still save the
-- stack's order exactly as before and the screen says they were not logged.

create table if not exists public.stack_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stack_id uuid references public.card_stacks(id) on delete set null,
  stack_name text not null,
  checked_at timestamptz not null default now(),
  checked_by text,
  cards_total integer not null default 0,   -- cards in the check
  cards_checked integer not null default 0, -- how far through it got
  moved integer not null default 0,
  added integer not null default 0,
  pulled integer not null default 0,        -- not found, and marked gone
  missing_kept integer not null default 0,  -- not found, moved to the back
  complete boolean not null default true    -- got to the end of the stack
);

create index if not exists stack_checks_user_stack_idx
  on public.stack_checks (user_id, stack_id, checked_at desc);

alter table public.stack_checks enable row level security;
create policy "own stack checks - select" on public.stack_checks for select using (auth.uid() = user_id);
create policy "own stack checks - insert" on public.stack_checks for insert with check (auth.uid() = user_id);
create policy "own stack checks - delete" on public.stack_checks for delete using (auth.uid() = user_id);
