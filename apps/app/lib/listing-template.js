/**
 * How a lab listing is written: its title, its description and the order of
 * its pictures. docs/LISTING_STUDIO.md, part B.
 *
 * Pure, and used on BOTH sides: the settings screen and the lab's preview
 * render with these functions, and the server renders the listing it sends
 * with the same ones. A preview built any other way would eventually disagree
 * with what went live.
 */

/** eBay's title limit. */
export const TITLE_MAX = 80;
export const MAX_DESCRIPTIONS = 3;
export const MAX_SHOP_IMAGES = 6;
/** eBay's picture limit per listing. */
export const MAX_PICTURES = 24;

/** The placeholders a title or description can use, in the order offered. */
export const FIELDS = [
  ["name", "Card name"], ["number", "Card number"], ["set", "Set name"], ["setCode", "Set code"],
  ["rarity", "Rarity"], ["finish", "Finish"], ["condition", "Condition"], ["language", "Language"],
  ["game", "Card game"], ["year", "Year"], ["illustrator", "Illustrator"], ["type", "Type"],
  ["stage", "Stage"], ["sku", "SKU"], ["subtype", "Subtype"]
];
const FIELD_KEYS = new Set(FIELDS.map(([k]) => k));

export const CONDITION_WORDS = { NM: "Near Mint", LP: "Lightly Played", MP: "Moderately Played", HP: "Heavily Played" };

/** What the lab says about the photos, always, whatever the template. */
export const PHOTO_PROMISE =
  "The photos show the exact copy you will receive. If you buy more than one, " +
  "the others are further copies of the same card in the same condition.";

/** Settings for an account that has never saved any. Matches what the lab did before templates. */
export const DEFAULT_SETTINGS = {
  categoryId: "183454",
  postcode: "",
  shippingCost: "0",
  dispatchDays: "2",
  returnsDays: "14",
  bestOffer: { enabled: false, autoAcceptPct: "", minPct: "" },
  title: {
    abbreviateCondition: true,
    parts: [
      { type: "field", key: "name" }, { type: "field", key: "number" }, { type: "field", key: "set" },
      { type: "field", key: "game" }, { type: "field", key: "language" }, { type: "field", key: "finish" },
      { type: "field", key: "condition" }
    ]
  },
  descriptions: [{ name: "Main description", html: "<p>{name} {number} — {set}</p>\n<p>Condition: {condition}</p>" }],
  activeDescription: 0,
  shopImages: [],
  subtypes: []
};

/** Fill in anything an older saved row lacks, so a new setting never reads as undefined. */
export function withDefaults(saved) {
  const s = saved && typeof saved === "object" ? saved : {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    bestOffer: { ...DEFAULT_SETTINGS.bestOffer, ...(s.bestOffer || {}) },
    title: { ...DEFAULT_SETTINGS.title, ...(s.title || {}), parts: Array.isArray(s.title?.parts) ? s.title.parts : DEFAULT_SETTINGS.title.parts },
    descriptions: Array.isArray(s.descriptions) && s.descriptions.length ? s.descriptions.slice(0, MAX_DESCRIPTIONS) : DEFAULT_SETTINGS.descriptions,
    shopImages: Array.isArray(s.shopImages) ? s.shopImages.slice(0, MAX_SHOP_IMAGES) : [],
    subtypes: Array.isArray(s.subtypes) ? s.subtypes : []
  };
}

/** One placeholder's text for a card, or "" when the card doesn't have it. */
export function fieldValue(card, key, { abbreviateCondition = true } = {}) {
  const c = card || {};
  if (key === "condition") {
    const code = String(c.condition || "").toUpperCase();
    return abbreviateCondition ? code : CONDITION_WORDS[code] || code;
  }
  const v = c[key];
  return v == null ? "" : String(v).replace(/\s+/g, " ").trim();
}

/**
 * The title for one card. Returns { text, full, cut }: `full` is everything
 * the template asked for, `text` is what eBay gets (cut at the last whole
 * word inside 80 characters), and `cut` says whether anything was lost —
 * which the preview shows, rather than letting eBay cut it silently.
 */
export function buildTitle(tpl, card) {
  const t = tpl || DEFAULT_SETTINGS.title;
  const words = [];
  for (const p of t.parts || []) {
    let v = p.type === "text" ? String(p.value || "") : FIELD_KEYS.has(p.key) ? fieldValue(card, p.key, t) : "";
    v = v.replace(/\s+/g, " ").trim();
    if (!v) continue;
    if (p.upper) v = v.toUpperCase();
    words.push(v);
  }
  const full = words.join(" ").replace(/\s+/g, " ").trim();
  if (full.length <= TITLE_MAX) return { text: full, full, cut: false };
  const head = full.slice(0, TITLE_MAX + 1);
  const at = head.lastIndexOf(" ");
  const text = (at > 40 ? head.slice(0, at) : full.slice(0, TITLE_MAX)).trim();
  return { text, full, cut: true };
}

const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Why a description can't be saved, or null. eBay refuses active content in
 * a listing, so the lab refuses it when the template is SAVED rather than
 * when a listing fails at publish time.
 */
export function descriptionProblem(html) {
  const s = String(html || "");
  if (/<\s*script\b/i.test(s)) return "Scripts aren't allowed — eBay refuses listings with active content.";
  if (/<\s*(iframe|object|embed|form|applet)\b/i.test(s)) return "Frames, forms and embedded objects aren't allowed on eBay.";
  if (/\son[a-z]+\s*=/i.test(s)) return "Event handlers (onclick= and similar) aren't allowed on eBay.";
  if (/javascript\s*:/i.test(s)) return "javascript: links aren't allowed on eBay.";
  if (s.length > 50000) return "That description is over 50,000 characters.";
  return null;
}

/**
 * Is this template PLAIN TEXT rather than HTML? No tag anywhere in it. A
 * stray "<4" or "<£10" is not a tag (a tag starts with a letter or "/"), so
 * "Card amounts <4 and … <£10" — the house description, word for word — is
 * plain text, which is what it is.
 */
export function isPlainTextTemplate(text) {
  return !/<\/?[a-z][^>]*>/i.test(String(text || ""));
}

/**
 * The description for one card: placeholders filled (escaped — a card name
 * is data, not markup), unknown ones reported, and the photo promise
 * appended, always.
 *
 * A PLAIN-TEXT template keeps its line breaks. HTML ignores them, so the
 * house description — pasted from CardUploader with a blank line between
 * each section — went up as one paragraph (caught in the preview,
 * 2026-11-24). CardUploader turns a line break into <br>; so does this, after
 * escaping the text, so its "<4" and "<£10" read as written. A template that
 * IS HTML is left exactly as typed: its author decided where the breaks go.
 */
export function renderDescription(html, card, { abbreviateCondition = false } = {}) {
  const unknown = new Set();
  const plain = isPlainTextTemplate(html);
  const source = plain ? escapeHtml(String(html || "")) : String(html || "");
  let body = source.replace(/\{([a-zA-Z]+)\}/g, (m, key) => {
    if (!FIELD_KEYS.has(key)) { unknown.add(key); return m; }
    return escapeHtml(fieldValue(card, key, { abbreviateCondition }));
  });
  if (plain) body = body.replace(/\r\n?/g, "\n").trim().replace(/\n/g, "<br>");
  return { html: `${body}\n<p>${escapeHtml(PHOTO_PROMISE)}</p>`, unknown: [...unknown] };
}

/**
 * A listing's pictures: the copy's own scans with the shop images around
 * them — "first" ones before, "second" ones straight after the first scan,
 * "last" ones after. Only enabled shop images, at most 24 in all, and the
 * copy's scans are never the ones dropped to make room.
 */
export function arrangePictures(scans, shopImages = []) {
  const own = (scans || []).filter(Boolean);
  const on = (shopImages || []).filter((i) => i && i.url && i.enabled !== false);
  const at = (pos) => on.filter((i) => (i.position || "last") === pos).map((i) => i.url);
  const ordered = [...at("first"), ...own.slice(0, 1), ...at("second"), ...own.slice(1), ...at("last")];
  const out = [];
  for (const u of ordered) if (!out.includes(u)) out.push(u);
  if (out.length <= MAX_PICTURES) return out;
  // Over the limit: drop shop images from the end until the scans fit.
  const keep = new Set(own);
  while (out.length > MAX_PICTURES) {
    const i = out.map((u) => keep.has(u)).lastIndexOf(false);
    if (i < 0) break;
    out.splice(i, 1);
  }
  return out.slice(0, MAX_PICTURES);
}

/**
 * Best Offer thresholds in pence for a price, or null when Best Offer is off.
 * Percentages of the asking price; a threshold left blank is not sent. The
 * accept threshold must sit above the decline one, or eBay refuses it.
 */
export function bestOfferFor(cfg, pricePence) {
  if (!cfg?.enabled) return null;
  const pct = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 && n < 100 ? n : null; };
  const a = pct(cfg.autoAcceptPct);
  const m = pct(cfg.minPct);
  const autoAcceptPence = a == null ? null : Math.floor((pricePence * a) / 100);
  const minPence = m == null ? null : Math.ceil((pricePence * m) / 100);
  if (autoAcceptPence != null && minPence != null && autoAcceptPence <= minPence) return { error: "Auto-accept has to be above auto-decline." };
  return { autoAcceptPence, minPence };
}

/** Problems with a whole settings object, by section; empty when it can be saved. */
export function settingsProblems(s) {
  const out = [];
  (s.descriptions || []).forEach((d, i) => { const p = descriptionProblem(d.html); if (p) out.push(`Description ${i + 1}: ${p}`); });
  const bo = bestOfferFor(s.bestOffer, 10000);
  if (bo?.error) out.push(`Best Offer: ${bo.error}`);
  if ((s.shopImages || []).length > MAX_SHOP_IMAGES) out.push(`At most ${MAX_SHOP_IMAGES} shop images.`);
  if (!(s.title?.parts || []).some((p) => p.type === "field" && p.key === "name")) out.push("The title has to include the card name.");
  return out;
}

/**
 * Everything a new listing is written with, from the settings and one group
 * of copies. The lab's preview and the server's listing call BOTH come
 * through here, so what you previewed is what went up.
 *
 * `group` is a lab group (card, condition, copies…); `subtype` optional.
 */
export function renderListing(settingsIn, group, { subtype = "", pricePence = null } = {}) {
  const s = withDefaults(settingsIn);
  const head = group?.copies?.[0] || null;
  const card = { ...(group?.card || {}), condition: group?.condition || "", sku: head?.sku || "", subtype: subtype || "" };
  if (!card.name) card.name = group?.cardName || "";
  if (!card.number) card.number = group?.cardNumber || "";
  if (!card.set) card.set = group?.set || "";
  if (!card.language) card.language = group?.language || "";
  const title = buildTitle(s.title, card);
  const active = s.descriptions[Math.min(Math.max(0, Number(s.activeDescription) || 0), s.descriptions.length - 1)];
  const desc = renderDescription(active?.html || "", card, { abbreviateCondition: false });
  const shop = (s.shopImages || []).filter((i) => i && i.url && i.enabled !== false).map((i) => ({ url: i.url, position: i.position || "last" }));
  return {
    title: title.text || String(group?.title || "").slice(0, TITLE_MAX),
    titleFull: title.full,
    titleCut: title.cut,
    descriptionHtml: desc.html,
    unknownPlaceholders: desc.unknown,
    extraImages: shop,
    pictures: arrangePictures(head?.scans || [], shop),
    bestOffer: pricePence != null ? bestOfferFor(s.bestOffer, pricePence) : null,
    categoryId: s.categoryId || DEFAULT_SETTINGS.categoryId,
    postcode: s.postcode || "",
    shippingCost: s.shippingCost,
    dispatchDays: s.dispatchDays,
    returnsDays: s.returnsDays
  };
}
