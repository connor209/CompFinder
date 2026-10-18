/**
 * What a visitor sees the instant the QR opens, while the server is still
 * reading the stock.
 *
 * The page waits on the database — the whole inventory, read and sorted into
 * cards on the server — and on a cold start that is a few seconds of blank
 * phone, which reads as a broken link on venue wifi. Next streams this first,
 * so something moves at once. It is static: no data, nothing about the link,
 * so it cannot show a stranger anything.
 *
 * A card in the app's holo foil, turning, over a bar that moves. The bar is
 * indeterminate on purpose — nothing here knows how far through the read the
 * server is, and a bar that fills to 90% and sits there is a promise it cannot
 * keep.
 */
export default function Loading() {
  return (
    <main className="sf-shell">
      <div className="sf-loading" role="status" aria-live="polite">
        <span className="sf-loading-card" aria-hidden="true" />
        <p className="sf-loading-text">Fetching our stock…</p>
        <span className="sf-progress sf-progress-wide" aria-hidden="true"><span /></span>
      </div>
    </main>
  );
}
