/**
 * The settings blob as it stands NOW, for a section about to save its slice.
 *
 * Every section on the Settings page writes the whole `profiles.settings`
 * object, and each used to spread the copy it was handed when the page
 * loaded — so saving SoldComps, then dashboard prefs, on one visit quietly
 * put the SoldComps settings back. Re-reading before each write is what keeps
 * one section's save from undoing another's. If the read fails, the page-load
 * copy is the fallback, which is no worse than before.
 */
export async function currentSettings(supabase, userId, fallback) {
  try {
    const { data, error } = await supabase.from("profiles").select("settings").eq("id", userId).single();
    if (error || !data) return fallback || {};
    return data.settings || {};
  } catch {
    return fallback || {};
  }
}
