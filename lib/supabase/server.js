import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client — for Server Components, Route Handlers
 * (app/api/**), and middleware. Reads/writes the auth session via
 * cookies, so the browser and server always agree on who's logged in.
 *
 * Call this fresh in each request context (don't cache/reuse across
 * requests) — the cookie store it's built from is request-scoped.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component that can't set cookies (e.g.
            // during static rendering) — middleware.js is what actually
            // refreshes the session in that case, so this is safe to
            // swallow rather than throw.
          }
        }
      }
    }
  );
}
