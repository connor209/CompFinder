-- Comp Finder — a storefront link that is the SHOP, not one show's table
--
-- 029's links were built for a sign on a table: the show box first, what's
-- listed online behind it, and an expiry because a printed sign outlives the
-- show. A QR handed to customers to keep — a business card, a packing slip,
-- a sticker on a top-loader — wants the opposite of all three: the whole
-- stock, worded as our shop rather than our table, and never running out.
--
-- `kind` says which. 'show' is every link made before this, unchanged.
-- 'shop' is read by apps/app/lib/storefront-store.js as: every card we have,
-- whatever the link's event or include_online say.
--
-- Run once in the Supabase SQL editor, after 029. Until it is, the desk can
-- still make show links; only "Shop QR" asks for this file.

alter table public.show_storefronts
  add column if not exists kind text not null default 'show';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'show_storefronts_kind_check'
  ) then
    alter table public.show_storefronts
      add constraint show_storefronts_kind_check check (kind in ('show', 'shop'));
  end if;
end $$;
