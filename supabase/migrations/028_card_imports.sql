-- Comp Finder — a CardUploader export, kept.
--
-- The Batch screen has read these files since the beginning and thrown almost
-- all of them away: it took the title, the SKU, the number and the condition,
-- priced the card, and dropped the other twenty-odd columns on the floor. So a
-- row on that screen could only ever say its title, and the two questions you
-- actually ask holding a card — "is this the one I scanned?" and "is the title
-- right?" — had no answer anywhere in the app.
--
-- Both answers were already in the file. `PicURL` carries the photographs of
-- THIS copy, four per row, already public on CardUploader's CDN. The set,
-- rarity, year, illustrator, type, stage and language are each one column.
--
-- URLS, NOT BYTES — the same rule migration 022 set for catalogue art, and a
-- stronger case for it here: these are pictures of a card we are holding, so
-- the only thing worth storing is where they are.
--
-- Two tables because the item list is the point and the file is the container.
-- Both are named in exactly ONE file, apps/app/lib/import-store.js, the rule
-- batch-store.js and wants-store.js already follow.
--
-- NO EXPIRY, deliberately, where a saved batch run expires at 30 days. A run
-- is a working document you list off over a few days and its rows are fat with
-- comps; an import is the record of what came in, it is a few kilobytes of
-- text and links, and the day you want it is the day a card turns up in a box
-- with a SKU on it and no memory attached.
--
-- Run once in the Supabase SQL editor. Until it is, the screen says so and an
-- import still opens from this browser — it just doesn't survive a reload.

create table if not exists public.card_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,              -- "50 cards from pokemon-english_ebay….csv"
  file_name text,
  item_count integer not null default 0,
  -- The file as uploaded, kept verbatim so the eBay upload CSV can still be
  -- written from it days later with only the prices changed. Same decision as
  -- price_batches.csv_raw, and the same reason: what eBay accepts is the file
  -- it gave you back, not one we rebuilt from our own columns.
  csv_text text,
  created_at timestamptz not null default now()
);

create index if not exists card_imports_user_created_idx
  on public.card_imports (user_id, created_at desc);

create table if not exists public.card_import_items (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.card_imports(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  position integer not null,        -- the row's index in the file

  -- The title is the one field that is BOTH displayed and load-bearing: it is
  -- what the pricing engine searches on, and since it is also where "Reverse
  -- Holo" is written (the CSV's own *C:Finish column is blank on 49 of 50
  -- reverse holos), it decides which printing is being priced. So an edit to
  -- it is a real change to what this card will be searched as — which is why
  -- the original is kept beside it rather than overwritten, exactly as
  -- overridePence sits beside finalPence.
  title text not null,
  title_original text not null,
  edited_at timestamptz,

  sku text,
  card_name text,
  card_number text,
  set_name text,                    -- "set" is reserved in SQL
  rarity text,
  year text,                        -- as written; some promos aren't a number
  illustrator text,
  card_type text,                   -- eBay files the Pokémon type under the
                                    -- Magic colour aspect. Not a mistake.
  stage text,
  language text,
  game text,
  condition text,                   -- NM / LP / MP / HP / DMG
  condition_label text,             -- eBay's own wording, as the file wrote it
  graded boolean not null default false,
  quantity integer,

  -- What the file asked for, which on a CardUploader export is the £2.49
  -- placeholder on every row — byte-identical to the engine's own floor, and
  -- the exact figure zero-price.js exists to stop leaving the building. Kept
  -- because it is what the file said, never read as a price we decided.
  start_price_pence integer,

  -- The photographs of this copy, in the file's order. Which one is the front
  -- is the scanner's business; nothing here relabels them.
  images text[] not null default '{}',

  created_at timestamptz not null default now(),
  unique (import_id, position)
);

comment on column public.card_import_items.title_original is
  'The title exactly as CardUploader wrote it. The engine searches on `title`, so an edit there changes the price; keeping the original is what makes the edit visible, reversible, and impossible to confuse with what the file said.';

create index if not exists card_import_items_import_idx
  on public.card_import_items (import_id, position);
create index if not exists card_import_items_user_sku_idx
  on public.card_import_items (user_id, sku);

alter table public.card_imports enable row level security;
create policy "own imports - select" on public.card_imports for select using (auth.uid() = user_id);
create policy "own imports - insert" on public.card_imports for insert with check (auth.uid() = user_id);
create policy "own imports - update" on public.card_imports for update using (auth.uid() = user_id);
create policy "own imports - delete" on public.card_imports for delete using (auth.uid() = user_id);

alter table public.card_import_items enable row level security;
create policy "own import items - select" on public.card_import_items for select using (auth.uid() = user_id);
create policy "own import items - insert" on public.card_import_items for insert with check (auth.uid() = user_id);
create policy "own import items - update" on public.card_import_items for update using (auth.uid() = user_id);
create policy "own import items - delete" on public.card_import_items for delete using (auth.uid() = user_id);
