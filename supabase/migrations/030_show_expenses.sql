-- Comp Finder — what a show cost to do
--
-- Show history (apps/app/app/panel/ShowHistory.js) reads profit off the cards:
-- what each one sold for less what it cost. That is gross profit, and a show
-- is not free — a table fee, fuel, a train, a hotel. Without those a show that
-- lost money reads as a good day, which is the one mistake this screen exists
-- to stop you making twice.
--
-- A cost belongs to a SHOW, and a show is not a row anywhere: it is the
-- `event` name the desk stamps on each checkout. So `show_key` is the same key
-- Show history groups by (`showOf()` in apps/app/lib/showhistory.js) — the
-- event name trimmed and case-folded behind an `e:`, or `d:YYYY-MM-DD` for
-- checkouts that were never given a name. `show_label` keeps the name as it
-- was typed, so a cost logged before any card was checked out still has a
-- heading to sit under.
--
-- Named in apps/app/lib/show-expenses-store.js only.
--
-- Run once in the Supabase SQL editor. Until it is, Show history still works
-- and says costs need this migration.

create table if not exists public.show_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  show_key text not null,
  show_label text,
  category text not null default 'other',   -- 'table' | 'travel' | 'stay' | 'food' | 'other'
  amount_pence integer not null check (amount_pence > 0),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists show_expenses_user_show_idx
  on public.show_expenses (user_id, show_key);

alter table public.show_expenses enable row level security;
create policy "own show expenses - select" on public.show_expenses for select using (auth.uid() = user_id);
create policy "own show expenses - insert" on public.show_expenses for insert with check (auth.uid() = user_id);
create policy "own show expenses - update" on public.show_expenses for update using (auth.uid() = user_id);
create policy "own show expenses - delete" on public.show_expenses for delete using (auth.uid() = user_id);
