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
import { createPacer } from "./lib/pace.mjs";
import CompFinderPricing from "@compfinder/core/pricing.js";
import CompFinderLiquidity from "@compfinder/core/liquidity.js";
import { buildCompTokens } from "../apps/public/lib/tokens.js";
import { priceCard } from "./lib/price-card.mjs";

const settings = CompFinderPricing.DEFAULT_SETTINGS;
const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const BASE = argOf("--url", "https://comp-finder-public.vercel.app").replace(/\/$/, "");
const LIMIT = Number(argOf("--limit", "999"));

import { REFERENCE } from "./pulse-reference.mjs";
import { auditHeaders } from "./lib/audit-headers.mjs";


const pacer = createPacer({ onWait: (msg) => console.log(`      ⏳ ${msg}`) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gbp = (p) => (p == null ? "—" : "£" + (p / 100).toFixed(2));

async function price(query, sold) {
  const { status, body } = await pacer.call(async () => {
    const r = await rawPrice(query, sold);
    return { status: r.status, body: r.body };
  });
  return { status, ...body };
}

async function rawPrice(query, sold) {
  const res = await fetch(`${BASE}/api/price`, {
    method: "POST",
    headers: auditHeaders(),
    body: JSON.stringify({ query, sold, soldAfterDays: 90 })
  });
  const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  return { status: res.status, body: json };
}

/** The page's actual pipeline, via the shared module. */
function scoreNow(ref, comps) {
  const card = { name: ref.name, number: ref.number, set: ref.set, q: `${ref.name} ${ref.number} ${ref.set}` };
  const p = priceCard(card, comps);
  return { rec: p.rec, pence: p.pence, used: p.used, ukPence: p.marketPence, ukUsed: p.marketUsed };
}

async function main() {
  const list = REFERENCE.slice(0, LIMIT);
  console.log(`Comparing ${list.length} PulseTCG best sellers against ${BASE}\n`);
  console.log("card                              pulse       THEN  n      NOW  n   then/pulse  now/pulse");
  console.log("-".repeat(96));

  const rows = [];
  for (const ref of list) {
    const query = `${ref.name} ${ref.number} ${ref.set}`;
    const sold = await price(query, true);
    if (!sold.ok) {
      console.log(`${(ref.name + " " + ref.number).padEnd(33)} FETCH FAILED ${sold.error}`);
      rows.push({ ref, failed: sold.error });
      continue;
    }
    const comps = sold.comps || [];
    const now = scoreNow(ref, comps);
    const then = { pence: null, used: 0 };
    const ratioThen = null;
    const ratio = now.pence && ref.pulse ? now.pence / ref.pulse : null;

    const liq = CompFinderLiquidity.assess({
      soldComps: now.rec ? now.rec.included || [] : [], activeCount: null, windowDays: 90
    });

    rows.push({ ref, then, now, ratioThen, ratio, ww: now, fetched: comps.length, saturated: comps.length >= 39, liq, hasNextPage: sold.hasNextPage });
    console.log(
      `${(ref.name + " " + ref.number).padEnd(33)} ${gbp(ref.pulse).padStart(8)}  ` +
      `${gbp(then.pence).padStart(8)} ${String(then.used).padStart(2)}  ` +
      `${gbp(now.pence).padStart(8)} ${String(now.used).padStart(2)}  ` +
      `${(ratioThen ? ratioThen.toFixed(2) + "x" : "  —").padStart(9)}  ` +
      `${(ratio ? ratio.toFixed(2) + "x" : "  —").padStart(9)}` +
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
    const band = (rows, key) => {
      const rs = rows.map((r) => r[key]).filter((x) => x != null).sort((a, b) => a - b);
      const med = rs[Math.floor(rs.length / 2)];
      const within = (lo, hi) => rs.filter((x) => x >= lo && x <= hi).length;
      return {
        n: rs.length, med,
        tight: within(0.75, 1.5),
        loose: within(0.5, 2),
        wild: rs.filter((x) => x > 3 || x < 0.33).length
      };
    };
    const t = band(priced, "ratioThen");
    const n = band(priced, "ratio");
    console.log(`\nOur price ÷ Pulse market price        THEN        NOW`);
    console.log(`  median ratio                     ${t.med.toFixed(2)}x       ${n.med.toFixed(2)}x`);
    console.log(`  within 0.75–1.5x              ${String(t.tight).padStart(4)}/${t.n}   ${String(n.tight).padStart(4)}/${n.n}`);
    console.log(`  within 0.5–2x                 ${String(t.loose).padStart(4)}/${t.n}   ${String(n.loose).padStart(4)}/${n.n}`);
    console.log(`  beyond 3x either way          ${String(t.wild).padStart(4)}/${t.n}   ${String(n.wild).padStart(4)}/${n.n}`);

    // Where the two scorings disagree by more than a rounding step.
    const moved = priced
      .filter((r) => r.then.pence && r.now.pence && Math.abs(r.now.pence / r.then.pence - 1) > 0.1)
      .sort((a, b) => Math.abs(Math.log(b.now.pence / b.then.pence)) - Math.abs(Math.log(a.now.pence / a.then.pence)));
    console.log(`\nPrices that moved more than 10% between the two scorings: ${moved.length}`);
    for (const r of moved.slice(0, 15)) {
      console.log(`  ${(r.ref.name + " " + r.ref.number).padEnd(33)} ${gbp(r.then.pence).padStart(8)} -> ${gbp(r.now.pence).padStart(8)}   (${r.then.used} -> ${r.now.used} comps, pulse ${gbp(r.ref.pulse)})`);
    }
  }

  const sat = ok.filter((r) => r.saturated);
  console.log(`\nResult-set saturation: ${sat.length}/${ok.length} searches returned 39+ comps (the page cap).`);
  console.log("  For those, our sold count is a FLOOR, not a measurement — see volume note.");

  const worst = priced.slice().sort((a, b) => Math.abs(Math.log(b.ratio)) - Math.abs(Math.log(a.ratio))).slice(0, 8);
  if (worst.length) {
    console.log("\nFurthest from Pulse:");
    for (const r of worst) {
      console.log(`  ${(r.ref.name + " " + r.ref.number).padEnd(33)} pulse ${gbp(r.ref.pulse).padStart(8)} vs ours ${gbp(r.now.pence).padStart(8)}  ${r.ratio.toFixed(2)}x  (${r.now.used} comps)`);
    }
  }

  if (none.length) {
    console.log("\nNo price produced:");
    for (const r of none) {
      const reasons = {};
      for (const e of (r.now.rec && r.now.rec.excluded) || []) reasons[e.exclusionReason] = (reasons[e.exclusionReason] || 0) + 1;
      console.log(`  ${(r.ref.name + " " + r.ref.number).padEnd(33)} ${r.fetched} fetched · ${JSON.stringify(reasons)}`);
    }
  }

  const pace = pacer.stats();
  console.log(`\nPacing: ${pace.served} calls made, ${pace.retried} rate-limit backoffs, ${pace.waitedSeconds}s spent waiting.`);

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
