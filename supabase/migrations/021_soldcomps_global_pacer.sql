-- A global pacer for our calls to SoldComps.
--
-- SoldComps documents 60 requests/minute ACROSS THE WHOLE KEY. The public page
-- calls them with one shared server-side key, so that limit is a property of
-- the deployment, not of any one visitor — and until now nothing enforced it.
-- The only limiter was per-IP, which by construction cannot see aggregate load:
-- a hundred different visitors are a hundred different IPs, each well inside
-- their own allowance, and together far outside SoldComps'.
--
-- This is not theoretical. A 282-card audit run at roughly 170 requests/minute
-- failed 155 of 282 with upstream errors. From the outside those look exactly
-- like the tool being broken, so the cost of exceeding their limit is paid in
-- visitors' trust, not in a polite warning.
--
-- Serverless is why this lives in the database rather than in the route. Each
-- Vercel invocation is its own process with its own memory; an in-process
-- token bucket would bound one lambda while ten others ran unbounded. The one
-- thing every invocation shares is Postgres.
--
-- LEAKY BUCKET, NOT A COUNTER. A per-minute counter permits a burst of 60 at
-- 10:00:59 and another 60 at 10:01:00 — 120 requests in two seconds, all
-- "within limit" and all rejected upstream. This hands out timestamped slots
-- spaced a fixed gap apart instead, so the outgoing rate is smooth by
-- construction and a burst becomes a short queue rather than a spike.

create table if not exists public.soldcomps_pacer (
  -- Single row, enforced by the primary key and the check together: there is
  -- one shared key, so there is one bucket.
  id           boolean primary key default true,
  -- The next moment a caller may hit SoldComps. Callers move it forward as
  -- they claim; it never runs behind now() for longer than the gap.
  next_slot_at timestamptz not null default now(),
  constraint soldcomps_pacer_single_row check (id)
);

insert into public.soldcomps_pacer (id) values (true) on conflict (id) do nothing;

-- Written only by the service-role client in the route handler; RLS on with no
-- policies means the anon key cannot read or write it.
alter table public.soldcomps_pacer enable row level security;

/**
 * Claim the next slot, or refuse.
 *
 * Returns the timestamp at which the caller may make its request — usually
 * now(), and under load a moment in the future, which the caller waits for.
 * Returns NULL when the queue is already deeper than p_max_wait_ms, meaning
 * the caller should shed the request rather than join it.
 *
 * Refusing has to leave the bucket untouched, which is why the check is in the
 * WHERE clause rather than in an IF after the UPDATE: a rejected caller that
 * had already moved next_slot_at forward would push the queue deeper on its
 * way out, and enough of them in a row would lock everyone out of a service
 * that was never actually busy. Here a refused claim simply matches no row.
 *
 * Concurrency is handled by the row lock on the single row. Two callers cannot
 * both read the same next_slot_at and both add a gap to it: the second waits,
 * re-reads the committed value, and — under READ COMMITTED — re-checks the
 * WHERE clause against it, so a claim that would overshoot the wait ceiling is
 * refused even when it looked fine a millisecond earlier.
 */
create or replace function public.claim_soldcomps_slot(p_gap_ms integer, p_max_wait_ms integer)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  gap      interval := make_interval(secs => greatest(coalesce(p_gap_ms, 0), 0) / 1000.0);
  max_wait interval := make_interval(secs => greatest(coalesce(p_max_wait_ms, 0), 0) / 1000.0);
  slot     timestamptz;
begin
  update public.soldcomps_pacer
     -- greatest(..., now()) is what stops an idle period banking credit: after
     -- an hour of no traffic the bucket doesn't owe anyone 3,000 instant
     -- calls, it just starts again from now.
     set next_slot_at = greatest(next_slot_at, now()) + gap
   where id = true
     and greatest(next_slot_at, now()) <= now() + max_wait
  returning next_slot_at - gap into slot;

  return slot;   -- null: queue too deep, caller sheds the request
end;
$$;

-- Only the server may pace itself. Reachable by the anon key, this would be a
-- one-line denial of service: call it in a loop and next_slot_at runs hours
-- into the future, refusing every real visitor. The same argument applies to
-- the rate-limit counter, which has been callable by anon since 019 — an
-- attacker could inflate another visitor's bucket — so it is locked down here
-- too rather than left as the older of two identical holes.
revoke execute on function public.claim_soldcomps_slot(integer, integer) from public, anon, authenticated;
grant  execute on function public.claim_soldcomps_slot(integer, integer) to service_role;
revoke execute on function public.bump_rate_limit(text, timestamptz) from public, anon, authenticated;
grant  execute on function public.bump_rate_limit(text, timestamptz) to service_role;
