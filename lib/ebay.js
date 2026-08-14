import { XMLParser } from "fast-xml-parser";

/**
 * eBay OAuth (user tokens) + read-only inventory pull.
 *
 * Phase 1: "Connect your eBay account" so CompFinder can list ALL of a
 * seller's active listings. The public Browse API can't do that (it needs a
 * keyword and only sees indexed listings), so we use the Trading API's
 * GetMyeBaySelling — the canonical "give me everything I have up" call —
 * authenticated with the user's own OAuth token (IAF token header).
 *
 * Env: EBAY_CLIENT_ID, EBAY_CLIENT_SECRET (Production keyset), EBAY_RU_NAME
 * (the Redirect URL *name* / RuName from the eBay developer portal — NOT the
 * literal callback URL).
 */
const OAUTH_AUTHORIZE = "https://auth.ebay.com/oauth2/authorize";
const OAUTH_TOKEN = "https://api.ebay.com/identity/v1/oauth2/token";
const IDENTITY_URL = "https://apiz.ebay.com/commerce/identity/v1/user/";
const TRADING_URL = "https://api.ebay.com/ws/api.dll";
const BROWSE_SEARCH = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const FULFILLMENT_ORDER = "https://api.ebay.com/sell/fulfillment/v1/order";
const ACCOUNT_BASE = "https://api.ebay.com/sell/account/v1";
const MARKETPLACE = "EBAY_GB";
const SITE_ID_UK = "3";
const COMPAT_LEVEL = "1249";

// Scopes: base + sell.inventory (GetMyeBaySelling, listing writes) +
// fulfillment.readonly (orders/sales) + identity (username) +
// sell.account.readonly (read the seller's business policies so listings can
// reference them). Adding a scope means existing users must reconnect once —
// callers that need account data surface a "reconnect" prompt on a scope error.
export const EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly"
];

function basicAuthHeader() {
  const basic = Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString("base64");
  return `Basic ${basic}`;
}

export function ebayConfigured() {
  return Boolean(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET && process.env.EBAY_RU_NAME);
}

// --- Application token (client-credentials) + public Browse search ---
// Used by features that read the public marketplace rather than a specific
// user's account (e.g. the arbitrage scanner). Cached across warm invocations.
let appToken = null;
let appTokenExp = 0;

export async function getAppAccessToken() {
  const now = Date.now();
  if (appToken && now < appTokenExp - 60_000) return appToken;
  const res = await fetch(OAUTH_TOKEN, {
    method: "POST",
    headers: { Authorization: basicAuthHeader(), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials&scope=" + encodeURIComponent("https://api.ebay.com/oauth/api_scope")
  });
  if (!res.ok) throw new Error(`eBay app auth failed (${res.status}). Check EBAY_CLIENT_ID / EBAY_CLIENT_SECRET.`);
  const json = await res.json();
  appToken = json.access_token;
  appTokenExp = now + (json.expires_in || 7200) * 1000;
  return appToken;
}

/**
 * Search the public marketplace for active listings. Defaults to newly-listed,
 * fixed-price items on eBay UK — the input the arbitrage scanner works from.
 */
export async function browseActiveListings({ q, limit = 20, sort = "newlyListed", marketplace = "EBAY_GB", extraFilter } = {}) {
  const token = await getAppAccessToken();
  const filter = ["buyingOptions:{FIXED_PRICE}"].concat(extraFilter ? [extraFilter] : []).join(",");
  const params = new URLSearchParams({
    q: q || "pokemon card",
    limit: String(Math.min(Math.max(limit, 1), 50)),
    sort,
    filter,
    fieldgroups: "EXTENDED"
  });
  const res = await fetch(`${BROWSE_SEARCH}?${params}`, {
    headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": marketplace }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`eBay browse failed (${res.status}). ${body.slice(0, 160)}`.trim());
  }
  const json = await res.json();
  return (json.itemSummaries || []).map((it) => ({
    itemId: it.itemId,
    title: it.title,
    url: it.itemWebUrl,
    image: it.image?.imageUrl || it.thumbnailImages?.[0]?.imageUrl || null,
    price: it.price ? Number(it.price.value) : null,
    currency: it.price?.currency || null,
    postage:
      Array.isArray(it.shippingOptions) && it.shippingOptions[0]?.shippingCost
        ? Number(it.shippingOptions[0].shippingCost.value)
        : null,
    seller: it.seller?.username || null,
    condition: it.condition || null
  }));
}

/** Build the consent URL we send the user to. `state` guards against CSRF. */
export function getAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.EBAY_CLIENT_ID,
    redirect_uri: process.env.EBAY_RU_NAME,
    response_type: "code",
    scope: EBAY_SCOPES.join(" "),
    state
  });
  return `${OAUTH_AUTHORIZE}?${params}`;
}

/** Exchange the ?code= from the callback for access + refresh tokens. */
export async function exchangeCodeForTokens(code) {
  const res = await fetch(OAUTH_TOKEN, {
    method: "POST",
    headers: { Authorization: basicAuthHeader(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.EBAY_RU_NAME
    })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`eBay token exchange failed (${res.status}): ${json.error_description || json.error || "unknown"}`);
  }
  return json; // { access_token, expires_in, refresh_token, refresh_token_expires_in }
}

/** Mint a fresh access token from a stored refresh token. */
export async function refreshAccessToken(refreshToken) {
  const res = await fetch(OAUTH_TOKEN, {
    method: "POST",
    headers: { Authorization: basicAuthHeader(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: EBAY_SCOPES.join(" ")
    })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`eBay token refresh failed (${res.status}): ${json.error_description || json.error || "unknown"}`);
  }
  return json; // { access_token, expires_in }
}

/**
 * Return a valid access token for a connected user, refreshing (and persisting
 * the refreshed token) if the stored one is expired or near expiry. Returns
 * null if the user hasn't connected an eBay account.
 */
export async function getValidUserAccessToken(admin, userId) {
  const { data: acct } = await admin.from("ebay_accounts").select("*").eq("user_id", userId).single();
  if (!acct || !acct.refresh_token) return null;

  const expMs = acct.access_expires_at ? new Date(acct.access_expires_at).getTime() : 0;
  if (acct.access_token && Date.now() < expMs - 60_000) {
    return acct.access_token;
  }

  const refreshed = await refreshAccessToken(acct.refresh_token);
  const access_expires_at = new Date(Date.now() + (refreshed.expires_in || 7200) * 1000).toISOString();
  await admin
    .from("ebay_accounts")
    .update({ access_token: refreshed.access_token, access_expires_at })
    .eq("user_id", userId);
  return refreshed.access_token;
}

/** Read the connected account's eBay username (Identity API). Best-effort. */
export async function fetchEbayUsername(accessToken) {
  try {
    const res = await fetch(IDENTITY_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return {};
    const json = await res.json();
    return { username: json.username || null, userId: json.userId || null };
  } catch {
    return {};
  }
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", trimValues: true });

function priceOf(node) {
  // CurrentPrice can be a bare number or { "#text": n, "@_currencyID": "GBP" }.
  if (node == null) return { value: null, currency: null };
  if (typeof node === "object") {
    return { value: node["#text"] != null ? Number(node["#text"]) : null, currency: node["@_currencyID"] || null };
  }
  return { value: Number(node), currency: null };
}

function numOrNull(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function strOrNull(v) {
  return v != null ? String(v) : null;
}

function normalizeItem(it) {
  const price = priceOf(it?.SellingStatus?.CurrentPrice);
  const qty = it?.QuantityAvailable != null ? Number(it.QuantityAvailable) : it?.Quantity != null ? Number(it.Quantity) : null;
  return {
    ebay_item_id: String(it?.ItemID ?? ""),
    title: it?.Title != null ? String(it.Title) : "",
    sku: it?.SKU != null ? String(it.SKU) : null,
    price_value: Number.isFinite(price.value) ? price.value : null,
    price_currency: price.currency,
    quantity: Number.isFinite(qty) ? qty : null,
    image_url: it?.PictureDetails?.GalleryURL != null ? String(it.PictureDetails.GalleryURL) : null,
    url: it?.ListingDetails?.ViewItemURL != null ? String(it.ListingDetails.ViewItemURL) : null,
    // Extra fields for the table / column picker (best-effort — some may be
    // absent depending on the listing). Stored in a JSONB column.
    extra: {
      format: strOrNull(it?.ListingType),
      condition: strOrNull(it?.ConditionDisplayName),
      quantitySold: numOrNull(it?.SellingStatus?.QuantitySold),
      watchCount: numOrNull(it?.WatchCount),
      startTime: strOrNull(it?.ListingDetails?.StartTime),
      timeLeft: strOrNull(it?.TimeLeft),
      category: strOrNull(it?.PrimaryCategory?.CategoryName)
    }
  };
}

async function getMyeBaySellingPage(accessToken, pageNumber) {
  const body =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">` +
    `<ActiveList><Include>true</Include>` +
    `<Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>${pageNumber}</PageNumber></Pagination>` +
    `</ActiveList></GetMyeBaySellingRequest>`;

  const res = await fetch(TRADING_URL, {
    method: "POST",
    headers: {
      "X-EBAY-API-CALL-NAME": "GetMyeBaySelling",
      "X-EBAY-API-SITEID": SITE_ID_UK,
      "X-EBAY-API-COMPATIBILITY-LEVEL": COMPAT_LEVEL,
      "X-EBAY-API-IAF-TOKEN": accessToken,
      "Content-Type": "text/xml"
    },
    body
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`eBay listing fetch failed (${res.status}).`);

  const doc = parser.parse(text);
  const resp = doc?.GetMyeBaySellingResponse || {};
  if (resp.Ack === "Failure") {
    const errs = resp.Errors;
    const msg = Array.isArray(errs) ? errs[0]?.LongMessage : errs?.LongMessage;
    throw new Error(msg || "eBay rejected the listing request.");
  }
  const active = resp.ActiveList || {};
  const itemArray = active.ItemArray?.Item;
  const items = itemArray == null ? [] : Array.isArray(itemArray) ? itemArray : [itemArray];
  const totalPages = Number(active.PaginationResult?.TotalNumberOfPages || 1) || 1;
  return { items: items.map(normalizeItem).filter((x) => x.ebay_item_id), totalPages };
}

/**
 * Pull ALL of the connected user's active listings (paginated). Capped at
 * MAX_PAGES so a huge account can't run away — the cap is surfaced by the
 * caller via the count.
 */
export async function fetchAllActiveListings(accessToken, { maxPages = 25 } = {}) {
  const first = await getMyeBaySellingPage(accessToken, 1);
  let all = first.items;
  const pages = Math.min(first.totalPages, maxPages);
  for (let p = 2; p <= pages; p++) {
    const next = await getMyeBaySellingPage(accessToken, p);
    all = all.concat(next.items);
  }
  return { listings: all, totalPages: first.totalPages, truncated: first.totalPages > maxPages };
}

/**
 * Revise the price of a single active fixed-price listing (Trading API
 * ReviseInventoryStatus — the lightweight price/quantity-only call). `price`
 * is a number in the listing currency's major units (e.g. pounds).
 */
export async function reviseItemPrice(accessToken, itemId, price, currency = "GBP") {
  const safeItem = String(itemId).replace(/[^0-9]/g, "");
  if (!safeItem) throw new Error("Invalid item id.");
  const amount = Number(price);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid price.");

  const body =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<ReviseInventoryStatusRequest xmlns="urn:ebay:apis:eBLBaseComponents">` +
    `<InventoryStatus><ItemID>${safeItem}</ItemID>` +
    `<StartPrice currencyID="${currency}">${amount.toFixed(2)}</StartPrice>` +
    `</InventoryStatus></ReviseInventoryStatusRequest>`;

  const res = await fetch(TRADING_URL, {
    method: "POST",
    headers: {
      "X-EBAY-API-CALL-NAME": "ReviseInventoryStatus",
      "X-EBAY-API-SITEID": SITE_ID_UK,
      "X-EBAY-API-COMPATIBILITY-LEVEL": COMPAT_LEVEL,
      "X-EBAY-API-IAF-TOKEN": accessToken,
      "Content-Type": "text/xml"
    },
    body
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`eBay price update failed (${res.status}).`);

  const doc = parser.parse(text);
  const resp = doc?.ReviseInventoryStatusResponse || {};
  if (resp.Ack !== "Success" && resp.Ack !== "Warning") {
    const errs = resp.Errors;
    const msg = Array.isArray(errs) ? errs[0]?.LongMessage : errs?.LongMessage;
    throw new Error(msg || "eBay rejected the price update.");
  }
  return { ok: true, ack: resp.Ack };
}

function escapeXml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Create a new fixed-price listing (Trading API AddFixedPriceItem). Uses inline
 * flat shipping + return policy (no business-policy IDs needed) so a seller can
 * list without extra setup. BETA — many category/condition specifics are eBay-
 * validated, so errors are surfaced for the caller to correct.
 */
/**
 * Read the seller's eBay Business Policies (shipping/fulfillment, payment,
 * return) for the UK marketplace, so listings can reference them by ID instead
 * of inline shipping. Needs the sell.account.readonly scope — throws with
 * `.scope = true` if the stored token predates it (caller shows a reconnect
 * prompt). Returns { fulfillment:[{id,name}], payment:[...], return:[...] }.
 */
export async function fetchBusinessPolicies(accessToken) {
  async function get(kind, key, idField) {
    const res = await fetch(`${ACCOUNT_BASE}/${kind}?marketplace_id=${MARKETPLACE}`, {
      headers: { Authorization: `Bearer ${accessToken}`, "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE, Accept: "application/json" }
    });
    if (res.status === 403 || res.status === 401) {
      const e = new Error("eBay account scope missing — reconnect required.");
      e.scope = true;
      throw e;
    }
    if (!res.ok) return [];
    const json = await res.json().catch(() => ({}));
    return (json[key] || []).map((p) => ({ id: p[idField], name: p.name || p[idField] }));
  }
  const [fulfillment, payment, ret] = await Promise.all([
    get("fulfillment_policy", "fulfillmentPolicies", "fulfillmentPolicyId"),
    get("payment_policy", "paymentPolicies", "paymentPolicyId"),
    get("return_policy", "returnPolicies", "returnPolicyId")
  ]);
  return { fulfillment, payment, return: ret };
}

export async function addFixedPriceListing(accessToken, L) {
  const specifics = (L.specifics || [])
    .filter((s) => s.value)
    .map((s) => `<NameValueList><Name>${escapeXml(s.name)}</Name><Value>${escapeXml(s.value)}</Value></NameValueList>`)
    .join("");
  const pics = (L.imageUrls || []).filter(Boolean).map((u) => `<PictureURL>${escapeXml(u)}</PictureURL>`).join("");

  // If the seller linked their eBay Business Policies, reference them by ID and
  // let eBay apply the shipping/return/payment terms. Otherwise fall back to
  // inline flat postage + a simple return policy (works without policies opt-in).
  const P = L.policies || {};
  const useProfiles = !!P.fulfillmentPolicyId;
  const sellerProfiles = useProfiles
    ? `<SellerProfiles>` +
      `<SellerShippingProfile><ShippingProfileID>${escapeXml(P.fulfillmentPolicyId)}</ShippingProfileID></SellerShippingProfile>` +
      (P.returnPolicyId ? `<SellerReturnProfile><ReturnProfileID>${escapeXml(P.returnPolicyId)}</ReturnProfileID></SellerReturnProfile>` : "") +
      (P.paymentPolicyId ? `<SellerPaymentProfile><PaymentProfileID>${escapeXml(P.paymentPolicyId)}</PaymentProfileID></SellerPaymentProfile>` : "") +
      `</SellerProfiles>`
    : "";
  const inlineFulfilment = useProfiles
    ? ""
    : `<ShippingDetails><ShippingType>Flat</ShippingType><ShippingServiceOptions>` +
      `<ShippingServicePriority>1</ShippingServicePriority>` +
      `<ShippingService>${escapeXml(L.shippingService || "UK_RoyalMailSecondClassStandard")}</ShippingService>` +
      `<ShippingServiceCost>${Number(L.shippingCost || 0).toFixed(2)}</ShippingServiceCost>` +
      `</ShippingServiceOptions></ShippingDetails>` +
      `<DispatchTimeMax>${parseInt(L.dispatchDays, 10) || 3}</DispatchTimeMax>` +
      `<ReturnPolicy><ReturnsAcceptedOption>${L.returnsDays ? "ReturnsAccepted" : "ReturnsNotAccepted"}</ReturnsAcceptedOption>` +
      (L.returnsDays ? `<ReturnsWithinOption>Days_${parseInt(L.returnsDays, 10)}</ReturnsWithinOption><ShippingCostPaidByOption>Buyer</ShippingCostPaidByOption>` : "") +
      `</ReturnPolicy>`;

  const body =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<AddFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><Item>` +
    `<Title>${escapeXml(L.title).slice(0, 80)}</Title>` +
    `<Description><![CDATA[${L.description || L.title || ""}]]></Description>` +
    `<PrimaryCategory><CategoryID>${escapeXml(L.categoryId)}</CategoryID></PrimaryCategory>` +
    `<StartPrice>${Number(L.price).toFixed(2)}</StartPrice>` +
    `<Quantity>${Math.max(1, parseInt(L.quantity, 10) || 1)}</Quantity>` +
    `<ListingDuration>GTC</ListingDuration><ListingType>FixedPriceItem</ListingType>` +
    `<Currency>GBP</Currency><Country>GB</Country>` +
    `<Location>${escapeXml(L.location || L.postcode || "United Kingdom")}</Location>` +
    (L.postcode ? `<PostalCode>${escapeXml(L.postcode)}</PostalCode>` : "") +
    (L.conditionId ? `<ConditionID>${escapeXml(L.conditionId)}</ConditionID>` : "") +
    (pics ? `<PictureDetails>${pics}</PictureDetails>` : "") +
    (specifics ? `<ItemSpecifics>${specifics}</ItemSpecifics>` : "") +
    sellerProfiles +
    inlineFulfilment +
    `</Item></AddFixedPriceItemRequest>`;

  const res = await fetch(TRADING_URL, {
    method: "POST",
    headers: {
      "X-EBAY-API-CALL-NAME": "AddFixedPriceItem",
      "X-EBAY-API-SITEID": SITE_ID_UK,
      "X-EBAY-API-COMPATIBILITY-LEVEL": COMPAT_LEVEL,
      "X-EBAY-API-IAF-TOKEN": accessToken,
      "Content-Type": "text/xml"
    },
    body
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`eBay list failed (${res.status}).`);

  const doc = parser.parse(text);
  const resp = doc?.AddFixedPriceItemResponse || {};
  if (resp.Ack !== "Success" && resp.Ack !== "Warning") {
    const errs = resp.Errors;
    const arr = Array.isArray(errs) ? errs : errs ? [errs] : [];
    const msg = arr.map((e) => e.LongMessage).filter(Boolean).join(" ");
    throw new Error(msg || "eBay rejected the listing.");
  }
  const errs = resp.Errors;
  const arr = Array.isArray(errs) ? errs : errs ? [errs] : [];
  const warnings = arr.map((e) => e.LongMessage).filter(Boolean);
  return { ok: true, itemId: resp.ItemID != null ? String(resp.ItemID) : null, warnings };
}

/**
 * End (delist) a single active fixed-price listing on eBay (Trading API
 * EndFixedPriceItem). EndingReason defaults to "NotAvailable".
 */
export async function endListing(accessToken, itemId, reason = "NotAvailable") {
  const safeItem = String(itemId).replace(/[^0-9]/g, "");
  if (!safeItem) throw new Error("Invalid item id.");

  const body =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<EndFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">` +
    `<ItemID>${safeItem}</ItemID><EndingReason>${reason}</EndingReason>` +
    `</EndFixedPriceItemRequest>`;

  const res = await fetch(TRADING_URL, {
    method: "POST",
    headers: {
      "X-EBAY-API-CALL-NAME": "EndFixedPriceItem",
      "X-EBAY-API-SITEID": SITE_ID_UK,
      "X-EBAY-API-COMPATIBILITY-LEVEL": COMPAT_LEVEL,
      "X-EBAY-API-IAF-TOKEN": accessToken,
      "Content-Type": "text/xml"
    },
    body
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`eBay end-listing failed (${res.status}).`);

  const doc = parser.parse(text);
  const resp = doc?.EndFixedPriceItemResponse || {};
  if (resp.Ack !== "Success" && resp.Ack !== "Warning") {
    const errs = resp.Errors;
    const msg = Array.isArray(errs) ? errs[0]?.LongMessage : errs?.LongMessage;
    throw new Error(msg || "eBay rejected the end-listing request.");
  }
  return { ok: true, ack: resp.Ack };
}

/**
 * Relist a previously-ended fixed-price listing (Trading API
 * RelistFixedPriceItem). Returns the NEW item id eBay assigns.
 */
export async function relistListing(accessToken, itemId) {
  const safeItem = String(itemId).replace(/[^0-9]/g, "");
  if (!safeItem) throw new Error("Invalid item id.");

  const body =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<RelistFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">` +
    `<Item><ItemID>${safeItem}</ItemID></Item>` +
    `</RelistFixedPriceItemRequest>`;

  const res = await fetch(TRADING_URL, {
    method: "POST",
    headers: {
      "X-EBAY-API-CALL-NAME": "RelistFixedPriceItem",
      "X-EBAY-API-SITEID": SITE_ID_UK,
      "X-EBAY-API-COMPATIBILITY-LEVEL": COMPAT_LEVEL,
      "X-EBAY-API-IAF-TOKEN": accessToken,
      "Content-Type": "text/xml"
    },
    body
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`eBay relist failed (${res.status}).`);

  const doc = parser.parse(text);
  const resp = doc?.RelistFixedPriceItemResponse || {};
  if (resp.Ack !== "Success" && resp.Ack !== "Warning") {
    const errs = resp.Errors;
    const msg = Array.isArray(errs) ? errs[0]?.LongMessage : errs?.LongMessage;
    throw new Error(msg || "eBay rejected the relist request.");
  }
  return { ok: true, newItemId: resp.ItemID != null ? String(resp.ItemID) : null };
}

/**
 * Fetch recent orders (completed sales) via the Fulfillment API. Requires the
 * sell.fulfillment.readonly scope — throws a scope error the caller can turn
 * into a "reconnect" prompt if the stored token predates that scope.
 */
export async function fetchRecentOrders(accessToken, daysBack = 90) {
  const since = new Date(Date.now() - daysBack * 86_400_000).toISOString();
  const params = new URLSearchParams({ filter: `creationdate:[${since}..]`, limit: "200" });
  const res = await fetch(`${FULFILLMENT_ORDER}?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}`, "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE, Accept: "application/json" }
  });
  if (res.status === 403) {
    const e = new Error("eBay sales access not granted — reconnect your account to enable sales tracking.");
    e.scope = true;
    throw e;
  }
  if (!res.ok) throw new Error(`eBay orders fetch failed (${res.status}).`);
  const json = await res.json();

  const lines = [];
  for (const order of json.orders || []) {
    const soldDate = order.creationDate || null;
    for (const li of order.lineItems || []) {
      const unit = li.lineItemCost ? Number(li.lineItemCost.value) : null;
      const qty = li.quantity != null ? Number(li.quantity) : 1;
      lines.push({
        order_id: String(order.orderId || ""),
        line_item_id: String(li.lineItemId || `${order.orderId}-${li.legacyItemId || ""}`),
        ebay_item_id: li.legacyItemId != null ? String(li.legacyItemId) : null,
        sku: li.sku != null ? String(li.sku) : null,
        title: li.title != null ? String(li.title) : "",
        quantity: Number.isFinite(qty) ? qty : 1,
        sold_pence: Number.isFinite(unit) ? Math.round(unit * 100 * (qty || 1)) : null,
        currency: li.lineItemCost?.currency || "GBP",
        sold_date: soldDate
      });
    }
  }
  return lines;
}

/**
 * Fetch orders that still need picking/shipping (not yet fulfilled). Returns
 * one row per line item. Requires the fulfillment scope.
 */
export async function fetchPendingOrders(accessToken) {
  const params = new URLSearchParams({ filter: "orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}", limit: "200" });
  const res = await fetch(`${FULFILLMENT_ORDER}?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}`, "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE, Accept: "application/json" }
  });
  if (res.status === 403) {
    const e = new Error("eBay sales access not granted — reconnect your account.");
    e.scope = true;
    throw e;
  }
  if (!res.ok) throw new Error(`eBay orders fetch failed (${res.status}).`);
  const json = await res.json();

  const lines = [];
  for (const order of json.orders || []) {
    // Delivery (ship-to) name + city — the human name on the shipping label,
    // which often differs from the eBay username. Used to label order piles so
    // a physical pile is easy to attach to its order.
    const shipTo = order.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
    const deliveryName = shipTo?.fullName || null;
    const deliveryCity = shipTo?.contactAddress?.city || null;
    for (const li of order.lineItems || []) {
      // Variation listings (e.g. "pick your single") carry the chosen card in
      // variationAspects rather than a per-card SKU — join it into a readable
      // string so the pull sheet can identify and sort these loose picks.
      const variation = Array.isArray(li.variationAspects) && li.variationAspects.length
        ? li.variationAspects.map((a) => (a?.value != null ? String(a.value) : "")).filter(Boolean).join(" ")
        : null;
      lines.push({
        orderId: String(order.orderId || ""),
        lineItemId: String(li.lineItemId || ""),
        sku: li.sku != null ? String(li.sku) : null,
        title: li.title != null ? String(li.title) : "",
        variation,
        quantity: li.quantity != null ? Number(li.quantity) : 1,
        buyer: order.buyer?.username || null,
        deliveryName,
        deliveryCity,
        orderDate: order.creationDate || null
      });
    }
  }
  return lines;
}

/**
 * Sync recent sales into the ebay_sales cache. Returns { connected, count } or
 * { scopeError:true } if the token lacks the fulfillment scope.
 */
export async function syncUserSales(admin, userId, daysBack = 90) {
  const token = await getValidUserAccessToken(admin, userId);
  if (!token) return { connected: false, count: 0 };
  let lines;
  try {
    lines = await fetchRecentOrders(token, daysBack);
  } catch (e) {
    if (e.scope) return { connected: true, scopeError: true, count: 0 };
    throw e;
  }
  if (lines.length) {
    const rows = lines.map((l) => ({ ...l, user_id: userId }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin.from("ebay_sales").upsert(rows.slice(i, i + 500), { onConflict: "user_id,line_item_id" });
      if (error) throw new Error(error.message);
    }
  }
  return { connected: true, count: lines.length };
}

/**
 * Refresh the cached ebay_listings for a connected user. Requires a
 * service-role `admin` client. Returns { connected, count, truncated }.
 * Replaces the user's cached rows wholesale — syncs are infrequent (on
 * connect + manual refresh) and rows are cheap, so this stays simple.
 */
export async function syncUserListings(admin, userId) {
  const token = await getValidUserAccessToken(admin, userId);
  if (!token) return { connected: false, count: 0 };

  const { listings, truncated } = await fetchAllActiveListings(token);
  const nowIso = new Date().toISOString();

  await admin.from("ebay_listings").delete().eq("user_id", userId);
  if (listings.length) {
    const rows = listings.map((l) => ({ ...l, user_id: userId, synced_at: nowIso }));
    // Insert with the extra JSONB; if that column doesn't exist yet (migration
    // 004 not run), retry without it so sync still works.
    let dropExtra = false;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const payload = dropExtra ? chunk.map(({ extra, ...r }) => r) : chunk;
      let { error } = await admin.from("ebay_listings").insert(payload);
      if (error && !dropExtra && /extra/.test(error.message || "")) {
        dropExtra = true;
        ({ error } = await admin.from("ebay_listings").insert(chunk.map(({ extra, ...r }) => r)));
      }
      if (error) throw new Error(error.message);
    }
  }
  await admin.from("ebay_accounts").update({ last_synced_at: nowIso }).eq("user_id", userId);
  return { connected: true, count: listings.length, truncated };
}
