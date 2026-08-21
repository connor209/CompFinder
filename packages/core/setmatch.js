/**
 * Resolve the SET a listing belongs to from its (messy) eBay title.
 *
 * eBay's order payload carries no item specifics — a line item gives us the
 * listing title, the SKU and the chosen variation, nothing more. But the card
 * catalogue knows every set name and its code, so we can read the set straight
 * out of the title: "Pokemon TCG Journey Together JTG Single Cards…" → Journey
 * Together (JTG). That gives the pull sheet a real set name to alphabetise by
 * and a code to print next to it.
 */

/** Lowercase, de-accent, strip punctuation, collapse spaces, pad with spaces. */
export function normalizeForMatch(s) {
  return ` ${String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

// Codes that collide with everyday words in card titles — never match on these
// as a bare token (a name match can still resolve the set).
const CODE_STOPWORDS = new Set([
  "tcg", "ccg", "lot", "new", "psa", "ex", "gx", "vm", "nm", "lp", "mp", "hp",
  "uk", "us", "jp", "eng", "eu", "set", "art", "sr", "ar", "ur", "rr", "hr",
  "mint", "holo", "foil", "rare", "card", "cards", "pack", "box"
]);

/**
 * Build a lookup from cm_sets rows ([{set_name, set_code}]). Returns
 * { names: [{norm, len, name, code}], codes: Map<normCode, {name, code}> },
 * with names ordered longest-first so the most specific set wins.
 */
export function buildSetIndex(rows) {
  const byName = new Map();
  const codes = new Map();
  for (const r of rows || []) {
    const name = (r.set_name || "").trim();
    const code = (r.set_code || "").trim();
    if (!name || name === "Other / Promos") continue;
    // Codes are registered for every set, even ones whose NAME is too short or
    // too numeric to match safely — "151" can't be matched by name (it would
    // catch collector numbers), but its code MEW resolves it cleanly.
    if (code) {
      const cnorm = normalizeForMatch(code).trim();
      if (cnorm.length >= 2 && !CODE_STOPWORDS.has(cnorm) && !codes.has(cnorm)) {
        codes.set(cnorm, { name, code });
      }
    }

    const norm = normalizeForMatch(name).trim();
    // Short names, and names with no letters at all, produce false hits even
    // with word boundaries — leave those to code matching.
    if (norm.length < 4 || !/[a-z]/.test(norm)) continue;
    if (!byName.has(norm)) byName.set(norm, { norm, len: norm.length, name, code });
    else if (code && !byName.get(norm).code) byName.get(norm).code = code;
  }
  const names = [...byName.values()].sort((a, b) => b.len - a.len);
  return { names, codes };
}

/**
 * Find the set a title refers to. Name matches win (longest / most specific
 * first); a bare set-code token is the fallback signal. Returns
 * { name, code } or null.
 */
export function matchSetFromTitle(title, index) {
  if (!index || !title) return null;
  const hay = normalizeForMatch(title);

  for (const entry of index.names) {
    if (hay.includes(` ${entry.norm} `)) return { name: entry.name, code: entry.code || "" };
  }
  for (const token of hay.trim().split(" ")) {
    const hit = index.codes.get(token);
    if (hit) return { name: hit.name, code: hit.code };
  }
  return null;
}

// Marketing noise that surrounds the set name in "pick your card" listings.
const NOISE = [
  /\bpok[eé]mon\b/gi, /\bpokemon\b/gi, /\btcg\b/gi, /\bccg\b/gi, /\btrading card game\b/gi,
  /\bchoose your (own )?card\b/gi, /\bpick your (own )?card\b/gi, /\byou pick\b/gi,
  /\bsingle cards?\b/gi, /\bsingles\b/gi, /\bmultibuy\b/gi, /\bmulti buy\b/gi,
  /\bnear ?mint\b/gi, /\bmint\b/gi, /\bfast (and |& )?free\b/gi, /\bfree p ?& ?p\b/gi,
  /\bp ?& ?p\b/gi, /\bfast (post|dispatch|shipping)\b/gi, /\buk (seller|stock)\b/gi,
  /\bgenuine\b/gi, /\bofficial\b/gi, /\bdiscounts?\b/gi, /\bbundle\b/gi
];

/**
 * Best-effort set label when the catalogue can't resolve one — strips the
 * usual listing noise so what's left sorts and reads sensibly.
 */
export function fallbackSetName(title) {
  let t = String(title || "").trim();
  if (!t) return "Other";
  for (const re of NOISE) t = t.replace(re, " ");
  t = t
    .replace(/[|/\\]+/g, " ")
    .replace(/[–—]+/g, "-")
    .replace(/\s*-\s*$/, "")
    .replace(/^\s*-\s*/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return t || String(title).trim();
}
