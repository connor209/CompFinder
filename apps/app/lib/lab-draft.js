/**
 * The Add copies working list (/panel/lab/add): every card and condition from
 * one or more CardUploader exports, priced and edited before anything is
 * listed. Pure — the screen holds the list, this says what each row is and
 * what a bulk edit does to it.
 *
 * A DRAFT ROW is a lab group (lab-copies.js groupsFromItems) plus what the
 * person has decided about it:
 *   pricePence     the price it will list at, or null
 *   titleOverride  a title typed for this card alone, or ""
 *   subtype        one of the saved subtypes, or ""
 *   skippedSkus    copies left out of this listing
 *   excluded       the whole row left out
 *   language       the batch's language, chosen when it was loaded
 *   anyLanguage    count sold comps in every language, not just this one
 *   comps          what /api/batch-comps said ({ pence, n, confidence, flags,
 *                  decision, reason, error }) — decision is CardCropper's
 *                  apply | terapeak | keep | hold
 *   result         what listing it did ({ ok, itemId, joined, error })
 *   file           which export it came from
 *
 * Nothing here talks to eBay or the database.
 */

import { keyForLanguage } from "./lab-copies.js";

export const DRAFT_KEY = "cf-lab-add-draft-v1";

/** The languages a batch can be. A batch is one language; "count every language" is a pricing choice on top. */
export const LANGUAGES = ["English", "Japanese", "Korean", "Chinese", "German", "French", "Italian", "Spanish", "Portuguese"];

/**
 * Add one file's groups to the list. Returns the WHOLE new list (never
 * changes the one it was given — it is React state) and what was refused.
 * A SKU already loaded from another file is refused; copies of a card and
 * condition already in the list join that row, unless it has been listed.
 */
export function mergeGroups(existing, groups, file, { anyLanguage = false } = {}) {
  const list = (existing || []).map((r) => ({ ...r, copies: r.copies.slice() }));
  const have = new Set(list.flatMap((r) => r.copies.map((c) => String(c.sku).toLowerCase())));
  const refused = [];
  let added = 0;
  for (const g of groups || []) {
    const copies = g.copies.filter((c) => {
      const k = String(c.sku).toLowerCase();
      if (have.has(k)) { refused.push({ sku: c.sku, title: g.title, why: "already loaded (from this or another file)" }); return false; }
      have.add(k);
      return true;
    });
    if (!copies.length) continue;
    added += copies.length;
    const same = list.find((r) => r.key === g.key && !r.result?.ok);
    if (same) { same.copies.push(...copies); continue; }
    list.push({
      ...g, copies, id: `${g.key}::${file}`, file,
      language: g.language || "English", anyLanguage: Boolean(anyLanguage),
      pricePence: null, titleOverride: "", subtype: "", skippedSkus: [], excluded: false, comps: null, result: null
    });
  }
  return { rows: list, refused, added };
}

/**
 * Rows of a CardUploader export the reader skips — no card name or no card
 * number — named, so a 50-row file that loads 49 says which one went. Blank
 * lines (every cell empty) are not rows and are not counted. `rows` are
 * CardUploaderCsv.rowsToObjects() output, in file order; row numbers are the
 * spreadsheet's (the header is row 1).
 */
export function unreadableRows(rows) {
  const out = [];
  (rows || []).forEach((r, i) => {
    const cells = Object.values(r || {}).map((v) => String(v ?? "").trim());
    if (!cells.some(Boolean)) return;
    const name = String(r["*C:Card Name"] || "").trim();
    const number = String(r["*C:Card Number"] || "").trim();
    if (name && number) return;
    const missing = [!name && "card name", !number && "card number"].filter(Boolean).join(" and ");
    out.push({ sku: String(r.CustomLabel || r["*CustomLabel"] || "").trim() || `row ${i + 2}`, title: String(r["*Title"] || r.Title || "").trim(), why: `no ${missing} on the row — fill it in in CardUploader and export again` });
  });
  return out;
}

/** The copies this row will actually list, skipped ones out. */
export function liveCopies(row) {
  const skip = new Set((row.skippedSkus || []).map((s) => String(s).toLowerCase()));
  return (row.copies || []).filter((c) => !skip.has(String(c.sku).toLowerCase()));
}

/** The group the server is sent: the row with its skipped copies taken out. */
export function groupToSend(row) {
  const { pricePence, titleOverride, subtype, skippedSkus, excluded, comps, result, file, id, ...g } = row; // eslint-disable-line no-unused-vars
  return { ...g, copies: liveCopies(row) };
}

const THIN = new Set(["low", "none"]);
/**
 * A price worth a second look. With a decision from the house rules (CardCropper's
 * ladder), anything but "apply" — a rise on few sales, a big move, a wide
 * spread, nothing found, a failed lookup. Without one (a list priced before
 * the port), the engine's confidence and flags, as before.
 */
export const isThin = (row) => {
  const c = row.comps;
  if (!c) return false;
  if (c.error) return true;
  if (c.decision) return c.decision !== "apply";
  return Boolean(THIN.has(c.confidence) || (c.flags || []).length);
};

/** What a decision says, for a row. */
export const DECISION_TEXT = { apply: "Apply", terapeak: "Check Terapeak", keep: "Keep current", hold: "Lookup failed" };

/**
 * Where a row stands. `joins` is the live listing it would join, or null —
 * a join needs no price, since the listing keeps its own.
 */
export function rowStatus(row, joins) {
  if (row.result?.ok) return "listed";
  if (row.excluded) return "excluded";
  if (!liveCopies(row).length) return "nocopies";
  if (row.result && !row.result.ok) return "failed";
  if (joins) return "ready";
  if (row.pricePence == null) return "needsprice";
  if (row.pricePence < 99) return "toolow";
  return isThin(row) ? "thin" : "ready";
}

export const STATUS_TEXT = {
  ready: "Ready", thin: "Ready · check first", needsprice: "Needs a price", toolow: "Under £0.99",
  failed: "Failed", listed: "Listed", excluded: "Left out", nocopies: "Every copy left out"
};
/** Rows a "List" button may send: a thin price is the person's call, so it goes. */
export const LISTABLE = new Set(["ready", "thin", "failed"]);

/**
 * The house ladder: up onto the next .49 or .99, never below £0.99. The same
 * shape house-pricing.js puts a sold-comps price on, applied to a typed one.
 */
export function ladderUp(pence) {
  if (!Number.isFinite(pence) || pence <= 0) return null;
  const p = Math.max(99, Math.ceil(pence));
  const pounds = Math.floor(p / 100);
  const rem = p % 100;
  if (rem <= 49) return pounds * 100 + 49 < 99 ? 99 : pounds * 100 + 49;
  return pounds * 100 + 99;
}

/** Pence from a typed price, or null. */
export function parsePrice(v) {
  const s = String(v ?? "").replace(/[£,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const p = Math.round(Number(s) * 100);
  return p > 0 ? p : null;
}

/**
 * A bulk edit on the rows whose ids are given. Returns NEW rows (the list is
 * React state). Ops:
 *   { op: "price", pence }               one price for all
 *   { op: "comps" }                      each row's sold-comps price
 *   { op: "compsPct", pct }              sold-comps price ± pct, laddered up
 *   { op: "ladder" }                     round each current price up onto .49/.99
 *   { op: "clear" }                      no price
 *   { op: "subtype", value }             set or clear the subtype
 *   { op: "exclude" } / { op: "include" }
 *   { op: "language", language, anyLanguage }  the batch got the wrong language:
 *                                        re-keyed, its sold comps dropped (they
 *                                        were for the other language), and a
 *                                        price that only came from them cleared
 * A row with no sold-comps price is left unchanged by the comps ops; listed
 * rows are never edited.
 */
export function applyBulk(rows, ids, action) {
  const on = new Set((ids || []).map(String));
  return (rows || []).map((r) => {
    if (!on.has(String(r.id)) || r.result?.ok) return r;
    switch (action.op) {
      case "price": return action.pence >= 99 ? { ...r, pricePence: action.pence } : r;
      case "comps": return r.comps?.pence != null ? { ...r, pricePence: r.comps.pence } : r;
      case "compsPct": {
        if (r.comps?.pence == null || !Number.isFinite(action.pct)) return r;
        return { ...r, pricePence: ladderUp(r.comps.pence * (1 + action.pct / 100)) };
      }
      case "ladder": return r.pricePence != null ? { ...r, pricePence: ladderUp(r.pricePence) } : r;
      case "clear": return { ...r, pricePence: null };
      case "subtype": return { ...r, subtype: action.value || "" };
      case "exclude": return { ...r, excluded: true };
      case "include": return { ...r, excluded: false };
      case "language": {
        const language = LANGUAGES.includes(action.language) ? action.language : r.language || "English";
        const anyLanguage = action.anyLanguage == null ? Boolean(r.anyLanguage) : Boolean(action.anyLanguage);
        if (language === (r.language || "English") && anyLanguage === Boolean(r.anyLanguage)) return r;
        const fromComps = r.comps?.pence != null && r.pricePence === r.comps.pence;
        return {
          ...r, language, anyLanguage, key: keyForLanguage(r.key, language),
          card: r.card ? { ...r.card, language } : r.card,
          comps: null, pricePence: fromComps ? null : r.pricePence
        };
      }
      default: return r;
    }
  });
}

export const FILTERS = [
  ["all", "All"], ["needsprice", "Needs a price"], ["thin", "Check first (Terapeak / thin)"], ["joins", "Joins a live listing"],
  ["ready", "Ready"], ["failed", "Failed"], ["listed", "Listed"], ["excluded", "Left out"]
];

/** Filter and search. `joinsOf(row)` answers whether a row joins a live listing. */
export function filterRows(rows, { filter = "all", q = "", file = "" } = {}, joinsOf = () => null) {
  const words = String(q || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/\s+/).filter(Boolean);
  return (rows || []).filter((r) => {
    const st = rowStatus(r, joinsOf(r));
    if (file && r.file !== file) return false;
    if (filter === "joins" ? !joinsOf(r)
      : filter === "ready" ? st !== "ready"
      : filter === "thin" ? !(st === "thin" || (isThin(r) && st !== "listed"))
      : filter !== "all" && filter !== st) return false;
    if (!words.length) return true;
    const hay = [r.title, r.titleOverride, r.cardName, r.cardNumber, r.set, r.condition, r.subtype, r.language, ...r.copies.map((c) => c.sku)]
      .join(" ").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
    return words.every((w) => hay.includes(w));
  });
}

/** Sort: needs attention first by default, then by the chosen field. Unpriced last on price sorts. */
export function sortRows(rows, sort = "attention", joinsOf = () => null) {
  const rank = { failed: 0, needsprice: 1, toolow: 1, thin: 2, ready: 3, nocopies: 4, excluded: 5, listed: 6 };
  const by = {
    attention: (a, b) => rank[rowStatus(a, joinsOf(a))] - rank[rowStatus(b, joinsOf(b))],
    name: (a, b) => String(a.title).localeCompare(String(b.title), undefined, { numeric: true }),
    "price-desc": (a, b) => (b.pricePence ?? -1) - (a.pricePence ?? -1),
    "comps-desc": (a, b) => (b.comps?.pence ?? -1) - (a.comps?.pence ?? -1),
    sku: (a, b) => String(a.copies[0]?.sku).localeCompare(String(b.copies[0]?.sku), undefined, { numeric: true })
  }[sort] || (() => 0);
  return (rows || []).slice().sort((a, b) => by(a, b) || String(a.copies[0]?.sku).localeCompare(String(b.copies[0]?.sku), undefined, { numeric: true }));
}

/** The rows ticked AND on screen — the only rows a bulk action or List may touch. */
export function tickedOnScreen(ticked, shown) {
  const on = new Set([...(ticked || [])].map(String));
  return (shown || []).filter((r) => on.has(String(r.id)));
}

/** What a list of rows comes to, for the summary line and the confirm. */
export function draftTotals(rows, joinsOf = () => null) {
  const t = { rows: 0, copies: 0, value: 0, byStatus: {} };
  for (const r of rows || []) {
    const st = rowStatus(r, joinsOf(r));
    t.byStatus[st] = (t.byStatus[st] || 0) + 1;
    if (st === "excluded" || st === "listed" || st === "nocopies") continue;
    t.rows += 1;
    const n = liveCopies(r).length;
    t.copies += n;
    if (!joinsOf(r) && r.pricePence != null) t.value += r.pricePence * n;
  }
  return t;
}

/** What survives a reload: everything but the per-request bits. */
export function serialiseDraft(rows) {
  return JSON.stringify({ v: 1, at: new Date().toISOString(), rows: (rows || []).map(({ ...r }) => r) });
}
export function restoreDraft(text) {
  try {
    const d = JSON.parse(text || "");
    return d && d.v === 1 && Array.isArray(d.rows) ? d.rows : [];
  } catch {
    return [];
  }
}
