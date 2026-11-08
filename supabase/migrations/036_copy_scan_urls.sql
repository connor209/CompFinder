-- Comp Finder — every photograph of one copy, not just the front
--
-- Migration 027 gave each copy ONE scan (`scan_url`). A listing revision
-- REPLACES the whole picture set ("you need to completely replace the
-- original set of URLs with the revised set" — eBay's PictureDetailsType), so
-- a multi-copy listing revised to show the next copy's front alone loses the
-- back of the card.
--
-- `scan_urls` is the copy's own photographs in order, front first — the
-- CardUploader PicURL list for THAT copy. Still one copy's photos, never
-- several copies': apps/app/lib/copyqueue.js `scanUrlsOf()` reads this, and
-- falls back to `scan_url` when it is empty.
--
-- Run once in the Supabase SQL editor. Until it is, the app uses `scan_url`
-- as before.

alter table public.stack_cards
  add column if not exists scan_urls text[];

comment on column public.stack_cards.scan_urls is
  'Every photograph of this copy, front first (its CardUploader PicURL list). A multi-copy listing shows the head copy''s set. Never overwrite a URL in place: eBay copies pictures by URL.';
