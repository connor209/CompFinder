-- Comp Finder — one identity per card (lib/card-identity.js)
--
-- Every screen used to work out which card a row was from its own spelling of
-- the name, number and set — the stack key, the lab key, the duplicate key,
-- CardUploader's SKU, Cardmarket's own matcher — and the bugs lived where two
-- of those disagreed. A stack card now carries the Cardmarket product it is:
-- card_catalog's primary key, matched once (lib/cm-match.js) and stored, so
-- the price guide, the catalogue and every other reading start from the same
-- number instead of re-matching a title.
--
-- Null means NOT LINKED YET (no match, or matched before this ran) — never a
-- guess. The printing (reverse holo), language and grade are not part of the
-- product and stay on the card; card-identity.js puts them together.
--
-- Run once in the Supabase SQL editor. Purely additive; until it is run the
-- app matches by name as before and says cards can't be linked yet.

alter table public.stack_cards add column if not exists cardmarket_id bigint;
create index if not exists stack_cards_cardmarket_idx on public.stack_cards (user_id, cardmarket_id) where cardmarket_id is not null;

notify pgrst, 'reload schema';
