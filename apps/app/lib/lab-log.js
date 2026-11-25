/**
 * The lab's log, in words. Every eBay change the lab makes and every sale it
 * reads is a `lab_events` row with a kind and a detail object; the overview
 * printed those as `listed · {"itemId":"…"}`, which only the person who wrote
 * the code could read. One sentence per kind here, and a tone for colour.
 *
 * A kind this file doesn't know still reads as a sentence ("Something
 * happened: sweep"), never as JSON — a new kind added to the route without a
 * line here is a plain note, not a crash.
 *
 * Pure, so scripts/check-labbatches.mjs can pin it.
 */
const n = (x) => (x == null ? "?" : x);
const s = (k, one, many) => `${k} ${k === 1 ? one : many}`;

const SAY = {
  listed: (d) => [`Listed on eBay${d.itemId ? ` (item ${d.itemId})` : ""}${d.quantity ? `, ${s(d.quantity, "copy", "copies")}` : ""}.`, "good"],
  joined: (d) => [`Added ${s((d.added || []).length, "copy", "copies")} to a live listing — quantity ${n(d.from)} → ${n(d.to)}.`, "good"],
  bulk_listed: (d) => [`Listed from a batch${d.itemId ? ` (item ${d.itemId})` : ""}${d.joined ? " — joined a live listing" : ""}.`, "good"],
  bulk_failed: (d) => [`A card from a batch didn't list: ${d.error || "no reason given"}.`, "bad"],
  bulk_done: (d) => [`Finished listing a batch: ${n(d.listed)} of ${s(d.cards || 0, "card", "cards")} listed.`, ""],
  reserved: (d) => [`Sold — copy ${d.sku || d.copySku || "?"} reserved for the buyer${d.orderId ? ` (order ${d.orderId})` : ""}.`, "good"],
  mismatch: (d) => [`Sold, but the buyer was shown a different copy${d.sku ? ` than ${d.sku}` : ""}. Check which card goes.`, "bad"],
  oversold: () => ["Sold more copies than the listing had. Check eBay and the stack.", "bad"],
  pictures: (d) => [`Photos moved on to the next copy${d.showing ? `, ${d.showing}` : ""}.`, ""],
  notified: () => ["eBay said a listing sold.", ""],
  sweep: (d) => [`Nightly check: ${n(d.reserved)} sold, ${n(d.moved)} photos moved${d.error ? ` — ${d.error}` : ""}.`, d.error ? "bad" : ""],
  moved: (d) => [`Moved ${s(d.moved || 0, "copy", "copies")} into the stacks.`, ""],
  pulled: () => ["A sold copy was pulled.", ""],
  released: () => ["A reserved copy was released (cancelled order).", ""],
  removed: (d) => [`Took ${d.sku || "a copy"} off its listing — quantity ${n(d.from)} → ${n(d.to)}.`, ""],
  price: (d) => [`Price changed ${d.from != null ? `£${(d.from / 100).toFixed(2)}` : "?"} → ${d.to != null ? `£${(d.to / 100).toFixed(2)}` : "?"}.`, ""],
  quantity: (d) => [`eBay quantity set ${n(d.from)} → ${n(d.to)}.`, ""],
  ended: (d) => [`Listing ended${d.itemId ? ` (item ${d.itemId})` : ""}.`, ""],
  template: (d) => [d.toTitle ? `Title rewritten to "${d.toTitle}".` : "Listing text rewritten from the settings.", ""],
  settings: () => ["Listing settings saved.", ""],
  notifications: (d) => [d.saleEnabled ? "Sale notifications turned on." : "Sale notifications turned off.", ""],
  error: (d) => [`Something went wrong${d.action ? ` (${d.action})` : ""}: ${d.message || "no message"}${d.sku ? ` — ${d.sku}` : ""}.`, "bad"]
};

/** { text, tone } for one log row. tone is "good" | "bad" | "". */
export function describeEvent(e) {
  const say = SAY[e?.kind];
  if (!say) return { text: `Something happened: ${String(e?.kind || "unknown").replace(/_/g, " ")}.`, tone: "" };
  try {
    const [text, tone] = say(e.detail || {});
    return { text, tone };
  } catch {
    return { text: `Something happened: ${e.kind}.`, tone: "" };
  }
}
