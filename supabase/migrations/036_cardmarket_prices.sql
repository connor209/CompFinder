-- Comp Finder — Cardmarket stock prices
--
-- The Magic chaos sort (035) knows every card but no price: pricing is TCG
-- PowerTools' autoprice, and the app only ever saw those figures in passing,
-- when a stock export was put through the listing check. This keeps the last
-- price TCG PowerTools gave each ARTICLE — product, Cardmarket grade, finish,
-- language, signed, altered; the same key a sale is matched on — so the stock
-- list can show a value per card and a total.
--
-- Keyed on the article rather than on the card because that is what a listing
-- is: four identical copies are one listing at one price. Written only from the
-- Cardmarket stock screen ("Save these prices"), and named only in
-- apps/app/lib/cardmarket-store.js.
--
-- Run once in the Supabase SQL editor. Until it is, the stock list shows every
-- card with no price and says why; nothing else is affected.

create table if not exists public.cardmarket_prices (
  user_id uuid not null references auth.users(id) on delete cascade,
  article_key text not null,
  price numeric(10, 2) not null,
  priced_at timestamptz not null default now(),
  primary key (user_id, article_key)
);

alter table public.cardmarket_prices enable row level security;
create policy "own cardmarket prices - select" on public.cardmarket_prices for select using (auth.uid() = user_id);
create policy "own cardmarket prices - insert" on public.cardmarket_prices for insert with check (auth.uid() = user_id);
create policy "own cardmarket prices - update" on public.cardmarket_prices for update using (auth.uid() = user_id);
create policy "own cardmarket prices - delete" on public.cardmarket_prices for delete using (auth.uid() = user_id);
