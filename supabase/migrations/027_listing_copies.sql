-- Comp Finder — one listing, several scanned copies
--
-- A multi-quantity listing is one eBay item id backed by several physical
-- cards. Each copy is already its own `stack_cards` row with its own SKU and
-- its own position — nothing ever stopped several rows sharing an
-- `ebay_item_id`. Two things were missing, and this adds exactly those two.
--
-- WHAT THIS IS NOT. There is no event log and no per-sale ledger here. The
-- pull sheet already matches unshipped orders to stack cards and marks them
-- pulled on Commit, so the card leaving the box IS the record that a copy has
-- gone, made by the person holding it. What the app does with this data is
-- RECONCILE — quantity is however many copies are still sellable, the picture
-- is the head copy's scan — which makes running it twice a no-op and a missed
-- run merely stale. A ledger would have been a second opinion about stock, and
-- the disagreement would have been silent.
--
-- Run once in the Supabase SQL editor. Until it is, apps/app/lib/copyqueue.js
-- degrades: the queue still orders itself by when each copy was added, no
-- picture change is ever proposed, and quantity reconciliation still works.

-- ---------------------------------------------------------------------------
-- 1. The two columns a copy was missing.
-- ---------------------------------------------------------------------------
alter table public.stack_cards
  -- Order within ONE listing. Null everywhere until somebody cares, and the
  -- fallback (added_at, then id) is the order the cards were scanned in, which
  -- is the right default. Deliberately NOT `position`: position is the card's
  -- address in its stack, and two copies of one card routinely live in
  -- different stacks. They answer different questions.
  add column if not exists copy_seq integer,
  -- This copy's own scan, in the public `listing-photos` bucket (migration
  -- 012). One URL per copy, and it must never be overwritten in place: eBay
  -- caches pictures BY URL, so re-uploading different bytes to the same path
  -- and revising changes nothing visible, which looks exactly like the revise
  -- call failing.
  add column if not exists scan_url text;

comment on column public.stack_cards.copy_seq is
  'Order this copy sells in, among the copies sharing its ebay_item_id. The head of that queue is the copy in the listing photograph and the next one to pull. Null sorts last, behind every hand-set order.';

-- The queue is always read per listing, in order.
create index if not exists stack_cards_item_seq_idx
  on public.stack_cards (ebay_item_id, copy_seq)
  where pulled_at is null;

-- ---------------------------------------------------------------------------
-- 2. Which copy the listing is currently SHOWING.
--
-- The one fact that genuinely cannot be derived. eBay REHOSTS every picture we
-- upload, so what comes back on a listing is `i.ebayimg.com/…` and never the
-- storage URL we sent — there is no comparison to make between the listing and
-- the queue. Without this row the reconcile cannot tell "the picture is
-- already right" from "the picture has never been set", so it would re-revise
-- every listing on every run, burning eBay's revision allowance to change
-- nothing.
--
-- One row per listing, and it records nothing else. It is a cache of an
-- observation about eBay, not a record of our stock: delete the whole table and
-- the worst that happens is one redundant revision per listing.
-- ---------------------------------------------------------------------------
create table if not exists public.listing_copy_state (
  ebay_item_id     text primary key,
  user_id          uuid references auth.users(id) on delete cascade,
  -- The stack_cards row whose scan the listing is showing. ON DELETE SET NULL
  -- rather than CASCADE: losing the copy should make the state UNKNOWN, which
  -- proposes a revision, not make the row vanish, which would silently look
  -- like a listing nobody has ever pictured.
  pictured_copy_id uuid references public.stack_cards(id) on delete set null,
  pictured_url     text,
  revised_at       timestamptz not null default now()
);

comment on table public.listing_copy_state is
  'Which copy each multi-quantity listing is currently showing. Written only after eBay accepts a revision — a row claiming a picture that was never set stops the reconcile proposing the one change still needed, and stops it quietly.';

alter table public.listing_copy_state enable row level security;
create policy "own copy state - select" on public.listing_copy_state for select using (auth.uid() = user_id);
create policy "own copy state - insert" on public.listing_copy_state for insert with check (auth.uid() = user_id);
create policy "own copy state - update" on public.listing_copy_state for update using (auth.uid() = user_id);
create policy "own copy state - delete" on public.listing_copy_state for delete using (auth.uid() = user_id);
