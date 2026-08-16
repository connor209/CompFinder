/**
 * Sell sheets — build the CSV that external listing tools import.
 *
 * Cardmarket-family tools (TCG PowerTools, CardCompanion) take a sheet keyed
 * on Cardmarket's product id, which is exactly what `card_catalog` is keyed on
 * — so a sheet for any set we hold can be generated straight from the
 * catalogue, no manual matching.
 *
 * Formats differ per tool and per game, so each is a PROFILE: columns, how a
 * row is built, and the file details that quietly break imports (their sheets
 * are UTF-8 *with BOM* and CRLF-terminated, both verified against a real
 * export).
 */

/** Cardmarket condition codes, best first. */
export const CM_CONDITIONS = [
  { code: "MT", label: "Mint" },
  { code: "NM", label: "Near Mint" },
  { code: "EX", label: "Excellent" },
  { code: "GD", label: "Good" },
  { code: "LP", label: "Light Played" },
  { code: "PL", label: "Played" },
  { code: "PO", label: "Poor" }
];

export const CM_LANGUAGES = [
  "English", "French", "German", "Italian", "Spanish",
  "Japanese", "Simplified Chinese", "Traditional Chinese", "Korean", "Portuguese", "Russian"
];

/**
 * Collector number as these sheets write it: plain numbers lose their leading
 * zeros (`001` → `1`), anything with a suffix keeps them (`020a`, `R01`, `T03`).
 * Verified against all 654 rows of a real Riftbound export.
 */
export function sheetNumber(no) {
  const s = String(no == null ? "" : no).trim();
  if (!s) return "";
  return /^\d+$/.test(s) ? String(parseInt(s, 10)) : s;
}

/** Price as the sheets write it — no trailing zeros ("0.2", not "0.20"). */
export function sheetPrice(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return "";
  return String(Number(n.toFixed(2)));
}

/** Quote only when a field needs it — matches how their exports look. */
function esc(v) {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const SHEET_FORMATS = [
  {
    key: "cardmarket-tools",
    name: "TCG PowerTools / CardCompanion",
    hint: "Cardmarket-style sheet — UTF-8 with BOM, CRLF line endings.",
    columns: ["idProduct", "quantity", "name", "set", "condition", "language", "isFoil", "price", "comment", "No"],
    bom: true,
    eol: "\r\n",
    /** card = catalogue row, e = { qty, condition, language, foil, price, comment } */
    row: (card, e) => [
      card.cardmarket_id,
      e.qty > 0 ? String(e.qty) : "",
      card.name || "",
      card.expansion || "",
      e.condition || "NM",
      e.language || "English",
      e.foil ? "TRUE" : "",
      sheetPrice(e.price),
      e.comment || "",
      sheetNumber(card.collector_number)
    ]
  }
];

export const getFormat = (key) => SHEET_FORMATS.find((f) => f.key === key) || SHEET_FORMATS[0];

/**
 * Build the sheet. `items` is [{ card, entry }]; returns the file text.
 * `onlyWithQty` drops rows you haven't counted — leave it off to export the
 * whole set as a template to fill in later (which is how these sheets are
 * usually produced).
 */
export function buildSheetCsv(items, formatKey, { onlyWithQty = false } = {}) {
  const fmt = getFormat(formatKey);
  const rows = (items || []).filter((it) => (onlyWithQty ? (it.entry?.qty || 0) > 0 : true));
  const lines = [fmt.columns.join(",")];
  for (const it of rows) lines.push(fmt.row(it.card, it.entry || {}).map(esc).join(","));
  return (fmt.bom ? "﻿" : "") + lines.join(fmt.eol) + fmt.eol;
}

/** Suggested filename, e.g. "2026-08-16_Riftbound_Origins.csv". */
export function sheetFilename(gameName, setNames, dateStr) {
  const sets = (setNames || []).length === 1 ? setNames[0] : `${(setNames || []).length} sets`;
  const safe = (s) => String(s || "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${dateStr}_${safe(gameName)}_${safe(sets)}.csv`;
}
