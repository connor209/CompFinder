-- Comp Finder — 👍 / 👎 on a price (apps/app/lib/price-feedback.js)
--
-- An override already says "the engine was wrong, and this is right". What
-- nothing recorded was the other half: a price somebody LOOKED at and agreed
-- with, which left no trace and so could not be told apart from a price nobody
-- read. And a thumbs down with no reason cannot be acted on, so a down carries
-- one, from a short fixed list.
--
-- Each row carries what the price was built from — the engine's figure, the
-- house figure, any override, the comps used and the comps excluded with why —
-- so a rule change can be replayed against it later: how many 👎 does it fix,
-- how many 👍 does it break. Feedback is evidence for a measured change, never
-- an automatic one.
--
-- Append-only, like stack_checks: select, insert and delete, NO update. Taking
-- a vote back writes a 'clear' row; the latest row for a card is its verdict.
--
-- Named in apps/app/lib/feedback-store.js only.
--
-- Run once in the Supabase SQL editor. Until it is, the buttons still show and
-- say the vote could not be saved yet.

create table if not exists public.price_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  verdict text not null check (verdict in ('up', 'down', 'clear')),
  reason text,                      -- required on 'down' (price-feedback.js REASONS)
  comment text,
  surface text not null,            -- 'batch' | 'quick'
  batch_id uuid references public.price_batches(id) on delete set null,
  batch_position integer,
  title text,
  query text,
  sku text,
  card_number text,
  set_name text,
  final_pence integer,              -- what the price was (engine or house) before any override
  engine_pence integer,             -- the engine's own figure, when the house rules priced it
  override_pence integer,           -- a price typed by hand, if any
  shown_pence integer,              -- what was on screen when the vote was cast
  confidence text,
  data_source text,
  house_decision text,
  comps_used integer not null default 0,
  comps_excluded integer not null default 0,
  evidence jsonb                    -- the rec, cut down as a saved run stores it
);

create index if not exists price_feedback_user_idx
  on public.price_feedback (user_id, created_at desc);
create index if not exists price_feedback_batch_idx
  on public.price_feedback (batch_id, batch_position) where batch_id is not null;

alter table public.price_feedback enable row level security;
create policy "own price feedback - select" on public.price_feedback for select using (auth.uid() = user_id);
create policy "own price feedback - insert" on public.price_feedback for insert with check (auth.uid() = user_id);
create policy "own price feedback - delete" on public.price_feedback for delete using (auth.uid() = user_id);

notify pgrst, 'reload schema';
