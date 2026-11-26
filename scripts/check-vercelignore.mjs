// The public page's Vercel "ignoreCommand" (apps/public/vercel.json) may only
// ever exit 0 (skip) or 1 (build). Anything else fails the deployment — and
// when the commit it diffs against is missing from Vercel's shallow clone,
// `git diff` exits 128. That is what failed EVERY Last Comp deploy from
// 2026-10-10 to 2026-11-26: the last good deploy's SHA never moved on, so
// every later build compared against a commit the clone didn't have.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

let fails = 0, n = 0;
const eq = (label, got, want) => {
  n++;
  if (JSON.stringify(got) !== JSON.stringify(want)) { fails++; console.error(`✗ ${label}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
};
const dir = new URL("../apps/public/", import.meta.url);
const cmd = JSON.parse(readFileSync(new URL("vercel.json", dir), "utf8")).ignoreCommand;
const run = (env) => {
  try { execFileSync("sh", ["-c", cmd], { cwd: dir, env: { ...process.env, ...env }, stdio: "ignore" }); return 0; }
  catch (e) { return e.status; }
};
eq("a preview is never built", run({ VERCEL_ENV: "preview" }), 0);
eq("a previous SHA the clone doesn't have means BUILD, not a failed deploy", run({ VERCEL_ENV: "production", VERCEL_GIT_PREVIOUS_SHA: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" }), 1);
eq("nothing changed since HEAD means skip", run({ VERCEL_ENV: "production", VERCEL_GIT_PREVIOUS_SHA: "HEAD" }), 0);
eq("it can only ever exit 0 or 1", /git diff --quiet[^;]*&& exit 0 \|\| exit 1/.test(cmd) && /git cat-file -e/.test(cmd), true);

if (fails) { console.error(`\n${fails} of ${n} Vercel ignore checks failed.`); process.exit(1); }
console.log(`✓ ${n} Vercel ignore checks pass.`);
