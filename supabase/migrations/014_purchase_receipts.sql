-- Comp Finder — receipts / invoices on purchases
--
-- A purchase already carries `photo_paths` (a snap of the stock you took in).
-- This adds a SEPARATE `receipt_paths` for the proof-of-purchase — a buyer's
-- receipt, an Amazon invoice for supplies, a PayPal screenshot — kept distinct
-- from the haul photo. Images reuse the private purchase-photos bucket (per-user
-- folders, RLS-scoped). Run once in the Supabase SQL editor.

alter table public.purchases add column if not exists receipt_paths text[] not null default '{}';
