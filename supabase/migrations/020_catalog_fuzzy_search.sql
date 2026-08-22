-- Comp Finder — fuzzy catalogue search (typo and punctuation tolerance)
--
-- WHY. A 2,635-query audit of the public page's resolver measured typo
-- tolerance at 0% — not poor, zero. "Umbeon ex 161" returns nothing at all,
-- because the resolver filters with `name ilike '%umbeon%'` and a substring
-- match cannot survive a missing letter. On a phone at a card show that is the
-- likeliest way to fail. The same substring match is why "team rockets persian
-- ex" and "ns zoroark ex" find nothing: the apostrophe in the stored name
-- breaks the needle.
--
-- pg_trgm and a trigram index have existed since migration 005, but the index
-- is on the RAW name — apostrophes and all — so nothing could use it for this.
--
-- WHAT THIS ADDS.
--   1. name_plain: the name normalised the same way the app's norm() does —
--      lowercased, apostrophes DELETED (so "Team Rocket's" -> "team rockets",
--      which is how people type it), all other punctuation collapsed to
--      single spaces.
--   2. A trigram index on that column.
--   3. search_catalog_fuzzy(), used ONLY as a fallback when the exact search
--      returns nothing. It cannot affect the 98% of queries that already
--      resolve correctly, because it never runs for them.
--
-- COST. Adding a stored generated column rewrites card_catalog (~85k rows) —
-- expect this to take a minute or two and hold a lock for that time. The
-- public page degrades to its current behaviour while it runs; it does not
-- error.

-- ---- 1. normalised name ------------------------------------------------------
-- Mirrors norm() in apps/public/lib/resolve.js. If you change one, change both:
-- the fallback matches on this column and ranks on that function, so a
-- divergence would rank rows it just fetched as non-matches.
alter table public.card_catalog
  add column if not exists name_plain text
  generated always as (
    btrim(
      regexp_replace(
        regexp_replace(lower(name), '''', '', 'g'),   -- delete apostrophes
        '[^a-z0-9]+', ' ', 'g'                        -- everything else -> space
      )
    )
  ) stored;

create index if not exists card_catalog_name_plain_trgm_idx
  on public.card_catalog using gin (name_plain gin_trgm_ops);

-- ---- 2. the fallback search --------------------------------------------------
-- `%` is pg_trgm's similarity operator and is what makes the GIN index usable;
-- a bare similarity() > x comparison would force a sequential scan over 85k
-- rows. The default threshold (0.3) is deliberately loose — this only ever runs
-- when the exact search already found nothing, so a few weak suggestions are
-- better than an empty page, and the caller scores them low enough that a fuzzy
-- hit can never be answered confidently.
create or replace function public.search_catalog_fuzzy(q text, lim int default 60)
returns table (
  cardmarket_id bigint,
  name text,
  collector_number text,
  rarity text,
  expansion text,
  expansion_code text,
  game text,
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
         c.expansion, c.expansion_code, c.game,
         similarity(c.name_plain, needle.n) as similarity
  from public.card_catalog c, needle
  where needle.n <> ''
    and length(needle.n) >= 3          -- two letters match far too much
    and c.name_plain % needle.n
  order by similarity(c.name_plain, needle.n) desc, c.cardmarket_id
  limit least(greatest(coalesce(lim, 60), 1), 200);
$$;

-- Readable by the same audience as the catalogue itself (migration 005 makes
-- card_catalog selectable by anyone). security invoker means RLS still applies.
grant execute on function public.search_catalog_fuzzy(text, int) to anon, authenticated;
