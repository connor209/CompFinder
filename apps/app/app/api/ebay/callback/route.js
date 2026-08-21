import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { exchangeCodeForTokens, fetchEbayUsername, syncUserListings } from "@/lib/ebay";

/**
 * eBay OAuth redirect target. Verifies the CSRF state, swaps the auth code for
 * user tokens, stores them (service-role only), records the username, and kicks
 * off an initial inventory sync. Redirects back to Settings with a status.
 */
function back(request, status) {
  const res = NextResponse.redirect(new URL(`/settings?ebay=${status}`, request.url));
  res.cookies.delete("ebay_oauth_state");
  return res;
}

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  if (oauthError) return back(request, "denied");

  const cookieState = request.cookies.get("ebay_oauth_state")?.value;
  if (!code || !state || !cookieState || state !== cookieState) {
    return back(request, "error");
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const now = Date.now();
    const access_expires_at = new Date(now + (tokens.expires_in || 7200) * 1000).toISOString();
    const refresh_expires_at = new Date(now + (tokens.refresh_token_expires_in || 47_304_000) * 1000).toISOString();
    const { username, userId } = await fetchEbayUsername(tokens.access_token);

    const admin = createAdminClient();
    await admin.from("ebay_accounts").upsert(
      {
        user_id: user.id,
        ebay_username: username,
        ebay_user_id: userId,
        access_token: tokens.access_token,
        access_expires_at,
        refresh_token: tokens.refresh_token,
        refresh_expires_at,
        connected_at: new Date(now).toISOString(),
        updated_at: new Date(now).toISOString()
      },
      { onConflict: "user_id" }
    );

    // Initial inventory pull — best-effort; the user can re-sync from Settings
    // if this hiccups.
    await syncUserListings(admin, user.id).catch(() => {});

    return back(request, "connected");
  } catch {
    return back(request, "error");
  }
}
