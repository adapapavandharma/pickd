/* ============================================================
   Amazon Product Advertising API 5.0 — GetItems
   This is the ToS-correct way to pull images, titles and prices.
   Requires an approved Associates account with API access.

   Set these env vars (or put them in .env):
     AMZ_ACCESS_KEY, AMZ_SECRET_KEY, AMZ_PARTNER_TAG, AMZ_MARKETPLACE
   ============================================================ */

import crypto from "node:crypto";

/* marketplace -> { host, region } */
export const MARKETPLACES = {
  "www.amazon.com":     { host: "webservices.amazon.com",     region: "us-east-1" },
  "www.amazon.co.uk":   { host: "webservices.amazon.co.uk",   region: "eu-west-1" },
  "www.amazon.de":      { host: "webservices.amazon.de",      region: "eu-west-1" },
  "www.amazon.fr":      { host: "webservices.amazon.fr",      region: "eu-west-1" },
  "www.amazon.it":      { host: "webservices.amazon.it",      region: "eu-west-1" },
  "www.amazon.es":      { host: "webservices.amazon.es",      region: "eu-west-1" },
  "www.amazon.in":      { host: "webservices.amazon.in",      region: "eu-west-1" },
  "www.amazon.ca":      { host: "webservices.amazon.ca",      region: "us-east-1" },
  "www.amazon.com.mx":  { host: "webservices.amazon.com.mx",  region: "us-east-1" },
  "www.amazon.com.br":  { host: "webservices.amazon.com.br",  region: "us-east-1" },
  "www.amazon.co.jp":   { host: "webservices.amazon.co.jp",   region: "us-west-2" },
  "www.amazon.com.au":  { host: "webservices.amazon.com.au",  region: "us-west-2" },
};

const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const hmac = (key, s) => crypto.createHmac("sha256", key).update(s, "utf8").digest();

export function hasCredentials() {
  return Boolean(process.env.AMZ_ACCESS_KEY && process.env.AMZ_SECRET_KEY && process.env.AMZ_PARTNER_TAG);
}

/**
 * Fetch up to 10 ASINs from PA-API. Returns a Map of asin -> normalised item.
 */
export async function getItems(asins, marketplace = process.env.AMZ_MARKETPLACE || "www.amazon.com") {
  if (!hasCredentials()) throw new Error("PA-API credentials not set");
  if (!asins.length) return new Map();

  const mp = MARKETPLACES[marketplace];
  if (!mp) throw new Error(`Unknown marketplace: ${marketplace}`);

  const path = "/paapi5/getitems";
  const target = "com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems";

  const body = JSON.stringify({
    ItemIds: asins.slice(0, 10),
    ItemIdType: "ASIN",
    PartnerTag: process.env.AMZ_PARTNER_TAG,
    PartnerType: "Associates",
    Marketplace: marketplace,
    Resources: [
      "Images.Primary.Large",
      "Images.Variants.Large",
      "ItemInfo.Title",
      "ItemInfo.ByLineInfo",
      "ItemInfo.Features",
      "ItemInfo.ProductInfo",
      "Offers.Listings.Price",
      "Offers.Listings.SavingBasis",
      "BrowseNodeInfo.BrowseNodes",
    ],
  });

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const headers = {
    "content-encoding": "amz-1.0",
    "content-type": "application/json; charset=utf-8",
    host: mp.host,
    "x-amz-date": amzDate,
    "x-amz-target": target,
  };
  const signedHeaders = "content-encoding;host;x-amz-date;x-amz-target";
  const canonicalHeaders =
    `content-encoding:${headers["content-encoding"]}\n` +
    `host:${headers.host}\n` +
    `x-amz-date:${headers["x-amz-date"]}\n` +
    `x-amz-target:${headers["x-amz-target"]}\n`;

  const canonicalRequest = ["POST", path, "", canonicalHeaders, signedHeaders, sha256(body)].join("\n");
  const scope = `${dateStamp}/${mp.region}/ProductAdvertisingAPI/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");

  let k = hmac(`AWS4${process.env.AMZ_SECRET_KEY}`, dateStamp);
  k = hmac(k, mp.region);
  k = hmac(k, "ProductAdvertisingAPI");
  k = hmac(k, "aws4_request");
  const signature = crypto.createHmac("sha256", k).update(stringToSign, "utf8").digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${process.env.AMZ_ACCESS_KEY}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(`https://${mp.host}${path}`, {
    method: "POST",
    headers: { ...headers, Authorization: authorization },
    body,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.Errors?.map((e) => e.Message).join("; ") || `HTTP ${res.status}`;
    throw new Error(`PA-API: ${msg}`);
  }

  const out = new Map();
  for (const item of json.ItemsResult?.Items || []) {
    const listing = item.Offers?.Listings?.[0];
    out.set(item.ASIN, {
      asin: item.ASIN,
      title: item.ItemInfo?.Title?.DisplayValue,
      brand: item.ItemInfo?.ByLineInfo?.Brand?.DisplayValue,
      features: item.ItemInfo?.Features?.DisplayValues,
      image: item.Images?.Primary?.Large?.URL,
      gallery: (item.Images?.Variants || []).map((v) => v.Large?.URL).filter(Boolean),
      price: listing?.Price?.Amount,
      currency: listing?.Price?.Currency,
      listPrice: listing?.SavingBasis?.Amount,
      category: item.BrowseNodeInfo?.BrowseNodes?.[0]?.ContextFreeName,
      url: item.DetailPageURL,
      source: "paapi",
    });
  }
  return out;
}
