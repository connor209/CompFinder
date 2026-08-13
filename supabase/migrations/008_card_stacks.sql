-- Comp Finder — rolling stack inventory
--
-- Physical cards are kept unsleeved in entry order, in batches ("stacks").
-- A card's POSITION is its live rank in the stack, not a number written on it:
-- when a card is pulled (sold/removed), everything behind it shifts down one,
-- so the app always tells you where an unsold card currently sits.
--
-- Run once in the Supabase SQL editor.

create table if not exists public.card_stacks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
alter table public.card_stacks enable row level security;
create policy "own stacks - select" on public.card_stacks for select using (auth.uid() = user_id);
create policy "own stacks - insert" on public.card_stacks for insert with check (auth.uid() = user_id);
create policy "own stacks - update" on public.card_stacks for update using (auth.uid() = user_id);
create policy "own stacks - delete" on public.card_stacks for delete using (auth.uid() = user_id);

create table if not exists public.stack_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stack_id uuid not null references public.card_stacks(id) on delete cascade,
  position integer,          -- live rank among unpulled cards; null once pulled
  sku text,
  title text,
  ebay_item_id text,
  added_at timestamptz not null default now(),
  pulled_at timestamptz
);
create index if not exists stack_cards_stack_pos_idx on public.stack_cards (stack_id, position);
create index if not exists stack_cards_user_sku_idx on public.stack_cards (user_id, sku);

alter table public.stack_cards enable row level security;
create policy "own stack_cards - select" on public.stack_cards for select using (auth.uid() = user_id);
create policy "own stack_cards - insert" on public.stack_cards for insert with check (auth.uid() = user_id);
create policy "own stack_cards - update" on public.stack_cards for update using (auth.uid() = user_id);
create policy "own stack_cards - delete" on public.stack_cards for delete using (auth.uid() = user_id);
