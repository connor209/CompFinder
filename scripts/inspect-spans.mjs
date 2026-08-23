/**
 * Prints the comps a wide-priced card was actually built from, cheapest first,
 * so the low tail can be read rather than guessed at.
 *
 *   node scripts/inspect-spans.mjs "Umbreon VMAX 215 Evolving Skies" [...]
 *
 * Sold comps cache for 24 hours, so re-inspecting a card the audit has just
 * priced is free and doesn't touch SoldComps. Run it right after a run.
 */
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import CompFinderPricing from "@compfinder/core/pricing.js";
import { buildCompTokens, dropWrongSetTotal, dropWrongNumerator } from "../apps/public/lib/tokens.js";
import { UK, splitByMarket } from "../apps/public/lib/markets.js";
import { settingsForCard } from "../apps/public/lib/settings.js";
import { auditHeaders } from "./lib/audit-headers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.AUDIT_URL || "https://comp-finder-public.vercel.app").replace(/\/$/, "");
const gbp = (p) => (p == null ? "—" : CompFinderPricing.toPoundsStr(p));

/** "Umbreon VMAX 215 Evolving Skies" -> {name, number, set} */
function parse(q) {
  const m = q.match(/^(.*?)\s+([A-Z]{0,3}\d{1,4}[a-z]?)\s+(.*)$/);
  return m ? { name: m[1], number: m[2], set: m[3], q } : { name: q, number: null, set: null, q };
}

for (const q of process.argv.slice(2)) {
  const card = parse(q);
  const res = await fetch(`${BASE}/api/price`, {
    method: "POST", headers: auditHeaders(),
    body: JSON.stringify({ query: q, sold: true, soldAfterDays: 90 })
  }).then((r) => r.json());

  const comps = res.comps || [];
  const cs = settingsForCard(card);
  const tokens = buildCompTokens({ name: card.name, number: card.number }, q);
  const { chosen, rest } = splitByMarket(dropWrongNumerator(dropWrongSetTotal(comps, card.number), card.number), UK);
  const rec = CompFinderPricing.recommend([...chosen, ...rest], cs, tokens, "sold", card.number, card.set);
  const used = (rec.included || []).slice().sort((a, b) => (a.totalPence || 0) - (b.totalPence || 0));

  console.log(`\n${"=".repeat(100)}\n${q}   ${res.cached ? "(cached)" : "(LIVE FETCH)"}   ${comps.length} fetched, ${used.length} used`);
  console.log(`market ${gbp(rec.rawPence)}   span ${gbp(used[0]?.totalPence)} - ${gbp(used[used.length - 1]?.totalPence)}`);
  for (const c of used) {
    console.log(`  ${gbp(c.totalPence).padStart(9)}  ${String(c.title || "").slice(0, 84)}`);
  }
  const dropped = (rec.excluded || []).filter((e) => e.exclusionReason !== "graded");
  if (dropped.length) {
    console.log(`  --- excluded (${(rec.excluded || []).length} total, ${dropped.length} non-graded) ---`);
    for (const e of dropped.slice(0, 8)) {
      console.log(`  ${gbp(e.itemPricePence).padStart(9)} ${String(e.exclusionReason).padStart(16)}  ${String(e.title || "").slice(0, 64)}`);
    }
  }
}
