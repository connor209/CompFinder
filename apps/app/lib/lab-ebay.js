/**
 * The one eBay call the lab needed that ebay.js does not have: creating an
 * ungraded trading-card listing WITH its condition descriptor (ConditionID
 * 4000, descriptor 40001). `addFixedPriceListing()` sends a bare ConditionID,
 * and changing it would change every listing the app already makes — which
 * is the thing this side build promised not to do. Everything else (revise,
 * end, read orders, read quantity) is imported from ebay.js unchanged.
 *
 * No Custom Label is sent, deliberately: an unlabelled listing is skipped by
 * the nightly stack import, so the lab's listings never become stack cards.
 */
import { XMLParser } from "fast-xml-parser";
import { CONDITION_DESCRIPTOR, PHOTO_PROMISE } from "./lab-copies.js";

const TRADING_URL = "https://api.ebay.com/ws/api.dll";
const SITE_ID_UK = "3";
const COMPAT_LEVEL = "1249";
const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false });

const x = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

function errorsOf(resp) {
  const errs = resp?.Errors;
  const arr = Array.isArray(errs) ? errs : errs ? [errs] : [];
  return arr.map((e) => e?.LongMessage).filter(Boolean);
}

/**
 * Create one lab listing. `L`: { title, pricePence, quantity, condition,
 * cardName, cardNumber, set, language, scanUrls, categoryId, policies,
 * postcode, shippingService, shippingCost, dispatchDays, returnsDays }.
 */
export async function addLabListing(accessToken, L) {
  const descriptor = CONDITION_DESCRIPTOR[L.condition];
  if (!descriptor) throw new Error(`Condition ${L.condition} can't be listed as an ungraded card.`);
  const qty = Number(L.quantity);
  if (!Number.isInteger(qty) || qty < 1) throw new Error("Quantity must be at least 1.");
  const pics = (L.scanUrls || []).filter(Boolean);
  if (!pics.length) throw new Error("No scans to show.");

  const specifics = [
    ["Game", "Pokémon TCG"],
    ["Card Name", L.cardName],
    ["Character", L.cardName],
    ["Set", L.set],
    ["Card Number", L.cardNumber],
    ["Language", L.language || "English"]
  ].filter(([, v]) => String(v || "").trim())
    .map(([n, v]) => `<NameValueList><Name>${x(n)}</Name><Value>${x(v)}</Value></NameValueList>`).join("");

  const P = L.policies || {};
  const fulfilment = P.fulfillmentPolicyId
    ? `<SellerProfiles>` +
      `<SellerShippingProfile><ShippingProfileID>${x(P.fulfillmentPolicyId)}</ShippingProfileID></SellerShippingProfile>` +
      (P.returnPolicyId ? `<SellerReturnProfile><ReturnProfileID>${x(P.returnPolicyId)}</ReturnProfileID></SellerReturnProfile>` : "") +
      (P.paymentPolicyId ? `<SellerPaymentProfile><PaymentProfileID>${x(P.paymentPolicyId)}</PaymentProfileID></SellerPaymentProfile>` : "") +
      `</SellerProfiles>`
    : `<ShippingDetails><ShippingType>Flat</ShippingType><ShippingServiceOptions>` +
      `<ShippingServicePriority>1</ShippingServicePriority>` +
      `<ShippingService>${x(L.shippingService || "UK_RoyalMailSecondClassStandard")}</ShippingService>` +
      `<ShippingServiceCost>${Number(L.shippingCost || 0).toFixed(2)}</ShippingServiceCost>` +
      `</ShippingServiceOptions></ShippingDetails>` +
      `<DispatchTimeMax>${parseInt(L.dispatchDays, 10) || 2}</DispatchTimeMax>` +
      `<ReturnPolicy><ReturnsAcceptedOption>${L.returnsDays ? "ReturnsAccepted" : "ReturnsNotAccepted"}</ReturnsAcceptedOption>` +
      (L.returnsDays ? `<ReturnsWithinOption>Days_${parseInt(L.returnsDays, 10)}</ReturnsWithinOption><ShippingCostPaidByOption>Buyer</ShippingCostPaidByOption>` : "") +
      `</ReturnPolicy>`;

  const description = `<p>${x(L.title)}</p><p>${x(PHOTO_PROMISE)}</p>`;

  const body =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<AddFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><Item>` +
    `<Title>${x(String(L.title).slice(0, 80))}</Title>` +
    `<Description><![CDATA[${description}]]></Description>` +
    `<PrimaryCategory><CategoryID>${x(L.categoryId || "183454")}</CategoryID></PrimaryCategory>` +
    `<StartPrice>${(Number(L.pricePence) / 100).toFixed(2)}</StartPrice>` +
    `<Quantity>${qty}</Quantity>` +
    `<ListingDuration>GTC</ListingDuration><ListingType>FixedPriceItem</ListingType>` +
    `<Currency>GBP</Currency><Country>GB</Country>` +
    `<Location>${x(L.postcode || "United Kingdom")}</Location>` +
    (L.postcode ? `<PostalCode>${x(L.postcode)}</PostalCode>` : "") +
    `<ConditionID>4000</ConditionID>` +
    `<ConditionDescriptors><ConditionDescriptor><Name>40001</Name><Value>${descriptor}</Value></ConditionDescriptor></ConditionDescriptors>` +
    `<PictureDetails>${pics.map((u) => `<PictureURL>${x(u)}</PictureURL>`).join("")}</PictureDetails>` +
    `<ItemSpecifics>${specifics}</ItemSpecifics>` +
    fulfilment +
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
  const resp = parser.parse(text)?.AddFixedPriceItemResponse || {};
  if (resp.Ack !== "Success" && resp.Ack !== "Warning") {
    throw new Error(errorsOf(resp).join(" ") || "eBay rejected the listing.");
  }
  return { itemId: resp.ItemID != null ? String(resp.ItemID) : null, warnings: errorsOf(resp) };
}

/**
 * Does a scan URL still load as a picture? Asked before a listing is made or
 * moved on to a copy, because the scans live on CardUploader's CDN and the
 * day one stops loading is the day a revision would leave a listing with no
 * photo. A failure here holds the listing on what it shows now.
 */
export async function scanLoads(url) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(url, { method: "GET", headers: { Range: "bytes=0-1023" }, signal: ctl.signal });
    clearTimeout(t);
    const type = String(res.headers.get("content-type") || "");
    return (res.ok || res.status === 206) && type.startsWith("image/");
  } catch {
    return false;
  }
}
