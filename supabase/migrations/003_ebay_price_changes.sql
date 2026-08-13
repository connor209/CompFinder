-- Comp Finder — eBay price-change audit log (write-back Phase 2a)
--
-- Every price CompFinder pushes to eBay is recorded here (old → new), so
-- changes are auditable and reversible. Run once in the Supabase SQL editor.
--
-- Optional: the revise-price route logs best-effort, so repricing still works
-- if this table doesn't exist yet — but you lose the audit trail / undo until
-- it's created.

create table if not exists public.ebay_price_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ebay_item_id text not null,
  title text,
  old_price numeric,
  new_price numeric,
  currency text,
  source text,                 -- e.g. 'market-update'
  created_at timestamptz not null default now()
);

create index if not exists ebay_price_changes_user_idx
  on public.ebay_price_changes (user_id, created_at desc);

alter table public.ebay_price_changes enable row level security;

-- Users may read their own change history (powers an audit/undo view); writes
-- come only from the server (service role), which bypasses RLS.
create policy "Users can view their own price changes"
  on public.ebay_price_changes for select
  using (auth.uid() = user_id);
