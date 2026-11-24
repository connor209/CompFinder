/**
 * Pounds per euro, for showing Cardmarket's price guide (euros) beside eBay
 * figures (pounds). The European Central Bank publishes one reference rate a
 * working day; the nightly price job fetches it into `fx_rates` (migration
 * 043) and everything that shows a Cardmarket figure reads it from there.
 *
 * When there is no stored rate — 043 not run, or the fetch has never worked —
 * FALLBACK_EUR_GBP is used and the answer says so, so a screen can mark the
 * figure as approximate rather than present a guess as the day's rate.
 */
export const ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
export const FALLBACK_EUR_GBP = 0.85;

/** { rate, asOf } off the ECB's daily XML, or null if it has no GBP line. */
export function parseEcb(xml) {
  const text = String(xml || "");
  const rate = text.match(/currency=['"]GBP['"]\s+rate=['"]([\d.]+)['"]/i) || text.match(/rate=['"]([\d.]+)['"]\s+currency=['"]GBP['"]/i);
  const day = text.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/i);
  const r = rate ? Number(rate[1]) : NaN;
  if (!(r > 0.3 && r < 3)) return null; // a GBP rate outside this is a parse gone wrong
  return { rate: r, asOf: day ? day[1] : null };
}

/** Fetch today's rate and store it. Returns what it stored, or { ok: false, error }. */
export async function refreshEurGbp(admin, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(ECB_URL, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { ok: false, error: `ECB answered ${res.status}` };
    const got = parseEcb(await res.text());
    if (!got) return { ok: false, error: "No GBP rate in the ECB file." };
    const { error } = await admin.from("fx_rates").upsert({ pair: "EURGBP", rate: got.rate, as_of: got.asOf || new Date().toISOString().slice(0, 10), source: "ecb", updated_at: new Date().toISOString() });
    if (error) return { ok: false, error: error.message, missing: /fx_rates/.test(error.message) };
    return { ok: true, ...got };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/** The stored rate, or the fallback marked as such. Never throws. */
export async function loadEurGbp(sb) {
  try {
    const { data, error } = await sb.from("fx_rates").select("rate,as_of").eq("pair", "EURGBP").maybeSingle();
    if (!error && data && Number(data.rate) > 0) return { rate: Number(data.rate), asOf: data.as_of, fallback: false };
  } catch { /* fall through */ }
  return { rate: FALLBACK_EUR_GBP, asOf: null, fallback: true };
}
