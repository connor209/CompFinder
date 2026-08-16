/**
 * Sell sheets — build the CSV that external listing tools import.
 *
 * Cardmarket-family tools (TCG PowerTools, CardCompanion) take a sheet keyed
 * on Cardmarket's product id, which is exactly what `card_catalog` is keyed on
 * — so a sheet for any set we hold can be generated straight from the
 * catalogue, no manual matching.
 *
 * The column set differs per GAME, not just per tool: Magic carries isFoil and
 * no collector number, Pokémon carries isReverseHolo and `cn`, Yu-Gi-Oh! only
 * first-edition, and Riftbound uses `No` instead of `cn`. Rather than a row
 * builder per format, a profile is just an ordered COLUMN LIST — every known
 * column has one resolver below, so adding a format is a config entry.
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
 * zeros (`001` → `1`), anything with a suffix keeps them (`020a`, `R01`,
 * `ARC125-R`). Verified against all 654 rows of a real Riftbound export.
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

/**
 * Some games print the full card code (OP01-013, BT5-103) where others print a
 * bare number. Our catalogue stores whichever Cardmarket supplied — Digimon
 * already carries the full code, One Piece only the digits — but One Piece
 * names embed the code in brackets (95% of rows), so it can be recovered.
 */
export function cardCodeFromName(name) {
  const m = String(name || "").match(/\(([A-Z]{1,4}\d*-[A-Za-z0-9]+)\)/);
  return m ? m[1] : "";
}

/**
 * One Piece writes its set code hyphenated (`OP-01`) where the catalogue holds
 * `OP01`. Applied only to a bare LETTERS+2-DIGITS code, so codes that already
 * carry punctuation or a suffix (`ST-22-JP`, `OP06P`, `P`) are left alone.
 * Inferred from a single sample row — cosmetic either way, since the product id
 * is what the importer matches on.
 */
function hyphenateSetCode(code) {
  const s = String(code || "");
  const m = s.match(/^([A-Z]{2,3})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}` : s;
}

// Every column any profile can name. `c` = catalogue row, `e` = the entry
// (quantity + the flags/defaults), `f` = the profile (for boolean casing).
// Unset booleans are blank by default — which is what the one real-world
// export does — unless a profile's sample writes them out explicitly.
const flag = (on, f) => (on ? f.boolText : f.explicitFalse ? "false" : "");
const collectorNo = (c, f) =>
  (f.cnFromName ? cardCodeFromName(c.name) : "") || sheetNumber(c.collector_number);
const FIELDS = {
  idProduct: (c) => c.cardmarket_id ?? "",
  cardmarketId: (c) => c.cardmarket_id ?? "",
  quantity: (c, e) => ((e.qty || 0) > 0 ? String(e.qty) : ""),
  name: (c) => c.name || "",
  set: (c) => c.expansion || "",
  setCode: (c, e, f) => (f.setCodeStyle === "hyphenated" ? hyphenateSetCode(c.expansion_code) : c.expansion_code || ""),
  cn: (c, e, f) => collectorNo(c, f),
  No: (c, e, f) => collectorNo(c, f),
  condition: (c, e) => e.condition || "NM",
  language: (c, e) => e.language || "English",
  isFoil: (c, e, f) => flag(e.foil, f),
  isPlayset: (c, e, f) => flag(e.playset, f),
  isSigned: (c, e, f) => flag(e.signed, f),
  isFirstEd: (c, e, f) => flag(e.firstEd, f),
  isReverseHolo: (c, e, f) => flag(e.reverseHolo, f),
  price: (c, e) => sheetPrice(e.price),
  comment: (c, e) => e.comment || ""
};

/** Which optional flags a format actually accepts — drives the UI toggles. */
export const FLAG_COLUMNS = {
  isFoil: { key: "foil", label: "Foil" },
  isPlayset: { key: "playset", label: "Playset" },
  isSigned: { key: "signed", label: "Signed" },
  isFirstEd: { key: "firstEd", label: "First edition" },
  isReverseHolo: { key: "reverseHolo", label: "Reverse holo" }
};

// BOM on every one of these; the real Riftbound export was CRLF while the
// per-game samples are LF. Importers take either, so CRLF is used throughout
// to match the file the tool itself produced.
const BASE = { bom: true, eol: "\r\n", boolText: "true" };

export const SHEET_FORMATS = [
  {
    ...BASE,
    key: "cm-riftbound",
    name: "Riftbound — TCG PowerTools / CardCompanion",
    games: ["riftbound"],
    verified: true,
    boolText: "TRUE",
    columns: ["idProduct", "quantity", "name", "set", "condition", "language", "isFoil", "price", "comment", "No"]
  },
  {
    ...BASE,
    key: "cm-magic",
    name: "Magic — TCG PowerTools / CardCompanion",
    games: ["magic"],
    verified: true,
    columns: ["idProduct", "quantity", "name", "set", "condition", "language", "isFoil", "isPlayset", "isSigned", "isFirstEd", "price", "comment"]
  },
  {
    ...BASE,
    key: "cm-pokemon",
    name: "Pokémon — TCG PowerTools / CardCompanion",
    games: ["pokemon"],
    verified: true,
    columns: ["cardmarketId", "quantity", "name", "set", "cn", "condition", "language", "isPlayset", "isFirstEd", "isReverseHolo", "isSigned", "price", "comment"]
  },
  {
    ...BASE,
    key: "cm-lorcana",
    name: "Lorcana — TCG PowerTools / CardCompanion",
    games: ["lorcana"],
    verified: true,
    explicitFalse: true, // its sample writes "false" rather than leaving blank
    columns: ["idProduct", "quantity", "name", "set", "condition", "language", "isFoil", "isSigned", "price", "comment"]
  },
  {
    ...BASE,
    key: "cm-yugioh",
    name: "Yu-Gi-Oh! — TCG PowerTools / CardCompanion",
    games: ["yugioh"],
    verified: true,
    columns: ["cardmarketId", "quantity", "name", "set", "cn", "condition", "language", "isFirstEd", "isSigned", "price", "comment"]
  },
  {
    ...BASE,
    key: "cm-fab",
    name: "Flesh and Blood — TCG PowerTools / CardCompanion",
    games: ["fleshandblood"],
    verified: true,
    columns: ["cardmarketId", "quantity", "name", "set", "cn", "condition", "language", "isSigned", "price", "comment"]
  },
  {
    ...BASE,
    key: "cm-dragonball",
    name: "Dragon Ball Super — TCG PowerTools / CardCompanion",
    games: ["dragonball"],
    verified: true,
    columns: ["cardmarketId", "quantity", "name", "set", "cn", "condition", "language", "isFoil", "isSigned", "price", "comment"]
  },
  {
    ...BASE,
    key: "cm-weiss",
    name: "Weiss Schwarz — TCG PowerTools / CardCompanion",
    games: ["weissschwarz"],
    verified: true,
    columns: ["cardmarketId", "quantity", "name", "set", "cn", "condition", "language", "isSigned", "price", "comment"]
  },
  {
    ...BASE,
    key: "cm-vanguard",
    name: "Cardfight!! Vanguard — TCG PowerTools / CardCompanion",
    games: ["vanguard"],
    verified: true,
    columns: ["cardmarketId", "quantity", "name", "set", "cn", "condition", "language", "isPlayset", "isSigned", "price", "comment"]
  },
  {
    ...BASE,
    key: "cm-digimon",
    name: "Digimon — TCG PowerTools / CardCompanion",
    games: ["digimon"],
    verified: true,
    columns: ["cardmarketId", "quantity", "name", "set", "setCode", "cn", "condition", "language", "isSigned", "price", "comment"]
  },
  {
    ...BASE,
    key: "cm-onepiece",
    name: "One Piece — TCG PowerTools / CardCompanion",
    games: ["onepiece"],
    verified: true,
    // Their sample writes the full card code (OP01-013) where the catalogue
    // holds only the digits — recovered from the card name.
    cnFromName: true,
    setCodeStyle: "hyphenated",
    columns: ["cardmarketId", "quantity", "name", "set", "setCode", "cn", "condition", "language", "isSigned", "price", "comment"]
  },
  {
    ...BASE,
    key: "cm-generic",
    name: "Other games — Cardmarket style (unverified)",
    games: [],
    verified: false,
    columns: ["cardmarketId", "quantity", "name", "set", "cn", "condition", "language", "isSigned", "price", "comment"]
  }
];

export const getFormat = (key) => SHEET_FORMATS.find((f) => f.key === key) || SHEET_FORMATS[0];

/** The format a game should use by default; falls back to the generic shape. */
export function formatForGame(gameSlug) {
  return SHEET_FORMATS.find((f) => f.games.includes(gameSlug)) || getFormat("cm-generic");
}

/** The flag toggles a format supports, in column order. */
export function flagsForFormat(fmt) {
  return (fmt.columns || []).filter((c) => FLAG_COLUMNS[c]).map((c) => ({ column: c, ...FLAG_COLUMNS[c] }));
}

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
  for (const it of rows) {
    lines.push(fmt.columns.map((col) => esc((FIELDS[col] || (() => ""))(it.card || {}, it.entry || {}, fmt))).join(","));
  }
  return (fmt.bom ? "﻿" : "") + lines.join(fmt.eol) + fmt.eol;
}

/** Suggested filename, e.g. "2026-08-16_Riftbound_Origins.csv". */
export function sheetFilename(gameName, setNames, dateStr) {
  const sets = (setNames || []).length === 1 ? setNames[0] : `${(setNames || []).length} sets`;
  const safe = (s) => String(s || "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${dateStr}_${safe(gameName)}_${safe(sets)}.csv`;
}
