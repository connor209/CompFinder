import Panel from "../Panel";

/**
 * Optional catch-all so every section has its own URL — /panel, /panel/stacks,
 * /panel/sales, etc. — while sharing one panel shell. The first path segment
 * selects the active section.
 */
export default async function PanelPage({ params }) {
  const { slug } = await params;
  return <Panel initialSection={slug?.[0] || "dashboard"} />;
}
