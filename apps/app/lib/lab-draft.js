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
 *   overseas       count sales from sellers outside the UK
 *   costPence      what EACH copy cost us, or null for not known (card-costs.js)
 *   picks          the sales YOU chose to price from (ids), or null for the
 *                  filter's own choice — see lab-evidence.js
 *   comps          what /api/batch-comps said ({ pence, n, confidence, flags,
 *                  decision, reason, error }) — decision is CardCropper's
 *                  apply | terapeak | keep | hold
 *   result         what listing it did ({ ok, itemId, joined, error })
 *   file           which export it came from
 *
 * Nothing here talks to eBay or the database.
 */

import { keyForLanguage } from "./lab-copies.js";
import CardUploaderCsv from "./carduploader.js";
import { splitLotCost } from "./card-costs.js";
import { evidencePrice, picksDiffer } from "./lab-evidence.js";
import { ruleKeyFor, saleBreaksRule, isEmptyRule } from "./price-rules.js";

export const DRAFT_KEY = "cf-lab-add-draft-v1";

/** The languages a batch can be. A batch is one language; "count every language" is a pricing choice on top. */
export const LANGUAGES = ["English", "Japanese", "Korean", "Chinese", "German", "French", "Italian", "Spanish", "Portuguese"];

/**
 * Add one file's groups to the list. Returns the WHOLE new list (never
 * changes the one it was given — it is React state) and what was refused.
 * A SKU already loaded from another file is refused; copies of a card and
 * condition already in the list join that row, unless it has been listed.
 */
export function mergeGroups(existing, groups, file, { anyLanguage = false, overseas = false } = {}) {
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
      language: g.language || "English", anyLanguage: Boolean(anyLanguage), overseas: Boolean(overseas), picks: null,
      pricePence: null, titleOverride: "", subtype: "", skippedSkus: [], excluded: false, comps: null, result: null
    });
  }
  return { rows: list, refused, added };
}

/**
 * Rows saved with a card number Excel had turned into a date ("06-Dec" for
 * 6/12), put right — the number, the title, the card the listing is written
 * from and the listing key (its number part). Their sold comps came from a
 * search for "06-Dec" and go, as on a language change, with any price that
 * only came from them; a typed price stays. A listed row is never touched.
 *
 * Run when a batch is opened, so a batch loaded before the reader learned
 * the day-first shape (2026-11-26, the DP Trainer Kit cards) mends itself
 * instead of needing its cards reloaded — which Add copies refuses anyway,
 * since the SKUs are already in it. Returns the SAME array when nothing
 * needed mending, so opening a clean batch saves nothing.
 */
export function repairDateNumbers(rows) {
  let changed = false;
  const out = (rows || []).map((r) => {
    if (!r || r.result?.ok || !r.cardNumber) return r;
    const fixed = CardUploaderCsv.repairExcelDateMangling(r.cardNumber);
    if (fixed === r.cardNumber) return r;
    changed = true;
    const parts = String(r.key || "").split("|");
    if (parts.length >= 4) parts[1] = fixed.toLowerCase();
    const fromComps = r.comps?.pence != null && r.pricePence === r.comps.pence;
    return {
      ...r,
      cardNumber: fixed,
      title: CardUploaderCsv.repairTitle(r.title, r.cardNumber, fixed),
      card: r.card ? { ...r.card, number: fixed } : r.card,
      key: parts.length >= 4 ? parts.join("|") : r.key,
      comps: null, picks: null, checkedAt: null, pricePence: fromComps ? null : r.pricePence
    };
  });
  return changed ? out : rows;
}

/**
 * Rows of a CardUploader export the reader skips — no card name, or (unless
 * `needNumber` is false, as on Add copies) no card number — named, so a 50-row file that loads 49 says which one went. Blank
 * lines (every cell empty) are not rows and are not counted. `rows` are
 * CardUploaderCsv.rowsToObjects() output, in file order; row numbers are the
 * spreadsheet's (the header is row 1).
 */
export function unreadableRows(rows, { needNumber = true } = {}) {
  const out = [];
  (rows || []).forEach((r, i) => {
    const cells = Object.values(r || {}).map((v) => String(v ?? "").trim());
    if (!cells.some(Boolean)) return;
    const name = String(r["*C:Card Name"] || "").trim();
    const number = String(r["*C:Card Number"] || "").trim();
    if (name && (number || !needNumber)) return;
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
  const { pricePence, titleOverride, subtype, skippedSkus, excluded, comps, result, file, id, costPence, checkedAt, saleNotes, ...g } = row; // eslint-disable-line no-unused-vars
  // The cost rides on each copy: it is the copy's, written to its stack card.
  const cost = Number.isInteger(costPence) && costPence >= 0 ? costPence : null;
  return { ...g, copies: liveCopies(row).map((c) => (cost == null ? c : { ...c, costPence: cost })) };
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

/**
 * The sold-comps figure a row shows: what the filter counted, or — once you
 * have ticked different sales in "see sales" — the price those sales make by
 * the same house rules (evidencePrice). `picked` says which, and `counted`
 * keeps the filter's own figure beside it. Your price is never changed by
 * this; "Use this price" does that.
 */
export function compsShown(row) {
  const c = row?.comps;
  if (!c) return { pence: null, n: null, picked: false, counted: null };
  if (c.evidence?.length && picksDiffer(c.evidence, row.picks)) {
    const p = evidencePrice(c.evidence, row.picks, { condition: c.condition || row.condition, game: c.game || row.card?.game || "" });
    return { pence: p.suggestedPence, n: p.n, picked: true, counted: c.pence ?? null };
  }
  return { pence: c.pence ?? null, n: c.n ?? null, picked: false, counted: c.pence ?? null };
}

/**
 * Your rule for a card, applied to the sales a row already has — no new
 * search. Every row of that card (ruleKeyFor) is re-filtered: a counted sale
 * the rule catches goes out as "your rule", and one only your rule had left
 * out comes back when the rule no longer catches it (so a rule can be
 * loosened or removed). The figure is re-worked by the same house rules
 * (evidencePrice); a price that was the old figure follows it, a price you
 * typed stays; your picks stay less what the rule took out, and "checked"
 * goes, since it was about the old sales.
 * `rule` null or empty takes the rule off. Rows with no sales just carry it.
 */
export function applyCardRule(rows, key, rule) {
  const live = isEmptyRule(rule) ? null : rule;
  return (rows || []).map((r) => {
    if (ruleKeyFor(r) !== key || r.result?.ok) return r;
    const c = r.comps;
    if (!c?.evidence?.length) return c ? { ...r, comps: { ...c, rule: live } } : r;
    let changed = false;
    const evidence = c.evidence.map((e) => {
      const why = live ? saleBreaksRule(e.title, live, r.cardName) : null;
      if (e.counted && why) { changed = true; return { ...e, counted: false, reasonCode: "yourRule", reason: `your rule (${why})` }; }
      if (!e.counted && e.reasonCode === "yourRule" && !why) { changed = true; return { ...e, counted: true, reasonCode: null, reason: "" }; }
      return e;
    });
    if (!changed) return { ...r, comps: { ...c, rule: live } };
    const p = evidencePrice(evidence, null, { condition: c.condition || r.condition, game: c.game || r.card?.game || "" });
    const comps = { ...c, evidence, rule: live, pence: p.suggestedPence, n: p.n };
    const followed = r.pricePence == null || r.pricePence === c.pence;
    // Your picks stay, less any sale the rule just took out; a pick the rule
    // gave back stays unpicked (you hadn't chosen it).
    const out = new Set(evidence.filter((e) => e.reasonCode === "yourRule").map((e) => String(e.id)));
    const picks = Array.isArray(r.picks) ? r.picks.filter((id) => !out.has(String(id))) : null;
    return { ...r, comps, picks, checkedAt: null, pricePence: followed ? p.suggestedPence : r.pricePence };
  });
}

/**
 * What a rule saved on a row tells the feedback store (lib/feedback-store.js):
 * a 👎 "wrong card in the sales", the rule in the comment (ruleComment), and
 * the sales as they were BEFORE the rule — what the price was built from is
 * the evidence. `query` is the card's rule key, so the latest vote per card
 * wins in export-feedback.mjs.
 */
export function ruleFeedbackArgs(row, rule, comment, { query = null } = {}) {
  const ev = row?.comps?.evidence || [];
  const comp = (e) => ({
    title: e.title, itemPricePence: Math.round((Number(e.price) || 0) * 100),
    postagePence: Math.round((Number(e.postage) || 0) * 100), totalPence: Math.round((Number(e.total) || 0) * 100),
    ...(e.counted ? {} : { exclusionReason: e.reasonCode || "excluded" })
  });
  return {
    verdict: "down", reason: "wrongCard", comment, surface: "lab",
    row: { title: row?.title, query: query || ruleKeyFor(row || {}), sku: row?.copies?.[0]?.sku, cardNumber: row?.cardNumber, set: row?.set },
    rec: {
      finalPence: row?.comps?.pence ?? null, overridePence: row?.pricePence != null && row.pricePence !== row?.comps?.pence ? row.pricePence : null,
      confidence: row?.comps?.confidence || null, dataSource: "sold",
      house: row?.comps?.decision ? { decision: row.comps.decision } : undefined,
      included: ev.filter((e) => e.counted).map(comp), excluded: ev.filter((e) => !e.counted).map(comp)
    }
  };
}

/** What a decision says, for a row. */
export const DECISION_TEXT = { apply: "Apply", terapeak: "Check Terapeak", keep: "Keep current", hold: "Lookup failed" };

/**
 * Where a row stands. `joins` is the live listing it would join, or null —
 * a join needs no price, since the listing keeps its own.
 */
export function rowStatus(row, joins) {
  if (row.result?.ok) return "listed";
  if (row.result?.pending) return "sending";
  if (row.excluded) return "excluded";
  if (!liveCopies(row).length) return "nocopies";
  if (row.result && !row.result.ok) return "failed";
  if (joins) return "ready";
  if (row.pricePence == null) return "needsprice";
  if (row.pricePence < 99) return "toolow";
  // "Check first" until somebody has looked: then Checked, which lists like Ready.
  return isThin(row) ? (row.checkedAt ? "checked" : "thin") : "ready";
}

export const STATUS_TEXT = {
  ready: "Ready", thin: "Ready · check first", checked: "Checked ✓", needsprice: "Needs a price", toolow: "Under £0.99",
  failed: "Failed", listed: "Listed", excluded: "Left out", nocopies: "Every copy left out",
  sending: "Listing on eBay…"
};

/** How long a sent row waits for its job's answer before it says so. */
export const SENT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Rows sent to a background listing job, settled from what the lab now says
 * (`lab` is /api/lab's GET: listings, copies, events). In order:
 *   1. the job's own event for the row — bulk_listed or bulk_failed;
 *   2. every copy of the row now in the lab — listed, whatever the log says
 *      (the log is the last 200 events and could have scrolled past);
 *   3. no answer after SENT_TIMEOUT_MS — failed, saying to check Inventory
 *      before listing again, because a card that went up and lost its log
 *      line must not be listed twice.
 * Returns the same array if nothing changed (it is React state).
 */
export function settleSent(rows, lab, now = Date.now()) {
  const events = (lab?.events || []).filter((e) => e.kind === "bulk_listed" || e.kind === "bulk_failed");
  const inLab = new Map((lab?.copies || []).map((c) => [String(c.sku).toLowerCase(), c]));
  const itemOf = new Map((lab?.listings || []).map((l) => [String(l.id), l.ebay_item_id]));
  let changed = false;
  const out = (rows || []).map((r) => {
    if (!r.result?.pending) return r;
    const ev = events.find((e) => e.detail?.job === r.result.job && String(e.detail?.rowId) === String(r.id));
    if (ev) {
      changed = true;
      return { ...r, result: ev.kind === "bulk_listed"
        ? { ok: true, itemId: ev.detail.itemId || null, joined: Boolean(ev.detail.joined) }
        : { ok: false, error: ev.detail?.error || "Listing failed." } };
    }
    const copies = liveCopies(r);
    const found = copies.map((c) => inLab.get(String(c.sku).toLowerCase())).filter(Boolean);
    if (copies.length && found.length === copies.length) {
      changed = true;
      return { ...r, result: { ok: true, itemId: itemOf.get(String(found[0].listing_id)) || null, joined: false } };
    }
    if (now - (Number(r.result.sentAt) || 0) > SENT_TIMEOUT_MS) {
      changed = true;
      return { ...r, result: { ok: false, error: "No answer from the listing job. Check Inventory before listing this card again." } };
    }
    return r;
  });
  return changed ? out : rows;
}
/** Rows a "List" button may send: a thin price is the person's call, so it goes. */
export const LISTABLE = new Set(["ready", "thin", "checked", "failed"]);

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
 *   { op: "language", language, anyLanguage, overseas }  the batch got the wrong language
 *                                        or which sales count changed:
 *                                        re-keyed, its sold comps dropped (they
 *                                        were for the other language), and a
 *                                        price that only came from them cleared
 * A row with no sold-comps price is left unchanged by the comps ops; listed
 * rows are never edited.
 */
export function applyBulk(rows, ids, action) {
  const on = new Set((ids || []).map(String));
  // A lot's cost is shared over the rows it covers, by what each is worth
  // (its price, else the comps' figure), per copy — worked out across the
  // whole selection before any row is changed.
  const lot = action.op === "costLot"
    ? splitLotCost((rows || []).filter((r) => on.has(String(r.id)) && !r.result?.ok && !r.excluded)
      .map((r) => ({ id: r.id, copies: liveCopies(r).length, weight: r.pricePence ?? compsShown(r).pence ?? 0 })), action.pence)
    : null;
  return (rows || []).map((r) => {
    if (!on.has(String(r.id)) || r.result?.ok) return r;
    switch (action.op) {
      case "costEach": return Number.isInteger(action.pence) && action.pence >= 0 ? { ...r, costPence: action.pence } : r;
      case "costLot": return lot.has(String(r.id)) ? { ...r, costPence: lot.get(String(r.id)) } : r;
      case "costClear": return { ...r, costPence: null };
      case "price": return action.pence >= 99 ? { ...r, pricePence: action.pence } : r;
      // The sold comps as shown — your picks where you made them.
      case "comps": { const c = compsShown(r).pence; return c != null ? { ...r, pricePence: c } : r; }
      case "compsPct": {
        const c = compsShown(r).pence;
        if (c == null || !Number.isFinite(action.pct)) return r;
        return { ...r, pricePence: ladderUp(c * (1 + action.pct / 100)) };
      }
      // Reviewed: a "check first" row somebody has looked at. Only a row that
      // needs checking can be checked; undoing it puts it back in the pile.
      case "check": return isThin(r) && !r.checkedAt ? { ...r, checkedAt: action.at || new Date().toISOString() } : r;
      case "uncheck": return r.checkedAt ? { ...r, checkedAt: null } : r;
      case "ladder": return r.pricePence != null ? { ...r, pricePence: ladderUp(r.pricePence) } : r;
      case "clear": return { ...r, pricePence: null };
      case "subtype": return { ...r, subtype: action.value || "" };
      case "exclude": return { ...r, excluded: true };
      case "include": return { ...r, excluded: false };
      case "language": {
        const language = LANGUAGES.includes(action.language) ? action.language : r.language || "English";
        const anyLanguage = action.anyLanguage == null ? Boolean(r.anyLanguage) : Boolean(action.anyLanguage);
        const overseas = action.overseas == null ? Boolean(r.overseas) : Boolean(action.overseas);
        if (language === (r.language || "English") && anyLanguage === Boolean(r.anyLanguage) && overseas === Boolean(r.overseas)) return r;
        const fromComps = r.comps?.pence != null && r.pricePence === r.comps.pence;
        return {
          ...r, language, anyLanguage, overseas, key: keyForLanguage(r.key, language),
          card: r.card ? { ...r.card, language } : r.card,
          comps: null, picks: null, checkedAt: null, pricePence: fromComps ? null : r.pricePence
        };
      }
      default: return r;
    }
  });
}

export const FILTERS = [
  ["all", "All"], ["needsprice", "Needs a price"], ["thin", "Check first (Terapeak / thin)"], ["checked", "Checked"], ["joins", "Joins a live listing"],
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
      : filter === "thin" ? !(st === "thin" || (isThin(r) && st !== "listed" && st !== "checked"))
      : filter !== "all" && filter !== st) return false;
    if (!words.length) return true;
    const hay = [r.title, r.titleOverride, r.cardName, r.cardNumber, r.set, r.condition, r.subtype, r.language, ...r.copies.map((c) => c.sku)]
      .join(" ").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
    return words.every((w) => hay.includes(w));
  });
}

/** Sort: needs attention first by default, then by the chosen field. Unpriced last on price sorts. */
export function sortRows(rows, sort = "attention", joinsOf = () => null) {
  const rank = { failed: 0, needsprice: 1, toolow: 1, thin: 2, checked: 3, ready: 3, sending: 3, nocopies: 4, excluded: 5, listed: 6 };
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
    if (st === "excluded" || st === "listed" || st === "nocopies" || st === "sending") continue;
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
