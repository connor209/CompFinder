/**
 * eBay variation listings — build the File Exchange CSV for a "mix & match"
 * multi-variation listing, straight from the catalogue.
 *
 * One listing = one PARENT row carrying the title, photo and the full list of
 * variation values, then one CHILD row per card carrying its own price,
 * quantity and photo. Column set and static values are taken from a real
 * `fx_category_template_EBAY_GB` export so an upload drops straight in.
 *
 * Pricing is per RARITY rather than per card — that's how these listings are
 * actually priced (commons at one price, rares at another).
 */

/** The 84 columns of the GB trading-card template, in order. */
export const EBAY_COLUMNS = [
  "*Action(SiteID=UK|Country=GB|Currency=GBP|Version=1193)",
  "Custom label (SKU)", "Category ID", "Category name", "Title",
  "Relationship", "Relationship details", "Schedule Time", "P:EPID",
  "Start price", "Quantity", "Item photo URL", "VideoID", "Condition ID",
  "CD:Professional Grader - (ID: 27501)", "CD:Grade - (ID: 27502)",
  "CDA:Certification Number - (ID: 27503)", "CD:Card Condition - (ID: 40001)",
  "Description", "Format", "Duration", "Buy It Now price", "Best Offer Enabled",
  "Best Offer Auto Accept Price", "Minimum Best Offer Price", "VAT%",
  "Immediate pay required", "Location",
  "Shipping service 1 option", "Shipping service 1 cost", "Shipping service 1 priority",
  "Shipping service 2 option", "Shipping service 2 cost", "Shipping service 2 priority",
  "Max dispatch time", "Returns accepted option", "Returns within option",
  "Refund option", "Return shipping cost paid by",
  "Shipping profile name", "Return profile name", "Payment profile name",
  "ProductCompliancePolicyID", "Regional ProductCompliancePolicies",
  "C:Franchise", "C:Autograph Authentication", "C:Manufacturer", "C:Set",
  "C:TV Show", "C:Character", "C:Year Manufactured", "C:Grade", "C:Features",
  "C:Parallel/Variety", "C:Featured Person/Artist", "C:Autographed", "C:Type",
  "C:Card Number", "C:Card Name",
  "Product Safety Pictograms", "Product Safety Statements", "Product Safety Component",
  "Regulatory Document Ids", "Manufacturer Name", "Manufacturer AddressLine1",
  "Manufacturer AddressLine2", "Manufacturer City", "Manufacturer Country",
  "Manufacturer PostalCode", "Manufacturer StateOrProvince", "Manufacturer Phone",
  "Manufacturer Email", "Manufacturer ContactURL",
  "Responsible Person 1", "Responsible Person 1 Type", "Responsible Person 1 AddressLine1",
  "Responsible Person 1 AddressLine2", "Responsible Person 1 City",
  "Responsible Person 1 Country", "Responsible Person 1 PostalCode",
  "Responsible Person 1 StateOrProvince", "Responsible Person 1 Phone",
  "Responsible Person 1 Email", "Responsible Person 1 ContactURL"
];

/** Static values lifted from the working export — all editable in the UI. */
export const EBAY_DEFAULTS = {
  categoryId: "183050",
  categoryName: "/Collectables/Non-Sport Trading Cards/Trading Card Singles",
  conditionId: "4000-Ungraded",
  format: "FixedPrice",
  duration: "GTC",
  location: "",
  shippingService: "UK_RoyalMailSecondClassStandard",
  shippingCost: "0",
  dispatchDays: "1",
  returnsAccepted: "ReturnsAccepted",
  returnsWithin: "Days_14",
  returnShippingPaidBy: "Seller",
  franchise: "",
  tvShow: "",
  cardCondition: "Near mint or better - (ID: 400010)",
  variationLabel: "Card#",
  title: "",
  description: "",
  parentImageUrl: "",
  imageTemplate: ""
};

export const CONDITION_IDS = [
  { id: "4000-Ungraded", label: "Ungraded" },
  { id: "2750-Graded", label: "Graded" },
  { id: "3000-Used", label: "Used" }
];

/** Zero-pad to a given width (001 from 1). */
const pad = (n, w) => String(n).padStart(w, "0");

/**
 * The text a buyer picks from the dropdown, e.g. `1/88 - Common - Spinarak`.
 * `setSize` is the printed set total — the denominator, which isn't always the
 * number of rows we hold for the set, so it's supplied rather than counted.
 */
export function variationValue(card, setSize) {
  const num = String(card.collector_number || "").replace(/^0+(?=\d)/, "") || "?";
  const left = setSize ? `${num}/${setSize}` : num;
  return [left, card.rarity || "", card.name || ""].filter(Boolean).join(" - ");
}

/**
 * Per-card image from a URL template. Tokens: {num} as printed, {num2}/{num3}
 * zero-padded, {setcode} / {setcode_lower}, {name}. Modelled on the real
 * pkmncards pattern, e.g.
 *   https://pkmncards.com/wp-content/uploads/{setcode_lower}_en_{num3}_std.jpg
 */
export function imageFromTemplate(template, card, setCode) {
  const t = String(template || "").trim();
  if (!t) return "";
  const raw = String(card.collector_number || "").replace(/^0+(?=\d)/, "");
  const digits = raw.replace(/\D/g, "") || raw;
  return t
    .replace(/\{num3\}/g, pad(digits, 3))
    .replace(/\{num2\}/g, pad(digits, 2))
    .replace(/\{num\}/g, raw)
    .replace(/\{setcode_lower\}/g, String(setCode || "").toLowerCase())
    .replace(/\{setcode\}/g, String(setCode || ""))
    .replace(/\{name\}/g, encodeURIComponent(card.name || ""));
}

function esc(v) {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const price2 = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n.toFixed(2) : "";
};

/**
 * Build the CSV.
 *   items    [{ card, qty }] — cards with stock, in listing order
 *   priceFor (card) => price, normally a rarity lookup
 *   cfg      EBAY_DEFAULTS shape, plus setName / setCode / setSize
 * Returns { csv, rows, values } — `values` is the variation list, handy for
 * showing what the buyer will see before committing.
 */
export function buildEbayVariationCsv(items, priceFor, cfg, createdMs) {
  const c = { ...EBAY_DEFAULTS, ...cfg };
  // Every card given becomes a variation, including any at zero stock — eBay
  // keeps those in the listing (greyed out) rather than dropping them, which
  // is what you want for a set that will be restocked.
  const live = (items || []).filter((it) => it.card);
  const values = live.map((it) => variationValue(it.card, c.setSize));

  const col = (o) => EBAY_COLUMNS.map((name) => esc(o[name] ?? "")).join(",");

  // Fields every row repeats.
  const common = {
    "*Action(SiteID=UK|Country=GB|Currency=GBP|Version=1193)": "Add",
    "Category ID": c.categoryId,
    "Category name": c.categoryName,
    Title: c.title,
    Relationship: "Variation",
    "Condition ID": c.conditionId,
    "CD:Card Condition - (ID: 40001)": c.cardCondition,
    Description: c.description,
    Format: c.format,
    Duration: c.duration,
    Location: c.location,
    "Shipping service 1 option": c.shippingService,
    "Shipping service 1 cost": c.shippingCost,
    "Max dispatch time": c.dispatchDays,
    "Returns accepted option": c.returnsAccepted,
    "Returns within option": c.returnsWithin,
    "Return shipping cost paid by": c.returnShippingPaidBy,
    "C:Franchise": c.franchise
  };

  const lines = [
    `#INFO,Created=${createdMs || 0},,,,, Indicates missing required fields,,,,, Indicates missing field that will be required soon`,
    "#INFO,Version=1.0,,Template=fx_category_template_EBAY_GB,,, Indicates missing recommended field,,,,, Indicates field does not apply to this item/category",
    "#INFO",
    EBAY_COLUMNS.join(",")
  ];

  // Parent: every variation value in one field, and the gallery photo.
  lines.push(col({
    ...common,
    "Relationship details": `${c.variationLabel}=${values.join(";")}`,
    "Item photo URL": c.parentImageUrl
  }));

  // Children: one per card, each with its own price, stock and photo.
  live.forEach((it, i) => {
    const img = imageFromTemplate(c.imageTemplate, it.card, c.setCode);
    lines.push(col({
      ...common,
      "Relationship details": `${c.variationLabel}=${values[i]}`,
      "Start price": price2(priceFor(it.card)),
      Quantity: String(it.qty || 0),
      "Item photo URL": img ? `${values[i]}=${img}` : "",
      // Item specifics live on the child rows only; Character is the card,
      // which is what eBay surfaces per variation.
      "C:Set": c.setName || "",
      "C:TV Show": c.tvShow || "",
      "C:Character": it.card.name || ""
    }));
  });

  return { csv: lines.join("\r\n") + "\r\n", rows: live.length + 1, values };
}
