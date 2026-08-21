import { createClient } from "@/lib/supabase/server";
import HistoryView from "./HistoryView";

/**
 * Per-user price-check history. Middleware protects /history (see
 * middleware.js), so by the time this renders there is always a signed-in
 * user. Newest checks first; capped at a generous 1000 rows so the page
 * stays fast without pagination plumbing — plenty for browsing recent work,
 * and the CSV export covers "give me everything" if it ever matters.
 */
export default async function HistoryPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const { data: checks } = await supabase
    .from("price_checks")
    .select(
      "id, created_at, title, sku, query, ebay_site, data_source, confidence, recommended_pence, current_pence, comps_used, comps_excluded, note"
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1000);

  return (
    <div id="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">CF</span>
          <h1>History</h1>
        </div>
        <div className="topbar-actions">
          <a href="/panel">Back to Comp Finder</a>
        </div>
      </header>

      <HistoryView initialChecks={checks || []} />
    </div>
  );
}
