-- Comp Finder — when a card went into its Show Binder
--
-- The binder view's "Newest in binder first" sort had no date to go on.
-- `stack_cards.added_at` is when the card was first stacked, and filing a card
-- into a binder only MOVES the row (stack_id, position), so it says nothing
-- about the binder. The sort fell back to the highest slot first, which is
-- right until ↻ Re-pocket A–Z renumbers every slot by name.
--
-- This column is stamped when a card is filed into a binder (📒 Into binder,
-- or checked in from a show into a binder it was not already in), kept
-- through a re-pocket, and cleared by ↩ Out. A card checked in to the binder it
-- came out of keeps its date: it never left.
--
-- No backfill: nobody knows when the cards already in a binder were filed.
-- They stay null and sort after every dated card — every one of them went in
-- before this migration, so before any dated card — newest slot first.
--
-- Run once in the Supabase SQL editor. Until it is, the app sorts by slot as
-- before; the date is written in a separate update, so a missing column never
-- stops a card being filed.

alter table public.stack_cards
  add column if not exists binder_added_at timestamptz;
