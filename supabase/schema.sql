-- Comp Finder — Supabase schema
--
-- Deliberately minimal, matching the "just account + settings" decision:
-- one row per user, holding their SoldComps API key and preferences —
-- the same data chrome.storage held in the extension version. Batch
-- history isn't stored here on purpose; add a separate table for it later
-- if that's ever actually wanted, no reason to build it before then.
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
