-- Comp Finder — listing photos (your own photos on eBay listings)
--
-- eBay fetches a listing's images from a public URL at list time, so unlike the
-- private purchase-photos bucket, listing images live in a PUBLIC bucket (the
-- images become public on eBay anyway). One folder per user; uploads/deletes
-- are still restricted to the user's own folder. Run once in the Supabase SQL
-- editor.

insert into storage.buckets (id, name, public)
values ('listing-photos', 'listing-photos', true)
on conflict (id) do nothing;

-- Public read is served by the public bucket (via the public object URL), so no
-- SELECT policy is needed. Writes are scoped to the user's own top-level folder.
create policy "listing photos - insert own"
  on storage.objects for insert
  with check (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "listing photos - delete own"
  on storage.objects for delete
  using (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = auth.uid()::text);
