-- Comp Finder — purchase photos (visual record of a haul)
--
-- Adds optional photos to a purchase so you can snap pictures of the stack of
-- cards you bought instead of writing out "one of this, two of that". The
-- images live in a PRIVATE Supabase Storage bucket, one folder per user; the
-- purchases row just stores the object paths. Run once in the Supabase SQL
-- editor.

-- 1. Bucket-relative image paths, e.g. {"<user-id>/<uuid>.jpg", ...}.
alter table public.purchases add column if not exists photo_paths text[] not null default '{}';

-- 2. Private bucket for the images.
insert into storage.buckets (id, name, public)
values ('purchase-photos', 'purchase-photos', false)
on conflict (id) do nothing;

-- 3. RLS on the objects: each user can only touch files inside their own
--    top-level folder (folder name = their auth uid). Reads are done via signed
--    URLs the app generates, which this same SELECT policy authorises.
create policy "purchase photos - read own"
  on storage.objects for select
  using (bucket_id = 'purchase-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "purchase photos - insert own"
  on storage.objects for insert
  with check (bucket_id = 'purchase-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "purchase photos - delete own"
  on storage.objects for delete
  using (bucket_id = 'purchase-photos' and (storage.foldername(name))[1] = auth.uid()::text);
