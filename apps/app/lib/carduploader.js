/**
 * Comp Finder — CardUploader CSV support.
 *
 * CardUploader exports eBay's own "File Exchange" bulk-listing format:
 * *Title, CustomLabel (SKU), *StartPrice, and a set of Item Specifics
 * columns prefixed C:/*C: including *C:Card Name, *C:Card Number, *C:Set,
 * *C:Finish, and C:Card Condition. Confirmed against a real 100-row export
 * from the user's account (2026-08-11).
 *
 * Two real data-quality quirks found in that export, both handled below:
 * 1. *C:Finish is UNRELIABLE for Reverse Holo — of 30 titles that say
 *    "Reverse Holo", 25 left *C:Finish blank and the other 5 just said
 *    "Holo". It never once said "Reverse Holo" literally. So Reverse Holo
 *    detection still has to come from the Title text, not this field.
 * 2. *C:Set sometimes falls back to a generic placeholder ("Miscellaneous
 *    Cards & Products") when CardUploader couldn't identify a real set —
 *    that placeholder must NOT be used as a match requirement, or every
 *    comp for that item would wrongly get excluded.
 *
 * A third one found later (2026-08-11), not in CardUploader's export itself
 * but in how it can get damaged afterwards: if the CSV is ever opened and
 * re-saved in Excel or Sheets, a *C:Card Number cell containing ONLY
 * something like "4/99" (nothing else in the cell, unlike Title which has
 * surrounding text and is never touched) gets silently reinterpreted as a
 * date and rewritten as "Apr-99". repairExcelDateMangling() below detects
 * and reverses that specific, confirmed pattern.
 */
const CardUploaderCsv = (() => {

  const GENERIC_SET_VALUES = new Set([
    "miscellaneous cards & products",
    "miscellaneous",
    "other",
    ""
  ]);

  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

  /**
   * Reverses Excel/Sheets' date auto-conversion of a bare "N/NN"-style card
   * number into "Mmm-NN" (e.g. "4/99" -> "Apr-99"). Only fires on an exact,
   * confident match — a genuinely different value that happens to look like
   * "Mmm-NN" for some other reason is very unlikely in this context (card
   * numbers don't naturally take that shape), but this stays conservative
   * on purpose rather than guessing on anything looser.
   */
  function repairExcelDateMangling(cardNumber) {
    const m = /^([A-Za-z]{3})-(\d{1,4})$/.exec((cardNumber || "").trim());
    if (!m) return cardNumber;
    const monthIndex = MONTHS.indexOf(m[1].toLowerCase());
    if (monthIndex === -1) return cardNumber;
    return `${monthIndex + 1}/${m[2]}`;
  }

  // ---- RFC4180-ish CSV parser (handles quoted fields, embedded commas,
  // embedded newlines inside quotes, and "" as an escaped quote) ----

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    // Normalise line endings first so embedded \r\n inside quoted fields
    // doesn't produce stray blank fields.
    const s = text.replace(/\r\n/g, "\n");

    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inQuotes) {
        if (c === '"') {
          if (s[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += c;
      }
    }
    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
  }

  function rowsToObjects(rows) {
    if (rows.length === 0) return [];
    const header = rows[0];
    return rows.slice(1).map((r) => {
      const obj = {};
      header.forEach((h, idx) => (obj[h] = r[idx] !== undefined ? r[idx] : ""));
      return obj;
    });
  }

  // ---- Condition label -> internal code ----

  function mapConditionLabel(label) {
    const t = (label || "").toLowerCase();
    if (/near mint/.test(t)) return "NM";
    if (/lightly played/.test(t)) return "LP";
    if (/moderately played/.test(t)) return "MP";
    if (/heavily played/.test(t)) return "HP";
    if (/damaged|poor/.test(t)) return "DMG";
    return "Unknown";
  }

  // ---- Extract clean items from a raw CardUploader CSV string ----

  function extractItems(csvText) {
    const raw = rowsToObjects(parseCsv(csvText));
    return raw
      .filter((r) => (r["*C:Card Name"] || "").trim() && (r["*C:Card Number"] || "").trim())
      .map((r) => {
        const rawCardNumber = (r["*C:Card Number"] || "").trim();
        const cardNumber = repairExcelDateMangling(rawCardNumber);
        return {
          sku: r["CustomLabel"] || "",
          title: r["*Title"] || "",
          cardName: (r["*C:Card Name"] || "").trim(),
          cardNumber,
          cardNumberRepaired: cardNumber !== rawCardNumber,
          set: (r["*C:Set"] || "").trim(),
          conditionLabel: r["C:Card Condition"] || "",
          condition: mapConditionLabel(r["C:Card Condition"]),
          startPrice: r["*StartPrice"] || "",
          graded: (r["*C:Graded"] || "").trim().toLowerCase() === "yes"
        };
      });
  }

  // ---- Build a search query + safety-net tokens from a structured item ----
  // (mirrors CompFinderPricing.simplifyTitle's Reverse Holo handling, but
  // starting from clean fields instead of guessing from a free-text title)

  /**
   * Builds a search query from a structured CardUploader item.
   * `includeCondition` (2026-08-12 request): when true, appends the item's
   * own condition (NM/LP/MP/HP/DMG, already mapped from *C:Card Condition)
   * to the search text sent to SoldComps. Off by default — condition can
   * swing price meaningfully on some cards and barely matter on others, so
   * this is the user's call per batch, not a fixed assumption. Skipped
   * automatically when the item's condition wasn't recognised ("Unknown"),
   * since appending that word to a search would just narrow results for no
   * real reason.
   */
  /**
   * Builds a search query from a structured CardUploader item.
   * `includeCondition`: appends NM/LP/MP/HP/DMG to the condensed query
   * (see earlier comment in this file's history). `useFullTitle`
   * (2026-08-12 request, based on real manual comparison finding fuller
   * titles sometimes return stronger results than the condensed query):
   * when true, sends CardUploader's own `*Title` field verbatim as the
   * search text instead of the condensed name+number+condition version —
   * a real listing title, closer to how other sellers actually word their
   * own similar listings, which can search-match better than a stripped-
   * down query. `includeCondition` becomes a no-op when this is on, since
   * a real CardUploader title already naturally contains whatever
   * condition text was in the original listing.
   *
   * nameTokens is UNCHANGED by either option — always built from the
   * clean, minimal identity (name + number [+ Reverse Holo]), never from
   * whatever text ends up in `query`. This matters: nameTokens is the
   * safety net requiring a comp's title to contain every token, and
   * building it from a full noisy title would make it require every comp
   * to also mention words like "TCG" or a specific collection name,
   * wrongly excluding genuine matches that just don't happen to repeat
   * that exact phrasing — the same mistake already caught and fixed once
   * for the condition toggle, applies here for the same underlying reason.
   */
  function buildQueryFromItem(item, options = {}) {
    const wantsReverseHolo = /\breverse\s*holo\b/i.test(item.title || "");
    const setIsUsable = item.set && !GENERIC_SET_VALUES.has(item.set.trim().toLowerCase());

    const nameTokens = CompFinderPricing.extractNameTokens(
      [item.cardName, wantsReverseHolo ? "Reverse Holo" : "", item.cardNumber].filter(Boolean).join(" ")
    );

    let query;
    if (options.useFullTitle && item.title && item.title.trim()) {
      query = item.title.trim().replace(/\s+/g, " ");
    } else {
      const parts = [item.cardName];
      if (wantsReverseHolo) parts.push("Reverse Holo");
      parts.push(item.cardNumber);
      if (options.includeCondition && item.condition && item.condition !== "Unknown") {
        parts.push(item.condition);
      }
      query = parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    }

    return { query, nameTokens, wantsReverseHolo, set: setIsUsable ? item.set : null };
  }

  return { parseCsv, rowsToObjects, mapConditionLabel, extractItems, buildQueryFromItem, GENERIC_SET_VALUES };
})();

if (typeof module !== "undefined") module.exports = CardUploaderCsv;
