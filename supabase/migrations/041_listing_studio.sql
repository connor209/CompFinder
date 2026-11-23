-- Comp Finder — listing settings and templates for the lab (docs/LISTING_STUDIO.md)
--
-- listing_settings: one row per account — defaults, Best Offer, the title
-- and description templates, the shop images and subtypes, as one JSON
-- document. Named in apps/app/lib/lab-store.js only.
--
-- lab_listings grows what a listing was made with, so the inventory view can
-- filter on it and a later "apply template" can re-render it:
--   card          the card's details from the CardUploader export
--   subtype       your own label (Stamped, Promo …)
--   extra_images  the shop images it went up with — a snapshot, so changing
--                 the settings never rewrites a live listing's pictures
--   db_image_url  CardUploader's database image of the card. For the
--                 inventory view only; never sent to eBay.
--   market_pence / market_at  the sold-comps figure it was priced from
--
-- Run once in the Supabase SQL editor. Purely additive; the lab keeps working
-- before it is run, with the default title and description.

create table if not exists public.listing_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.listing_settings enable row level security;
create policy "own listing settings" on public.listing_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.lab_listings add column if not exists card jsonb;
alter table public.lab_listings add column if not exists subtype text;
alter table public.lab_listings add column if not exists extra_images jsonb;
alter table public.lab_listings add column if not exists db_image_url text;
alter table public.lab_listings add column if not exists market_pence integer;
alter table public.lab_listings add column if not exists market_at timestamptz;
