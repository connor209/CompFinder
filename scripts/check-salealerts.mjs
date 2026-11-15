/**
 * Discord sale alerts: what gets said, and what never gets said twice.
 *
 *   node scripts/check-salealerts.mjs      (or: npm run check)
 *
 * It runs every ten minutes, unattended, into a channel, so the failures that
 * matter are repetition and silence:
 *
 * - Turning it on with forty orders open must not post forty messages.
 * - An order is announced once. A run with nothing new says nothing.
 * - A post that fails is NOT recorded, so the next run sends it; recording
 *   first would lose the sale for good.
 * - Before migration 038 there is no memory, so it must post nothing at all
 *   rather than every open order every ten minutes.
 * - The buyer is their eBay username. Never a name or an address: a channel
 *   is one invite link from somebody it was not meant for.
 * - A card title is not markup and not a ping.
 *
 * Supabase and Discord are both faked. Nothing here touches the network.
 */
import { readFileSync } from "node:fs";
import { alertMessages, packPosts, plain, runSaleAlerts, walkCompare, whereText, isMissingAlertsTable } from "../apps/app/lib/sale-alerts.js";

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── a fake Supabase, just enough of the query builder ───────────────────────

function fakeDb({ tables = {}, missing = [] } = {}) {
  const data = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const unfiltered = [];
  function from(table) {
    let filters = [];
    let named = false;
    let lim = null;
    let rng = null;
    const missingErr = () => ({ data: null, error: { code: "42P01", message: `relation "public.${table}" does not exist` } });
    const run = () => {
      if (missing.includes(table)) return missingErr();
      if (!named) unfiltered.push(table);
      let rows = (data[table] || []).filter((r) => filters.every((f) => f(r)));
      if (rng) rows = rows.slice(rng[0], rng[1] + 1);
      if (lim != null) rows = rows.slice(0, lim);
      return { data: rows, error: null };
    };
    const q = {
      select() { return q; },
      eq(col, v) { if (col === "user_id") named = true; filters.push((r) => r[col] === v); return q; },
      in(col, vs) { filters.push((r) => vs.includes(r[col])); return q; },
      limit(n) { lim = n; return q; },
      order() { return q; },
      range(a, b) { rng = [a, b]; return q; },
      upsert(rows) {
        if (missing.includes(table)) return Promise.resolve(missingErr());
        data[table] = data[table] || [];
        for (const r of rows) if (!data[table].some((x) => x.user_id === r.user_id && x.order_id === r.order_id)) data[table].push({ ...r });
        return Promise.resolve({ data: null, error: null });
      },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); }
    };
    return q;
  }
  return { from, data, unfiltered };
}

const U = "user-1";
const stacks = [{ id: "s-ir", name: "IR", user_id: U }, { id: "s-bl", name: "BL", user_id: U }];
const card = (id, stack, position, sku, listing_sku = null) => ({ id, user_id: U, stack_id: stack, position, sku, listing_sku, pulled_at: null, checked_out_at: null });
const cards = [
  card("c1", "s-ir", 15, "IR15", "CS-DP6TAR_f20a8034"),
  card("c2", "s-ir", 16, "IR16", "CS-DP6TAR_f20a8034"),
  card("c3", "s-bl", 30, "BL30")
];
const line = (orderId, lineItemId, sku, extra = {}) => ({
  orderId, lineItemId, sku, quantity: 1, price: 2.49, currency: "GBP", title: "Lapras 016/091 Paldean Fates Pokemon NM",
  buyer: "phantomwolf077", deliveryName: "Real Person Name", deliveryCity: "Fareham", orderDate: "2026-11-15T10:00:00Z", ...extra
});

// ── the messages ─────────────────────────────────────────────────────────────

console.log("What an alert says");
{
  const lines = [
    line("O1", "L1", "CS-DP6TAR_f20a8034"),
    line("O1", "L2", "BL30", { title: "Pikachu 065/202 *Sword* & Shield @everyone", price: 3.5 }),
    line("O2", "L3", "CS-NOTSTACKED_1", { orderDate: "2026-11-15T09:00:00Z" })
  ];
  const msgs = alertMessages({ lines, alerted: new Set(), cards, stackNames: new Map(stacks.map((s) => [s.id, s.name])) });
  const o1 = msgs.find((m) => m.orderId === "O1")?.text || "";
  check("one message per order, oldest first", msgs.length === 2 && msgs[0].orderId === "O2", msgs.map((m) => m.orderId).join());
  check("the order total is the lines added up", o1.includes("£5.99"), o1);
  check("a variation card says which stack and how deep", /IR · 1 of 2 \(front-most copy\)/.test(o1), o1);
  check("a stack card says where it is", /BL · 1 of 1/.test(o1), o1);
  check("a card on no stack says why", /not on a stack/.test(msgs[0].text), msgs[0].text);
  check("the buyer is the eBay username", o1.includes("phantomwolf077"));
  check("never the buyer's name or town", !o1.includes("Real Person Name") && !o1.includes("Fareham"));
  check("a title's markdown is printed as written", o1.includes("\\*Sword\\*"), o1);
  const already = alertMessages({ lines, alerted: new Set(["O1", "O2"]), cards, stackNames: new Map() });
  check("an order already announced is not in the messages", already.length === 0);
}
check("plain() switches markdown off", plain("Mr_Mime *holo*") === "Mr\\_Mime \\*holo\\*");
check("the walk is A–Z then AA, boxes last", ["AA", "B", "Toploaders", "A"].sort(walkCompare).join() === "A,B,AA,Toploaders");
check("a pulled line says so", whereText({ done: true }, {}) === "already pulled");

console.log("Packing into posts");
{
  const big = Array.from({ length: 30 }, (_, i) => ({ orderId: `O${i}`, text: `💷 order ${i}\n${"• card line here\n".repeat(8)}` }));
  const posts = packPosts(big);
  check("every post is under Discord's limit", posts.every((p) => p.text.length <= 2000), posts.map((p) => p.text.length).join());
  check("every order lands in exactly one post", posts.flatMap((p) => p.orderIds).join() === big.map((m) => m.orderId).join());
  check("one long order is cut, never dropped", packPosts([{ orderId: "X", text: "x".repeat(5000) }])[0].text.length <= 2000);
}

// ── the runs ─────────────────────────────────────────────────────────────────

console.log("What each run posts and records");
const sent = [];
const post = async (_url, text) => { sent.push(text); };
const opts = (lines, p = post) => ({ lines, webhookUrl: "https://discord.com/api/webhooks/1/x", post: p });
{
  const db = fakeDb({ tables: { sale_alerts: [], stack_cards: cards, card_stacks: stacks } });
  sent.length = 0;
  const open = [line("O1", "L1", "BL30"), line("O2", "L2", "CS-DP6TAR_f20a8034")];
  const r1 = await runSaleAlerts(db, U, opts(open));
  check("first run: the open orders are recorded, not announced", r1.ok && r1.seeded === 2 && r1.orders === 0, JSON.stringify(r1));
  check("first run: one line saying alerts are on", sent.length === 1 && /already open/.test(sent[0]), sent.join(" | "));

  sent.length = 0;
  const r2 = await runSaleAlerts(db, U, opts(open));
  check("nothing new: nothing posted", r2.ok && sent.length === 0, JSON.stringify(r2));

  const r3 = await runSaleAlerts(db, U, opts([...open, line("O3", "L3", "CS-DP6TAR_f20a8034")]));
  check("a new order is announced once", r3.ok && r3.orders === 1 && sent.length === 1 && sent[0].includes("O3"), JSON.stringify(r3));
  // O2 holds IR15 (front-most), so O3 is told IR16 — the pull sheet's answer.
  check("…naming the copy the pull sheet would", /IR · 2 of 2/.test(sent[0]), sent[0]);
  sent.length = 0;
  await runSaleAlerts(db, U, opts([...open, line("O3", "L3", "CS-DP6TAR_f20a8034")]));
  check("…and never again", sent.length === 0);

  sent.length = 0;
  const failing = async () => { throw new Error("Discord answered 500."); };
  const r4 = await runSaleAlerts(db, U, opts([line("O4", "L4", "BL30")], failing));
  check("a failed post is reported", !r4.ok && /500/.test(r4.error || ""), JSON.stringify(r4));
  const r5 = await runSaleAlerts(db, U, opts([line("O4", "L4", "BL30")]));
  check("…and not recorded, so the next run sends it", r5.ok && r5.orders === 1 && sent.some((t) => t.includes("O4")), JSON.stringify(r5));
  check("every read named the account", db.unfiltered.length === 0, db.unfiltered.join());
}
{
  const db = fakeDb({ tables: { sale_alerts: [], stack_cards: cards, card_stacks: stacks } });
  sent.length = 0;
  await runSaleAlerts(db, U, opts([]));
  const r = await runSaleAlerts(db, U, opts([line("O9", "L9", "BL30")]));
  check("switched on with nothing open, the first sale is still announced", r.ok && r.orders === 1 && sent.some((t) => t.includes("O9")), JSON.stringify(r));
}
{
  const db = fakeDb({ tables: { stack_cards: cards, card_stacks: stacks }, missing: ["sale_alerts"] });
  sent.length = 0;
  const r = await runSaleAlerts(db, U, opts([line("O1", "L1", "BL30")]));
  check("before 038: nothing posted, and it says why", !r.ok && r.missing && sent.length === 0, JSON.stringify(r));
}
check("a missing table reads as missing", isMissingAlertsTable({ code: "42P01" }) && !isMissingAlertsTable({ message: "timeout" }));

// ── greps ────────────────────────────────────────────────────────────────────

console.log("Where it is wired");
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const lib = read("apps/app/lib/sale-alerts.js");
const route = read("apps/app/app/api/cron/sale-alerts/route.js");
const wf = read(".github/workflows/sale-alerts.yml");
check("a post can never ping anybody", /allowed_mentions:\s*\{\s*parse:\s*\[\]\s*\}/.test(lib));
check("the route refuses to run without CRON_SECRET", /if \(!secret\)/.test(route) && /Bearer \$\{secret\}/.test(route));
check("the route only posts to a Discord webhook", /discord/.test(route) && /WEBHOOK\.test/.test(route));
check("the route goes through runSaleAlerts()", /runSaleAlerts\(/.test(route));
check("the workflow runs every ten minutes, one at a time", /\*\/10 \* \* \* \*/.test(wf) && /concurrency:/.test(wf));
check("the workflow holds no database or eBay key", !/SUPABASE|EBAY_/i.test(wf));
const { execSync } = await import("node:child_process");
const naming = execSync("git grep -l \"sale_alerts\" -- apps/app ':!*.md'", { cwd: new URL("..", import.meta.url) }).toString().trim().split("\n").filter(Boolean);
check("sale_alerts is named in lib/sale-alerts.js alone", naming.length === 1 && naming[0] === "apps/app/lib/sale-alerts.js", naming.join(", "));

if (failures) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll sale alert checks pass.");
