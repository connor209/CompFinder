// Who may run a nightly job (apps/app/lib/cron-auth.js). Born from the
// platform review of 2026-11-26: the listings sync, the price pull and the lab
// sale sweep ran for ANYONE when CRON_SECRET was unset, across every account.
import { readFileSync } from "node:fs";
import { cronRefusal } from "../apps/app/lib/cron-auth.js";

let fails = 0, n = 0;
const eq = (label, got, want) => {
  n++;
  if (JSON.stringify(got) !== JSON.stringify(want)) { fails++; console.error(`✗ ${label}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
};
const req = (auth) => ({ headers: { get: (k) => (k === "authorization" ? auth : null) } });

eq("the right bearer runs", cronRefusal(req("Bearer s3"), "s3"), null);
eq("a wrong one is 401", cronRefusal(req("Bearer nope"), "s3")?.status, 401);
eq("none is 401", cronRefusal(req(null), "s3")?.status, 401);
eq("an UNSET secret refuses everyone — it never means open", cronRefusal(req("Bearer "), "")?.status, 503);
eq("…including a request with no header at all", cronRefusal(req(null), undefined)?.status, 503);

for (const p of ["cron/sync", "cron/prices", "lab/sweep"]) {
  const src = readFileSync(new URL(`../apps/app/app/api/${p}/route.js`, import.meta.url), "utf8");
  eq(`${p} goes through cronRefusal`, /cronRefusal\(request\)/.test(src), true);
  eq(`${p} has no "only when set" branch of its own`, /if \(secret\b/.test(src), false);
}

if (fails) { console.error(`\n${fails} of ${n} cron-auth checks failed.`); process.exit(1); }
console.log(`✓ ${n} cron-auth checks pass.`);
