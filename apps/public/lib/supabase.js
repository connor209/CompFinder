import { createClient } from "@supabase/supabase-js";

/**
 * The public page has no accounts and no sessions, so there is no cookie-bound
 * client here — just two stateless ones.
 *
 * Read-only anon client for catalogue lookups. card_catalog is public-readable
 * by policy (migration 005), which is what lets the search box suggest cards
 * to a visitor who has never signed in.
 */
export function createPublicClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

/**
 * Service-role client, for the two tables the price route owns. Both have RLS
 * on with no policies (migration 019), so the anon key cannot touch the cache
 * or the rate-limit counters even though the page itself is public — a visitor
 * must not be able to read our whole cache or reset their own limit.
 *
 * Route handlers only. Never import this into a client component.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL must be set for the public price page.");
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
