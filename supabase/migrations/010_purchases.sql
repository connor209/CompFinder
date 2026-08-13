-- Comp Finder — purchase ledger (the Buy module)
--
-- A simple record of money spent: either a specific card bought (name, qty,
-- price paid, source) or a general spend line (description + amount, e.g. a
-- sealed box, sleeves, postage, fees). Feeds a running spend total so the
-- business view reflects real outgoings, not just per-listing cost. Run once
-- in the Supabase SQL editor.

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'card',              -- 'card' | 'expense'
  description text not null,
  quantity integer,                                -- card kind only
  amount_pence integer not null default 0,         -- total paid
  category text,                                    -- expense kind only
  source text,                                      -- where it was bought
  purchased_at date not null default ((now() at time zone 'utc')::date),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists purchases_user_date_idx
  on public.purchases (user_id, purchased_at desc);

alter table public.purchases enable row level security;

-- The user owns their ledger and manages it directly from the browser.
create policy "Users manage their own purchases - select"
  on public.purchases for select using (auth.uid() = user_id);
create policy "Users manage their own purchases - insert"
  on public.purchases for insert with check (auth.uid() = user_id);
create policy "Users manage their own purchases - update"
  on public.purchases for update using (auth.uid() = user_id);
create policy "Users manage their own purchases - delete"
  on public.purchases for delete using (auth.uid() = user_id);
