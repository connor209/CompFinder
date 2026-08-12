import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client, for use inside "use client" components.
 * Reads the public URL + anon key from env vars set at build time — safe
 * to expose to the browser, since row-level security (see supabase/schema.sql)
 * is what actually keeps one user's data away from another's, not secrecy
 * of these values.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
