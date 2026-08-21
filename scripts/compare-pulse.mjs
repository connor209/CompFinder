/**
 * Compare our prices against PulseTCG's monthly best-sellers.
 *
 * IMPORTANT ABOUT WHAT THIS PROVES. Pulse's "market price" is not a UK eBay
 * sold price: different marketplace, different buyer pool, different condition
 * mix, and a different currency basis. So a gap is not automatically our error
 * — the two numbers are measuring related but distinct things. What the
 * comparison is genuinely good for is spotting *shape*: cards where we are out
 * by an order of magnitude, or where we return nothing at all, are ours to
 * explain. Cards within a sensible band are simply two markets agreeing.
 *
 *   node scripts/compare-pulse.mjs [--url ...] [--limit N]
 */
import CompFinderPricing from "@compfinder/core/pricing.js";
import CompFinderLiquidity from "@compfinder/core/liquidity.js";
import { buildCompTokens } from "../apps/public/lib/tokens.js";

const settings = CompFinderPricing.DEFAULT_SETTINGS;
const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const BASE = argOf("--url", "https://comp-finder-public.vercel.app").replace(/\/$/, "");
const LIMIT = Number(argOf("--limit", "999"));

// PulseTCG monthly best sellers, transcribed from the dashboard.
// pulse = their market price in pence; vol30 = their 30-day sales volume.
const REFERENCE = [
  { name: "Slowbro",              number: "090/084", set: "Pitch Black",   rarity: "IR",  pulse: 1200,  vol30: 584 },
  { name: "Goldeen",              number: "087/084", set: "Pitch Black",   rarity: "IR",  pulse: 961,   vol30: 543 },
  { name: "Mega Darkrai ex",      number: "116/084", set: "Pitch Black",   rarity: "SIR", pulse: 16106, vol30: 419 },
  { name: "Dhelmise",             number: "091/084", set: "Pitch Black",   rarity: "IR",  pulse: 447,   vol30: 413 },
  { name: "Fomantis",             number: "085/084", set: "Pitch Black",   rarity: "IR",  pulse: 396,   vol30: 359 },
  { name: "Primarina",            number: "088/084", set: "Pitch Black",   rarity: "IR",  pulse: 398,   vol30: 347 },
  { name: "Armarouge",            number: "086/084", set: "Pitch Black",   rarity: "IR",  pulse: 489,   vol30: 334 },
  { name: "Manectric",            number: "089/084", set: "Pitch Black",   rarity: "IR",  pulse: 334,   vol30: 331 },
  { name: "Morpeko ex",           number: "117/084", set: "Pitch Black",   rarity: "SIR", pulse: 6709,  vol30: 325 },
  { name: "Silvally",             number: "095/084", set: "Pitch Black",   rarity: "IR",  pulse: 418,   vol30: 307 },
  { name: "Toucannon",            number: "094/084", set: "Pitch Black",   rarity: "IR",  pulse: 403,   vol30: 301 },
  { name: "Morpeko ex",           number: "102/084", set: "Pitch Black",   rarity: "UR",  pulse: 682,   vol30: 289 },
  { name: "Mega Darkrai ex",      number: "101/084", set: "Pitch Black",   rarity: "UR",  pulse: 817,   vol30: 290 },
  { name: "Mega Zeraora ex",      number: "098/084", set: "Pitch Black",   rarity: "UR",  pulse: 765,   vol30: 290 },
  { name: "Mega Excadrill ex",    number: "103/084", set: "Pitch Black",   rarity: "UR",  pulse: 543,   vol30: 283 },
  { name: "Froakie",              number: "088/086", set: "Chaos Rising",  rarity: "IR",  pulse: 1015,  vol30: 279 },
  { name: "Thievul",              number: "092/084", set: "Pitch Black",   rarity: "IR",  pulse: 335,   vol30: 279 },
  { name: "Wailord ex",           number: "097/084", set: "Pitch Black",   rarity: "UR",  pulse: 471,   vol30: 276 },
  { name: "Mega Chandelure ex",   number: "099/084", set: "Pitch Black",   rarity: "UR",  pulse: 774,   vol30: 274 },
  { name: "Bastiodon",            number: "093/084", set: "Pitch Black",   rarity: "IR",  pulse: 423,   vol30: 273 },
  { name: "Mega Zeraora ex",      number: "114/084", set: "Pitch Black",   rarity: "SIR", pulse: 3885,  vol30: 260 },
  { name: "Misty's Vitality",     number: "111/084", set: "Pitch Black",   rarity: "UR",  pulse: 1405,  vol30: 257 },
  { name: "Rampardos ex",         number: "100/084", set: "Pitch Black",   rarity: "UR",  pulse: 488,   vol30: 255 },
  { name: "Xerneas",              number: "091/086", set: "Chaos Rising",  rarity: "IR",  pulse: 818,   vol30: 249 },
  { name: "Clefairy",             number: "094/088", set: "Perfect Order", rarity: "IR",  pulse: 1809,  vol30: 242 },
  { name: "Lurantis ex",          number: "096/084", set: "Pitch Black",   rarity: "UR",  pulse: 463,   vol30: 238 },
  { name: "Mega Chandelure ex",   number: "115/084", set: "Pitch Black",   rarity: "SIR", pulse: 3112,  vol30: 233 },
  { name: "Gladion's Final Battle", number: "118/084", set: "Pitch Black", rarity: "SIR", pulse: 2415, vol30: 235 },
  { name: "Gwynn",                number: "109/084", set: "Pitch Black",   rarity: "UR",  pulse: 586,   vol30: 230 },
  { name: "Ampharos",             number: "090/086", set: "Chaos Rising",  rarity: "IR",  pulse: 766,   vol30: 232 }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gbp = (p) => (p == null ? "—" : "£" + (p / 100).toFixed(2));

async function price(query, sold) {
  const res = await fetch(`${BASE}/api/price`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, sold, soldAfterDays: 90 })
  });
  return res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
}

function score(ref, comps, region) {
  const pool = region === "uk" ? comps.filter((c) => !c.itemLocation) : comps;
  const tokens = buildCompTokens({ name: ref.name, number: ref.number }, ref.name);
  const rec = CompFinderPricing.recommend(pool, settings, tokens, "sold", ref.number, ref.set);
  return { rec, used: (rec.included || []).length, poolSize: pool.length };
}

async function main() {
  const list = REFERENCE.slice(0, LIMIT);
  console.log(`Comparing ${list.length} PulseTCG best sellers against ${BASE}\n`);
  console.log("card                              pulse     ours(UK)  n   ours(WW)  n   ratio  vol90");
  console.log("-".repeat(92));

  const rows = [];
  for (const ref of list) {
    const query = `${ref.name} ${ref.number} ${ref.set}`;
    const sold = await price(query, true);
    await sleep(200);
    if (!sold.ok) {
      console.log(`${(ref.name + " " + ref.number).padEnd(33)} FETCH FAILED ${sold.error}`);
      rows.push({ ref, failed: sold.error });
      continue;
    }
    const comps = sold.comps || [];
    const uk = score(ref, comps, "uk");
    const ww = score(ref, comps, "ww");
    const best = ww.used >= uk.used ? ww : uk;
    const ratio = best.rec.finalPence && ref.pulse ? best.rec.finalPence / ref.pulse : null;

    const liq = CompFinderLiquidity.assess({
      soldComps: ww.rec.included || [], activeCount: null, windowDays: 90
    });

    rows.push({ ref, uk, ww, ratio, fetched: comps.length, saturated: comps.length >= 39, liq, hasNextPage: sold.hasNextPage });
    console.log(
      `${(ref.name + " " + ref.number).padEnd(33)} ${gbp(ref.pulse).padStart(8)}  ` +
      `${gbp(uk.rec.finalPence).padStart(8)} ${String(uk.used).padStart(2)}  ` +
      `${gbp(ww.rec.finalPence).padStart(8)} ${String(ww.used).padStart(2)}  ` +
      `${(ratio ? ratio.toFixed(2) + "x" : "  —").padStart(6)}  ${String(ww.used).padStart(3)}` +
      (comps.length >= 39 ? " CAP" : "")
    );
  }

  report(rows);
}

function report(rows) {
  const ok = rows.filter((r) => !r.failed);
  const priced = ok.filter((r) => r.ratio != null);
  const none = ok.filter((r) => r.ww.used === 0);

  console.log("\n" + "=".repeat(92));
  console.log(`${ok.length} compared · ${priced.length} produced a price · ${none.length} produced nothing`);

  if (priced.length) {
    const ratios = priced.map((r) => r.ratio).sort((a, b) => a - b);
    const med = ratios[Math.floor(ratios.length / 2)];
    const within = (lo, hi) => priced.filter((r) => r.ratio >= lo && r.ratio <= hi).length;
    console.log(`\nOur price ÷ Pulse market price:`);
    console.log(`  median ratio      ${med.toFixed(2)}x`);
    console.log(`  within 0.75–1.5x  ${within(0.75, 1.5)}/${priced.length}`);
    console.log(`  within 0.5–2x     ${within(0.5, 2)}/${priced.length}`);
    console.log(`  beyond 3x either way  ${priced.filter((r) => r.ratio > 3 || r.ratio < 0.33).length}/${priced.length}`);
  }

  const sat = ok.filter((r) => r.saturated);
  console.log(`\nResult-set saturation: ${sat.length}/${ok.length} searches returned 39+ comps (the page cap).`);
  console.log("  For those, our sold count is a FLOOR, not a measurement — see volume note.");

  const worst = priced.slice().sort((a, b) => Math.abs(Math.log(b.ratio)) - Math.abs(Math.log(a.ratio))).slice(0, 8);
  if (worst.length) {
    console.log("\nFurthest from Pulse:");
    for (const r of worst) {
      console.log(`  ${(r.ref.name + " " + r.ref.number).padEnd(33)} pulse ${gbp(r.ref.pulse).padStart(8)} vs ours ${gbp(r.ww.rec.finalPence).padStart(8)}  ${r.ratio.toFixed(2)}x  (${r.ww.used} comps)`);
    }
  }

  if (none.length) {
    console.log("\nNo price produced:");
    for (const r of none) {
      const reasons = {};
      for (const e of r.ww.rec.excluded || []) reasons[e.exclusionReason] = (reasons[e.exclusionReason] || 0) + 1;
      console.log(`  ${(r.ref.name + " " + r.ref.number).padEnd(33)} ${r.fetched} fetched · ${JSON.stringify(reasons)}`);
    }
  }

  // Volume: ours is a 90-day count, Pulse is 30-day. Compare like for like.
  const volRows = ok.filter((r) => r.ww.used > 0);
  if (volRows.length) {
    console.log("\nVolume, ours (90d ÷ 3) vs Pulse 30d:");
    for (const r of volRows.slice(0, 12)) {
      const our30 = Math.round(r.ww.used / 3);
      console.log(
        `  ${(r.ref.name + " " + r.ref.number).padEnd(33)} pulse ${String(r.ref.vol30).padStart(4)}/30d · ours ~${String(our30).padStart(3)}/30d` +
        (r.saturated ? "  (CAPPED — floor only)" : "")
      );
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
