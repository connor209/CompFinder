import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client — BYPASSES row-level security. Use ONLY in
 * trusted server code (route handlers), never anything that reaches the
 * browser. It's the only thing that can read/write the ebay_accounts table
 * where OAuth refresh tokens live, since that table has RLS on and no policies.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY (Supabase Dashboard → Project Settings →
 * API → service_role secret). Keep it server-side only — it grants full DB
 * access.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY (and NEXT_PUBLIC_SUPABASE_URL) must be set for eBay account features.");
  }
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}
