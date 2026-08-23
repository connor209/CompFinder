-- Card art for the catalogue.
--
-- The catalogue is Cardmarket-derived and has never carried images. The public
-- page shows a price for a card the visitor has typed the name of, with
-- nothing to confirm it is the card they meant — and the moment that matters
-- most is the disambiguation picker, where "Charizard ex 223/165" and
-- "Charizard ex 223/197" are two lines of near-identical text.
--
-- WHY STORED RATHER THAN FETCHED. The art comes from tcgdex, and a public page
-- cannot depend on a third party inside a visitor's request: the alternative
-- source, pokemontcg.io, spent an hour returning 500 to every call while this
-- was being written. Stored URLs mean an outage upstream costs us nothing, and
-- the page has one fewer thing that can be slow.
--
-- URLS, NOT BYTES. We store a link to their CDN and never a copy of the image.
-- That keeps the rights question exactly where it already was — the artwork is
-- The Pokémon Company's, and tcgdex is not affiliated with them any more than
-- we are — rather than making us a distributor of it. It also means their
-- takedown, if it ever came, would be theirs to serve rather than ours to
-- discover.
--
-- Populated by scripts/backfill-images.mjs, which matches on set + collector
-- number and refuses any pairing whose card names disagree. Measured over 400
-- English cards on 2026-08-23: 84% end up with art, 90% of the chase set, and
-- no mismatches. The gaps are World Championship Decks and a few EX-era and
-- promo sets tcgdex doesn't index, plus the Shining Fates Shiny Vault, which
-- it lists without art.

alter table public.card_catalog
  -- ~35KB webp, the thumbnail the page actually renders.
  add column if not exists image_small      text,
  -- ~380KB png, for anywhere the card is shown full size.
  add column if not exists image_large      text,
  -- Which index the match came from, so a bad source can be re-run on its own
  -- without touching rows another one filled.
  add column if not exists image_source     text,
  -- When we last ASKED, which is not the same as when we last found something.
  -- Without it a resumable backfill can't tell "no art exists" from "not
  -- looked at yet", and re-checks the whole catalogue every run.
  add column if not exists image_checked_at timestamptz;

-- Partial, because the only question ever asked of these columns in bulk is
-- "which rows still need looking at".
create index if not exists card_catalog_image_missing_idx
  on public.card_catalog (game, expansion)
  where image_small is null;

-- No new RLS policy: 005 already grants select on this table to everyone, and
-- these columns are public reference data of exactly the same kind. Writes
-- stay server-only, as they were.

-- The fuzzy fallback has to carry the image too, or a typo'd search shows a
-- picker with art on some rows and blanks on others depending on which code
-- path answered — which reads as missing data rather than as a different
-- query. A return type can't be widened by `create or replace`, so this is a
-- drop and recreate; the body is unchanged from migration 020 apart from the
-- one extra column, and the grant has to be restored because dropping the
-- function takes it with it.
drop function if exists public.search_catalog_fuzzy(text, int);

create function public.search_catalog_fuzzy(q text, lim int default 60)
returns table (
  cardmarket_id bigint,
  name text,
  collector_number text,
  rarity text,
  expansion text,
  expansion_code text,
  game text,
  image_small text,
  similarity real
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  with needle as (
    select btrim(
      regexp_replace(regexp_replace(lower(q), '''', '', 'g'), '[^a-z0-9]+', ' ', 'g')
    ) as n
  )
  select c.cardmarket_id, c.name, c.collector_number, c.rarity,
         c.expansion, c.expansion_code, c.game, c.image_small,
         similarity(c.name_plain, needle.n) as similarity
  from public.card_catalog c, needle
  where needle.n <> ''
    and length(needle.n) >= 3          -- two letters match far too much
    and c.name_plain % needle.n
  order by similarity(c.name_plain, needle.n) desc, c.cardmarket_id
  limit least(greatest(coalesce(lim, 60), 1), 200);
$$;

grant execute on function public.search_catalog_fuzzy(text, int) to anon, authenticated;
