-- Comp Finder — your rules for a card (apps/app/lib/price-rules.js)
--
-- "These sales aren't this card": set once on a card (Add copies → 🔍 see
-- sales), kept, and applied wherever that card is priced through the house
-- route — Add copies, the pricing queue, the Batch screen's house rules.
-- Asked for 2026-11-25 after a plain card was priced off stamped sales.
--
-- card_key is ruleKeyFor(): name, number, set, printing and language, never
-- the condition. kinds are the patterns the app recognises (stamped, graded,
-- lot, language, reverse, firstEdition); words are what you typed; note is
-- yours, for people. One rule per card per account.
--
-- Named in apps/app/lib/price-rules-store.js only. Run once in the Supabase
-- SQL editor; until it is, the rule still applies to the batch on screen and
-- says it couldn't be kept for next time.

create table if not exists public.card_price_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_key text not null,
  label text,
  kinds text[] not null default '{}',
  words text[] not null default '{}',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, card_key)
);

alter table public.card_price_rules enable row level security;
create policy "own card rules - select" on public.card_price_rules for select using (auth.uid() = user_id);
create policy "own card rules - insert" on public.card_price_rules for insert with check (auth.uid() = user_id);
create policy "own card rules - update" on public.card_price_rules for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own card rules - delete" on public.card_price_rules for delete using (auth.uid() = user_id);

notify pgrst, 'reload schema';
