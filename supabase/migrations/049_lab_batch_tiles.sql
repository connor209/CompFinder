-- Comp Finder — what a batch tile shows (apps/app/lib/lab-batches.js)
--
-- The batch list is a grid of tiles, CardUploader's "Previous batches" shape:
-- a scan of the first card, what the batch is (English Pokémon), what it is
-- worth, how far it has got. The list reads these columns and NEVER the rows,
-- so each is copied out of the rows on every save, the same way 047's counts
-- already are.
--
-- Purely additive. Until it is run the tiles show the counts 047 already
-- keeps and no picture or value; saves leave these columns out and work.

alter table public.lab_batches add column if not exists cover_url text;
alter table public.lab_batches add column if not exists value_pence integer not null default 0;
alter table public.lab_batches add column if not exists listed_value_pence integer not null default 0;
alter table public.lab_batches add column if not exists priced_count integer not null default 0;
alter table public.lab_batches add column if not exists language text;
alter table public.lab_batches add column if not exists game text;

notify pgrst, 'reload schema';
