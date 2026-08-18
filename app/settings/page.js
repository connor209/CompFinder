import { createClient } from "@/lib/supabase/server";
import SettingsForm from "./SettingsForm";
import EbayConnect from "./EbayConnect";
import AccountData from "./AccountData";
import DashboardPrefs from "./DashboardPrefs";
import ListingPolicies from "./ListingPolicies";
import PriceSync from "./PriceSync";
import CompFinderPricing from "@/lib/pricing.js";

const EBAY_FLASH = {
  connected: "eBay account connected — your listings are syncing.",
  denied: "eBay connection was cancelled.",
  error: "Something went wrong connecting to eBay. Please try again.",
  notconfigured: "eBay integration isn't configured on the server yet."
};

export default async function SettingsPage({ searchParams }) {
  const sp = await searchParams;
  const flash = EBAY_FLASH[sp?.ebay] || "";
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("soldcomps_api_key, settings")
    .eq("id", user.id)
    .single();

  // Merge whatever's actually saved over the shared defaults — same
  // pattern pricing.js's loadSettings() already used for chrome.storage,
  // just backed by the profiles table instead.
  const settings = { ...CompFinderPricing.DEFAULT_SETTINGS, ...(profile?.settings || {}) };

  return (
    <div id="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">CF</span>
          <h1>Settings</h1>
        </div>
        <div className="topbar-actions">
          <a href="/panel">Back to Comp Finder</a>
        </div>
      </header>

      <SettingsForm initialApiKey={profile?.soldcomps_api_key || ""} initialSettings={settings} />
      <DashboardPrefs initialSettings={settings} />
      <EbayConnect flash={flash} />
      <ListingPolicies initialSettings={settings} />
      <PriceSync />
      <AccountData email={user.email} />
    </div>
  );
}
