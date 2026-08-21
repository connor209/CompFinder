import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthorizeUrl, ebayConfigured } from "@/lib/ebay";

/**
 * Kicks off the eBay "Connect account" OAuth flow: sets a short-lived,
 * httpOnly state cookie (CSRF guard) and redirects the user to eBay's consent
 * screen. eBay sends them back to /api/ebay/callback.
 */
export async function GET(request) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  if (!ebayConfigured()) {
    return NextResponse.redirect(new URL("/settings?ebay=notconfigured", request.url));
  }

  const state = crypto.randomUUID();
  const res = NextResponse.redirect(getAuthorizeUrl(state));
  res.cookies.set("ebay_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600
  });
  return res;
}
