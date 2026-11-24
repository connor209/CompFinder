-- Comp Finder — what each physical card cost us (lib/card-costs.js)
--
-- A cost per COPY, on the stack card, because a lab listing is several copies
-- bought at different times for different money: listing_costs (006) keeps
-- one figure per eBay listing, which is the wrong grain for those. Set when a
-- batch is loaded on Add copies (per card, or a lot total split by price) and
-- editable in the lab's Inventory. A sale's cost is its reserved copy's.
--
-- Null means NOT KNOWN, never free: profit is only ever worked out over cards
-- that carry a cost.
--
-- Run once in the Supabase SQL editor. Purely additive; until it is run the
-- app lists cards exactly as before and says costs can't be saved yet.

alter table public.stack_cards add column if not exists cost_pence integer check (cost_pence is null or cost_pence >= 0);

notify pgrst, 'reload schema';
