-- Comp Finder — Cardmarket stock: Magic singles in a chaos sort
--
-- Magic is sold on Cardmarket only, through TCG PowerTools. The cards are
-- scanned in CardUploader 50 at a time and stored in scan order behind
-- dividers MTG-A, MTG-B … MTG-AA. Each divider is a stack (card_stacks), each
-- card a stack card with a SKU like MTG-C37 — no new table, so the Stacks
-- screen, the stack checker and liveRanks() all work on them unchanged.
--
-- What a stack card could not say is WHICH article it is on Cardmarket. A sale
-- there arrives as a product id plus grade, finish, language, signed and
-- altered — never our SKU — so those are kept here, in one jsonb column,
-- written by apps/app/lib/cardmarket.js (cmFields) and named only in
-- apps/app/lib/cardmarket-store.js. When a card is picked for an order the
-- order id is added, which is what stops the same order file picking a second
-- copy if it is uploaded twice.
--
-- Run once in the Supabase SQL editor. Until it is, the Cardmarket screen says
-- so and loads nothing; every other screen is unaffected.

alter table public.stack_cards
  add column if not exists cm jsonb;

create index if not exists stack_cards_cm_product_idx
  on public.stack_cards ((cm->>'product_id'))
  where cm is not null;
