-- Comp Finder — eBay account connection (Phase 1: read-only inventory)
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New
-- query) after the base schema.sql.
--
-- Two tables:
--   ebay_accounts  — the user's eBay OAuth tokens. SENSITIVE. Locked down so
--                    ONLY the server (service-role key) can read/write them;
--                    the browser can never see a refresh token.
--   ebay_listings  — a cache of the user's active eBay listings. Not secret,
--                    so the browser can read its OWN rows directly (for the
--                    inventory view), but only the server can write them.

-- ---------------------------------------------------------------------------
-- ebay_accounts — OAuth tokens (server-only)
-- ---------------------------------------------------------------------------
create table if not exists public.ebay_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ebay_username text,
  ebay_user_id text,
  access_token text,
  access_expires_at timestamptz,
  refresh_token text,
  refresh_expires_at timestamptz,
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  updated_at timestamptz not null default now()
);

-- RLS on with NO policies = every anon/authenticated request is denied. Only
-- the service-role key (used solely by our server routes) can touch this table,
-- so refresh tokens never reach the browser even though profiles is readable.
alter table public.ebay_accounts enable row level security;

create trigger on_ebay_account_updated
  before update on public.ebay_accounts
  for each row execute procedure public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- ebay_listings — cached active listings (browser may read its own rows)
-- ---------------------------------------------------------------------------
create table if not exists public.ebay_listings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ebay_item_id text not null,
  title text,
  sku text,
  price_value numeric,
  price_currency text,
  quantity integer,
  image_url text,
  url text,
  synced_at timestamptz not null default now(),
  unique (user_id, ebay_item_id)
);

create index if not exists ebay_listings_user_idx
  on public.ebay_listings (user_id, synced_at desc);

alter table public.ebay_listings enable row level security;

-- Listings aren't secret, so a user may READ their own cached rows directly
-- from the browser (powers the inventory view with no extra API hop). Writes
-- come only from the server (service role), which bypasses RLS — there are
-- deliberately no insert/update/delete policies here.
create policy "Users can view their own eBay listings"
  on public.ebay_listings for select
  using (auth.uid() = user_id);
