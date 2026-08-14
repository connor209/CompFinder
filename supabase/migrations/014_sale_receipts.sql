-- Comp Finder — receipts on sales (attach the PayPal/marketplace payout, etc.)
--
-- Lets a receipt/screenshot be attached to a cached eBay sale, the same way
-- purchases already carry photos. Images reuse the private purchase-photos
-- bucket (per-user folders, RLS-scoped). Sales are written by the server sync,
-- which upserts only the columns it knows about, so receipt_paths survives a
-- re-sync. Run once in the Supabase SQL editor.

alter table public.ebay_sales add column if not exists receipt_paths text[] not null default '{}';

-- Allow the user to update their OWN sale rows (to attach receipts). Writes to
-- the price/title fields still come from the server sync; this just lets the
-- browser set receipt_paths on rows the user owns.
create policy "Users can update their own sales"
  on public.ebay_sales for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
