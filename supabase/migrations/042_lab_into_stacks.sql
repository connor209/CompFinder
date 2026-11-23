-- Comp Finder — fold the lab into the stacks (docs/LAB_FOLD.md)
--
-- A lab copy becomes an ordinary stack card. One record per physical card:
-- once moved, lab_copies is no longer read or written.
--
--   lab_listing_id   THIS CARD IS A LAB CARD, and which lab listing it is a
--                    copy on. The one test every screen uses.
--   scan_urls        the copy's own scans, in order (CardUploader-hosted)
--   reserved_*       sold to this order unit, not yet pulled
--
-- copy_seq (027) is the selling order; pulled_at, sku, stack_id and position
-- mean what they always have. ebay_item_id stays EMPTY on a lab card, so the
-- older multi-copy script (copyqueue-run.mjs), which groups by it, never
-- touches a lab listing.
--
-- lab_copies.stack_card_id records which stack card a copy moved to, so the
-- move can be run again and skips what has gone.
--
-- Run once in the Supabase SQL editor. Purely additive.

alter table public.stack_cards add column if not exists lab_listing_id uuid references public.lab_listings(id) on delete set null;
alter table public.stack_cards add column if not exists scan_urls text[];
alter table public.stack_cards add column if not exists reserved_line text;
alter table public.stack_cards add column if not exists reserved_order text;
alter table public.stack_cards add column if not exists reserved_at timestamptz;
alter table public.stack_cards add column if not exists reserved_mismatch boolean not null default false;

create index if not exists stack_cards_lab_listing_idx on public.stack_cards (lab_listing_id) where lab_listing_id is not null;
create unique index if not exists stack_cards_reserved_line_uq on public.stack_cards (user_id, reserved_line) where reserved_line is not null;

alter table public.lab_copies add column if not exists stack_card_id uuid references public.stack_cards(id) on delete set null;
