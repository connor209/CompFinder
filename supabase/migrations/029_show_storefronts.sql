-- Comp Finder — the QR at the table: a read-only link to the show stock
--
-- The binder on the Show Desk (apps/app/lib/binder.js) is the show stock laid
-- out for a customer, but it only works while the tablet is in their hands.
-- A storefront is the same binder behind a link, printed as a QR on the table,
-- so somebody browsing the next table along can flip through the box on their
-- own phone. See docs/SHOW_STOREFRONT.md.
--
-- One row per link. The TOKEN is the whole of the access control: the app's
-- first anonymous surface is a server route that looks the token up with the
-- service-role key and serves a projection of that owner's stock. Nothing
-- here is readable by `anon` — there is no policy for it, and that is the
-- point. An anonymous visitor has no uid, and the answer to that is a narrow
-- server route, never a loosened policy on stock_checkouts.
--
-- A link can be switched off (`revoked_at`) and can run out on its own
-- (`expires_at`), because a QR printed on a sign outlives the show it was
-- printed for. A leaked token is worth nothing once either has happened.
--
-- `views` is the answer to the question docs/SHOW_STOREFRONT.md says decides
-- whether this was worth building: does anybody scan? A count and a
-- timestamp, nothing about who — the public side's privacy stance is strict
-- on purpose, and a number is all the question needs.
--
-- Run once in the Supabase SQL editor. Until it is, the Show Desk says the
-- link is waiting on this migration and everything else carries on working.

create table if not exists public.show_storefronts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique check (char_length(token) >= 20),
  title text,                       -- the heading a visitor sees
  event text,                       -- only checkouts for this show; null = everything checked out
  include_online boolean not null default true,  -- also show what is listed on eBay, under its own heading
  created_at timestamptz not null default now(),
  expires_at timestamptz,           -- null = until switched off
  revoked_at timestamptz,
  views integer not null default 0,
  last_viewed_at timestamptz
);

create index if not exists show_storefronts_user_created_idx
  on public.show_storefronts (user_id, created_at desc);

alter table public.show_storefronts enable row level security;
create policy "own storefronts - select" on public.show_storefronts for select using (auth.uid() = user_id);
create policy "own storefronts - insert" on public.show_storefronts for insert with check (auth.uid() = user_id);
create policy "own storefronts - update" on public.show_storefronts for update using (auth.uid() = user_id);
create policy "own storefronts - delete" on public.show_storefronts for delete using (auth.uid() = user_id);

-- One page view, counted atomically. Called by the public route with the
-- service-role key; a read-then-write from there would lose counts whenever two
-- people scan at once, which is exactly the moment worth counting.
--
-- EXECUTE is revoked from everyone but service_role. Postgres grants it to
-- PUBLIC by default, and PostgREST exposes every function in `public` as an
-- RPC — left alone, anybody holding the anon key could inflate the count.
create or replace function public.storefront_hit(p_id uuid)
returns void
language sql
as $$
  update public.show_storefronts
     set views = views + 1, last_viewed_at = now()
   where id = p_id;
$$;

revoke all on function public.storefront_hit(uuid) from public, anon, authenticated;
grant execute on function public.storefront_hit(uuid) to service_role;
