import Panel from "../Panel";

/**
 * Optional catch-all so every section has its own URL — /panel, /panel/stacks,
 * /panel/sales, etc. — while sharing one panel shell. The first path segment
 * selects the active section.
 *
 * A second segment is a saved batch run: /panel/batch/<id> re-opens it. It
 * belongs in the URL rather than in state because a slug change remounts the
 * panel — which is what loses an in-memory run in the first place — so a run
 * identified by its URL is one that survives a deep dive and comes back on the
 * browser's Back button.
 *
 * `?pool=show` is the same idea one step earlier: it names a set of cards to
 * price (the open show checkouts) before a run exists to have an id. Read here
 * on the server and passed down as a prop rather than with useSearchParams(),
 * which would drag the whole client tree behind a Suspense boundary for one
 * string.
 */
export default async function PanelPage({ params, searchParams }) {
  const { slug } = await params;
  const query = (await searchParams) || {};
  const pool = Array.isArray(query.pool) ? query.pool[0] : query.pool;
  return (
    <Panel
      initialSection={slug?.[0] || "dashboard"}
      initialBatchId={slug?.[1] || null}
      initialPool={pool || null}
    />
  );
}
