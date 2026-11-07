-- Comp Finder — which order a pulled copy was pulled FOR
--
-- One listing, several copies (migration 027): eBay sells copy 1 at 10am and
-- nobody reaches the stack until the evening. From the sale on, copy 1
-- belongs to that buyer, so the listing's picture has to move to copy 2 at
-- the SALE, not at the pull — apps/app/lib/copyqueue.js `allocateUnits()`
-- works that out from the unshipped orders.
--
-- What it could not work out is the evening. Once copy 1 is pulled, the order
-- is still unshipped until it is packed, and nothing said that the card in
-- hand already answers it — so the order reserved copy 2 as well: one copy too
-- few on offer, and on the pull sheet the order came back as a fresh pick of
-- copy 2 and never reached Pack.
--
-- `pulled_for` is the order unit the pull sheet's Commit pulled this copy for,
-- `<lineItemId>#<unit>`. Written only for SKUs held as more than one stack
-- row, in a separate update after the pull, so a database without this column
-- still pulls the card. Until it is run, the app errs LOW (one copy too few
-- offered until the order ships), never high.
--
-- Run once in the Supabase SQL editor.

alter table public.stack_cards
  add column if not exists pulled_for text;

comment on column public.stack_cards.pulled_for is
  'The order unit (<lineItemId>#<unit>) this copy was pulled for on the pull sheet. Ties a pulled copy to its still-unshipped order, so the order does not reserve a second copy.';
