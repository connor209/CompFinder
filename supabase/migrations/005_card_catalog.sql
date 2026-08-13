-- Comp Finder — Pokémon card catalog (CardMarket export)
--
-- A reference table of ~85k cards (name, set, collector number, rarity) across
-- every language/region. Powers catalog-backed typeahead and canonical card
-- resolution (mapping messy eBay titles to a real card + its localised number).
--
-- SETUP (run once):
--   1. Run this SQL in the Supabase SQL editor to create the table + indexes.
--   2. Import the data: Table editor → card_catalog → Insert → Import from CSV,
--      and upload the provided catalog_import.csv (headers already match the
--      columns). ~85k rows, a couple of minutes.

create extension if not exists pg_trgm;

create table if not exists public.card_catalog (
  cardmarket_id bigint primary key,
  name text not null,
  collector_number text,
  rarity text,
  expansion text,
  expansion_code text,
  scryfall_id text,
  tcgplayer_id text,
  name_lower text generated always as (lower(name)) stored
);

-- Prefix search on the lowercased name (typeahead), fuzzy contains (trigram),
-- and a plain index on collector number for number-anchored resolution.
create index if not exists card_catalog_name_lower_idx on public.card_catalog (name_lower text_pattern_ops);
create index if not exists card_catalog_name_trgm_idx on public.card_catalog using gin (name gin_trgm_ops);
create index if not exists card_catalog_number_idx on public.card_catalog (collector_number);

-- Public reference data — readable by any signed-in user, never written from
-- the client (loaded once via CSV import / server only).
alter table public.card_catalog enable row level security;

create policy "Card catalog is readable"
  on public.card_catalog for select
  using (true);
