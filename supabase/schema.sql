-- Comp Finder — Supabase schema
--
-- Deliberately minimal, matching the "just account + settings" decision:
-- one row per user, holding their SoldComps API key and preferences —
-- the same data chrome.storage held in the extension version. A separate
-- price_checks table (further down) keeps a per-user history of everything
-- they've priced.
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New
-- query) after creating the project.

create table public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  soldcomps_api_key text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Row-level security: a user can only ever read or write their own row.
-- This is what makes "each user's API key is isolated" true at the
-- database level, not just something the application code happens to
-- respect — the same guarantee chrome.storage's per-extension-user
-- isolation gave for free, now enforced by Postgres itself.
alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Auto-create an empty profile row the moment someone signs up, so the
-- settings page never has to handle "no row yet" as a special case.
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Keep updated_at honest on every write.
create function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger on_profile_updated
  before update on public.profiles
  for each row execute procedure public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- price_checks — a per-user history of every item priced in the panel.
--
-- One row per priced item (the panel bulk-inserts a batch when it finishes).
-- Deliberately stores the flat, already-computed result the results table
-- shows — title, query, recommended price, confidence, etc. — rather than
-- the raw comps, so the History page is a plain SELECT with no re-computation.
-- Rows are tiny (a few hundred bytes), so even heavy daily use stays well
-- within the free tier.
-- ---------------------------------------------------------------------------
create table public.price_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  title text not null,
  sku text,
  query text,
  ebay_site text,
  data_source text,           -- 'sold' | 'active'
  confidence text,            -- 'High' | 'Medium' | 'Low'
  recommended_pence integer,  -- null when no price could be recommended
  current_pence integer,      -- from the CSV's start price, when present
  comps_used integer,
  comps_excluded integer,
  note text
);

-- History is almost always read "my rows, newest first", so index for that.
create index price_checks_user_created_idx
  on public.price_checks (user_id, created_at desc);

-- Same row-level security guarantee as profiles: a user can only ever see,
-- add to, or clear their own history — never anyone else's.
alter table public.price_checks enable row level security;

create policy "Users can view their own price checks"
  on public.price_checks for select
  using (auth.uid() = user_id);

create policy "Users can insert their own price checks"
  on public.price_checks for insert
  with check (auth.uid() = user_id);

create policy "Users can delete their own price checks"
  on public.price_checks for delete
  using (auth.uid() = user_id);
