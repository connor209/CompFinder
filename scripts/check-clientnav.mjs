/**
 * Moving around the app without a page load (apps/app/lib/client-nav.js).
 *
 *   node scripts/check-clientnav.mjs      (or: npm run check)
 *
 * Every section change used to be a server round trip and a remount of the
 * whole panel, and the lab's links reloaded the app outright. What it pins:
 *
 * - Which URLs may be switched in place, and which still need the server
 *   (a saved run, ?pool, ?import, ?ids, ?wish) — reading one of those in place
 *   would open the panel without the thing the URL names.
 * - Which clicks are left to the browser: another site, a new tab, a download,
 *   a modified click.
 * - Greps: the panel switches sections with navigate(), not router.push; the
 *   screens kept alive are only ones where an old view can't cost a card; the
 *   lab's screens remount on a new URL; an open batch saves when its screen is
 *   left in place; the panel has a loading state; the middleware checks the
 *   login with getClaims().
 */
import { readFileSync, existsSync } from "node:fs";
import { needsServer, inPlaceTarget, isPlainClick, SERVER_QUERY_KEYS } from "../apps/app/lib/client-nav.js";

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};
const ok = (label, cond) => { if (!cond) fail(label); };

// ---- which URLs need the server ----
for (const u of ["/panel/stacks", "/panel/lab/add", "/panel/lab/add?batch=0b3c4c1e-8a1f-4f2e-9b1a-2c3d4e5f6a7b", "/panel/lab/add?new=1", "/panel/batch", "/panel"]) {
  eq(`${u} is switched in place`, needsServer(u), false);
}
for (const u of ["/panel/batch/abc", "/panel/batch?pool=show", "/panel/batch?import=1", "/panel/batch?pool=show&ids=a,b", "/panel/shows?wish=x", "/settings", "/login", "/show/token"]) {
  eq(`${u} needs the server`, needsServer(u), true);
}
eq("the server-only query keys", SERVER_QUERY_KEYS, ["pool", "import", "ids", "wish"]);

// ---- which clicks ----
const origin = "https://app.example";
const a = (href, attrs = {}) => ({
  href: new URL(href, `${origin}/panel/lab/add`).href,
  target: attrs.target || "",
  getAttribute: (k) => (k === "href" ? href : attrs[k] ?? null),
  hasAttribute: (k) => k in attrs
});
eq("a lab tab", inPlaceTarget(a("/panel/lab/inventory"), origin), "/panel/lab/inventory");
eq("a batch tile (relative)", inPlaceTarget(a("?batch=0b3c4c1e-8a1f-4f2e-9b1a-2c3d4e5f6a7b"), origin), "/panel/lab/add?batch=0b3c4c1e-8a1f-4f2e-9b1a-2c3d4e5f6a7b");
eq("a new tab is the browser's", inPlaceTarget(a("?batch=x", { target: "_blank" }), origin), null);
eq("a download is the browser's", inPlaceTarget(a("/panel/stacks", { download: "" }), origin), null);
eq("another site is the browser's", inPlaceTarget(a("https://www.ebay.co.uk/itm/1"), origin), null);
eq("a saved run is the server's", inPlaceTarget(a("/panel/batch/abc"), origin), null);
eq("an in-page anchor is the browser's", inPlaceTarget(a("#top"), origin), null);
eq("no anchor", inPlaceTarget(null, origin), null);
const click = (o = {}) => ({ button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false, ...o });
ok("a plain click", isPlainClick(click()));
ok("cmd-click opens a tab", !isPlainClick(click({ metaKey: true })));
ok("ctrl-click opens a tab", !isPlainClick(click({ ctrlKey: true })));
ok("middle click", !isPlainClick(click({ button: 1 })));
ok("already handled", !isPlainClick(click({ defaultPrevented: true })));

// ---- greps ----
const read = (p) => readFileSync(p, "utf8");
const panel = read("apps/app/app/panel/Panel.js");
ok("sections switch with navigate(), not a server round trip", /const go = useCallback\(\(s\) => \{\s*navigate\(/.test(panel));
ok("a deep dive switches in place", /navigate\(`\/panel\/\$\{STREAM_SLUG\.single\}`\)/.test(panel));
ok("ordinary panel links are caught and switched in place", /document\.addEventListener\("click", onClick\)/.test(panel) && /inPlaceTarget\(a, window\.location\.origin\)/.test(panel));
const keep = (panel.match(/const KEEP_ALIVE = new Set\(\[([^\]]*)\]\)/) || [])[1] || "";
const kept = [...keep.matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
ok("some screens are kept alive", kept.length > 0);
for (const stockScreen of ["inventory", "stacks", "pull", "shows", "streamstock", "cardmarket", "lab", "labadd", "labinventory", "labsettings", "scan", "imports", "buy", "sheets"]) {
  ok(`${stockScreen} always opens fresh — an old view of stock can cost a card`, !kept.includes(stockScreen));
}
for (const k of ["labadd", "labinventory"]) {
  ok(`the ${k} screen remounts on a new URL`, new RegExp(`key=\\{\`${k === "labadd" ? "labadd" : "labinv"}-\\$\\{navCount\\}\`\\}`).test(panel));
}
ok("every screen loads its own code", /const SCREEN_LOADERS = \{/.test(panel) && !/^import ShowDesk from/m.test(panel));
const labAdd = read("apps/app/app/panel/lab/add/LabAdd.js");
ok("an open batch saves when its screen is left in place", /useEffect\(\(\) => \(\) => \{ flushBatch\(\); \}, \[\]\)/.test(labAdd) && /const id = batchIdRef\.current;/.test(labAdd));
ok("the panel has a loading state", existsSync("apps/app/app/panel/loading.js"));
const mw = read("apps/app/middleware.js");
ok("the middleware checks the login locally", /auth\.getClaims\(\)/.test(mw) && !/auth\.getUser\(\)/.test(mw.replace(/\/\/.*$/gm, "")));

if (failures) {
  console.error(`check-clientnav: ${failures} failure(s)`);
  process.exit(1);
}
console.log("check-clientnav: ok");
