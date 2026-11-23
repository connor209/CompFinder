-- Comp Finder — the quantity-listing LAB (a side build; see docs/LAB_COPIES.md)
--
-- One eBay listing per card + condition at quantity N, showing the scans of the
-- copy that goes next, with that copy reserved the moment it sells. These are
-- the lab's OWN tables: nothing here touches stack_cards, stock_checkouts or
-- listing_copy_state, and dropping all three tables undoes the lab completely
-- (the eBay listings it made are ended from the lab screen first).
--
-- Named in apps/app/lib/lab-store.js only.
--
-- Run once in the Supabase SQL editor. Purely additive.

create table if not exists public.lab_listings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ebay_item_id text,                 -- null until eBay accepted it
  title text not null,
  condition text not null,           -- NM / LP / MP / HP, ours
  price_pence integer not null,
  pictured_copy_id uuid,             -- which copy's scans the listing shows now
  created_at timestamptz not null default now(),
  checked_at timestamptz,            -- last "check for sales"
  released_lines text[] not null default '{}', -- cancelled order units, never reserved again
  ended_at timestamptz
);

create table if not exists public.lab_copies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid not null references public.lab_listings(id) on delete cascade,
  sku text not null,                 -- LAB7: the copy's name, from CardUploader
  pile_seq integer not null,         -- where it sits in the LAB pile (file order)
  copy_seq integer,                  -- the order it sells in; null = pile order
  scan_urls text[] not null default '{}',  -- CardUploader-hosted, in the file's order
  added_at timestamptz not null default now(),
  reserved_line text,                -- "<lineItemId>#<unit>" once it has sold
  reserved_order text,
  reserved_at timestamptz,
  reserved_mismatch boolean not null default false, -- buyer saw a different copy
  pulled_at timestamptz
);

create unique index if not exists lab_copies_user_sku on public.lab_copies (user_id, lower(sku));
create unique index if not exists lab_copies_line on public.lab_copies (user_id, reserved_line) where reserved_line is not null;
create index if not exists lab_copies_listing on public.lab_copies (listing_id);

-- Every change the lab makes on eBay, and every sale it reads. Append-only.
create table if not exists public.lab_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid references public.lab_listings(id) on delete set null,
  at timestamptz not null default now(),
  kind text not null,                -- listed / pictures / reserved / mismatch / oversold / quantity / pulled / released / ended / error
  detail jsonb not null default '{}'
);
create index if not exists lab_events_user_at on public.lab_events (user_id, at desc);

alter table public.lab_listings enable row level security;
alter table public.lab_copies enable row level security;
alter table public.lab_events enable row level security;

create policy "own lab listings" on public.lab_listings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own lab copies" on public.lab_copies for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own lab events - select" on public.lab_events for select using (auth.uid() = user_id);
create policy "own lab events - insert" on public.lab_events for insert with check (auth.uid() = user_id);
