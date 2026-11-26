import Panel from "../Panel";

/**
 * Optional catch-all so every section has its own URL — /panel, /panel/stacks,
 * /panel/sales, etc. — while sharing one panel shell. The first path segment
 * selects the active section.
 *
 * It also used to read a saved Bulk pricing run (/panel/batch/<id>) and the
 * ?pool, ?import and ?ids query strings that handed cards to that screen. Bulk
 * pricing was removed on 2026-11-26, and an old link of that shape now opens
 * the dashboard.
 */
export default async function PanelPage({ params }) {
  const { slug } = await params;
  return <Panel initialSection={slug?.[0] || "dashboard"} />;
}
