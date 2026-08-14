-- Comp Finder — deals (a purchase of multiple cards, tracked as one deal)
--
-- Reworks the Buy module's "card" purchases into "deals": one purchase row is
-- the deal (person, date, total, photos), and its individual cards live in a
-- child table. A deal can be priced two ways: one lump-sum total (card prices
-- blank), or a price per card that rolls up into the total. The parent row's
-- amount_pence always holds the deal total and quantity the card count, so the
-- ledger totals keep working unchanged. Run once in the Supabase SQL editor.

-- 'total' (lump sum) | 'per_card' (prices roll up). Null for expenses/legacy.
alter table public.purchases add column if not exists pricing_mode text;

create table if not exists public.deal_cards (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  amount_pence integer,            -- per-unit cost basis (agreed, or an allocated share of the deal total)
  quantity integer not null default 1,
  allocated boolean not null default false,  -- true when the price was auto-shared from the deal total (a "thrown-in" card)
  position integer,
  created_at timestamptz not null default now()
);

create index if not exists deal_cards_purchase_idx on public.deal_cards (purchase_id);
create index if not exists deal_cards_user_idx on public.deal_cards (user_id);

alter table public.deal_cards enable row level security;

create policy "Users manage their own deal cards - select"
  on public.deal_cards for select using (auth.uid() = user_id);
create policy "Users manage their own deal cards - insert"
  on public.deal_cards for insert with check (auth.uid() = user_id);
create policy "Users manage their own deal cards - update"
  on public.deal_cards for update using (auth.uid() = user_id);
create policy "Users manage their own deal cards - delete"
  on public.deal_cards for delete using (auth.uid() = user_id);
