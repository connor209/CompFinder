-- Comp Finder — one open checkout per stack card
--
-- Nothing stopped a card being checked out twice. Every screen asks whether a
-- card is away against what IT last loaded, so a second tab or a phone opened
-- before a run checks the same cards out again: on 2026-10-16 fourteen cards
-- went out at 17:59 and again at 18:17, each with two open rows, each listed
-- twice on the Show Desk's away list. Returning one of a pair restores the
-- listing while the other still says the card is away.
--
-- checkoutStackCard() (apps/app/lib/checkout.js) now refuses a card with an
-- open checkout. This index is the backstop for the race between two devices
-- that both read "not out" — the app recognises the refusal by the index's
-- NAME, so keep it.
--
-- Step 1 closes any pair that already exists, keeping the EARLIEST row: the
-- later run hid a listing that was already hidden, so its record of the
-- listing is the wrong one to restore from. The later row is deleted rather
-- than resolved — it never described a trip anywhere, and a resolved row
-- would count as a card brought and returned on Show history.
--
-- Rows with no stack card (a deal sale of a SKU in no stack) are never open,
-- and are left out of the index anyway.
--
-- Run once in the Supabase SQL editor. Until it is, the app's own check is
-- the only guard, which closes everything but that race.

delete from public.stock_checkouts d
using public.stock_checkouts k
where d.resolved_at is null
  and k.resolved_at is null
  and d.stack_card_id is not null
  and d.stack_card_id = k.stack_card_id
  and (d.checked_out_at, d.id) > (k.checked_out_at, k.id);

create unique index if not exists stock_checkouts_one_open
  on public.stock_checkouts (stack_card_id)
  where resolved_at is null and stack_card_id is not null;
