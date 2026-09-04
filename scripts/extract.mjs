#!/usr/bin/env node
/* ============================================================
   Pickd — link -> product extractor

   Usage:
     node scripts/extract.mjs                       # read data/links.txt
     node scripts/extract.mjs <url> [<url> ...]     # ad-hoc
     node scripts/extract.mjs --tag yourtag-20 <url>

   What it does
   ------------
   1. Parses each link. Amazon links are reduced to their ASIN and
      rebuilt as a clean /dp/<ASIN>?tag=<yourtag> affiliate URL.
   2. Resolves the product image through a fallback chain:
        a) PA-API 5.0            (if AMZ_* credentials are set — the ToS-correct path)
        b) Amazon image CDN      (by ASIN, the endpoint SiteStripe embeds use)
        c) OpenGraph <meta>      (works well for non-Amazon merchants)
   3. Downloads the image into assets/img/ so the site never hotlinks.
   4. Merges into data/products.json WITHOUT clobbering fields you edited
      by hand (blurb, badge, drawback, category, order are preserved).
   ============================================================ */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getItems, hasCredentials } from "./paapi.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data", "products.json");
const LINKS = path.join(ROOT, "data", "links.txt");
const IMGDIR = path.join(ROOT, "assets", "img");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/* ---------- tiny logger ---------- */
const c = { dim: "\x1b[2m", red: "\x1b[31m", grn: "\x1b[32m", yel: "\x1b[33m", cyn: "\x1b[36m", off: "\x1b[0m" };
const log  = (...a) => console.log(...a);
const ok   = (m) => log(`${c.grn}  ok${c.off}   ${m}`);
const warn = (m) => log(`${c.yel}  warn${c.off} ${m}`);
const fail = (m) => log(`${c.red}  fail${c.off} ${m}`);
const step = (m) => log(`${c.cyn}\n> ${m}${c.off}`);

/* ---------- args ---------- */
const argv = process.argv.slice(2);
let TAG = process.env.AMZ_PARTNER_TAG || "";
const urls = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--tag") { TAG = argv[++i]; continue; }
  urls.push(argv[i]);
}

/* ---------- amazon helpers ---------- */
const ASIN_RE = /(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/|\/product\/|[?&]asin=)([A-Z0-9]{10})/i;

function parseLink(raw) {
  const input = raw.trim();
  if (!input || input.startsWith("#")) return null;

  // bare ASIN
  if (/^[A-Z0-9]{10}$/i.test(input)) {
    return { kind: "amazon", asin: input.toUpperCase(), marketplace: "www.amazon.com" };
  }

  let u;
  try { u = new URL(input.startsWith("http") ? input : `https://${input}`); }
  catch { return null; }

  const host = u.hostname.replace(/^m\./, "www.");
  if (/amazon\./i.test(host) || /amzn\.to/i.test(host)) {
    const m = u.pathname.match(ASIN_RE) || input.match(ASIN_RE);
    if (m) return { kind: "amazon", asin: m[1].toUpperCase(), marketplace: host };
    return { kind: "amazon-short", url: u.toString() }; // amzn.to shortlink — needs a redirect follow
  }
  return { kind: "generic", url: u.toString() };
}

function affiliateURL(asin, marketplace = "www.amazon.com") {
  const base = `https://${marketplace}/dp/${asin}`;
  return TAG ? `${base}?tag=${encodeURIComponent(TAG)}` : base;
}

/* Amazon's per-ASIN image endpoint. Returns a ~43 byte GIF when there is no image. */
function cdnCandidates(asin) {
  return [
    `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SCLZZZZZZZ_.jpg`,
    `https://images-na.ssl-images-amazon.com/images/P/${asin}.01.LZZZZZZZ.jpg`,
    `https://m.media-amazon.com/images/P/${asin}.01._SCLZZZZZZZ_.jpg`,
  ];
}

/* ---------- network ---------- */
async function fetchBuffer(url, timeout = 15000) {
  const ctl = AbortSignal.timeout(timeout);
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "image/*,*/*" }, signal: ctl });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/* Amazon serves a tiny transparent GIF for "no image". Reject those. */
function isRealImage(buf) {
  if (!buf || buf.length < 2500) return false;
  const isGif = buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46;
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50;
  const isWebp = buf.slice(0, 4).toString() === "RIFF";
  if (isGif) return false;
  return isJpg || isPng || isWebp;
}

function extOf(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return "jpg";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "png";
  if (buf.slice(0, 4).toString() === "RIFF") return "webp";
  return "jpg";
}

async function saveImage(buf, id) {
  await fs.mkdir(IMGDIR, { recursive: true });
  const file = `${id}.${extOf(buf)}`;
  await fs.writeFile(path.join(IMGDIR, file), buf);
  return `assets/img/${file}`;
}

/* ---------- OpenGraph scrape (non-Amazon merchants) ---------- */
async function scrapeOG(url) {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml", "accept-language": "en-US,en;q=0.9" },
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  if (/captcha|Enter the characters you see below|Robot Check/i.test(html.slice(0, 4000))) {
    throw new Error("bot-check page returned instead of the product");
  }

  const meta = (prop) => {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']|` +
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, "i");
    const m = html.match(re);
    return m ? (m[1] || m[2]) : null;
  };

  const title =
    meta("og:title") || meta("twitter:title") ||
    html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || null;

  const priceRaw = meta("product:price:amount") || meta("og:price:amount");

  return {
    title: title ? title.replace(/\s+/g, " ").trim() : null,
    description: meta("og:description") || meta("description"),
    image: meta("og:image:secure_url") || meta("og:image") || meta("twitter:image"),
    price: priceRaw ? Number(priceRaw) : null,
    currency: meta("product:price:currency") || meta("og:price:currency") || "USD",
    brand: meta("og:site_name"),
    finalURL: res.url,
    source: "opengraph",
  };
}

/* ---------- image resolution chain ---------- */
async function resolveImage(link, paapiItem, ogData) {
  // a) PA-API
  if (paapiItem?.image) {
    try {
      const buf = await fetchBuffer(paapiItem.image);
      if (isRealImage(buf)) return { local: await saveImage(buf, link.asin), via: "PA-API" };
    } catch { /* fall through */ }
  }
  // b) Amazon per-ASIN CDN
  if (link.asin) {
    for (const url of cdnCandidates(link.asin)) {
      try {
        const buf = await fetchBuffer(url);
        if (isRealImage(buf)) return { local: await saveImage(buf, link.asin), via: "image CDN" };
      } catch { /* try next */ }
    }
  }
  // c) OpenGraph image
  if (ogData?.image) {
    try {
      const buf = await fetchBuffer(ogData.image);
      if (isRealImage(buf)) {
        const id = link.asin || slug(ogData.title || "item");
        return { local: await saveImage(buf, id), via: "OpenGraph" };
      }
    } catch { /* fall through */ }
  }
  return null;
}

const slug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "item";

/* fields a human may have written — never overwritten by a re-run */
const PRESERVE = ["blurb", "description", "badge", "badgeStyle", "category", "drawback", "order", "features", "title"];

/* ---------- main ---------- */
async function main() {
  let inputs = urls;
  if (!inputs.length) {
    try {
      inputs = (await fs.readFile(LINKS, "utf8")).split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
    } catch {
      fail(`No links given and ${path.relative(ROOT, LINKS)} not found.`);
      log(`\nUsage: node scripts/extract.mjs <url> [...]  |  put one link per line in data/links.txt\n`);
      process.exit(1);
    }
  }

  const links = inputs.map(parseLink).filter(Boolean);
  if (!links.length) { fail("No usable links."); process.exit(1); }

  step(`Extracting ${links.length} link${links.length === 1 ? "" : "s"}`);
  if (!TAG) warn("No affiliate tag set. Pass --tag yourtag-20 or set AMZ_PARTNER_TAG.");

  /* batch PA-API where possible */
  let paapi = new Map();
  const asins = links.filter((l) => l.asin).map((l) => l.asin);
  if (asins.length && hasCredentials()) {
    try {
      for (let i = 0; i < asins.length; i += 10) {
        const batch = await getItems(asins.slice(i, i + 10));
        batch.forEach((v, k) => paapi.set(k, v));
      }
      ok(`PA-API returned ${paapi.size}/${asins.length} items`);
    } catch (e) {
      warn(`PA-API unavailable (${e.message}) — falling back to the image CDN.`);
    }
  } else if (asins.length) {
    warn("No PA-API credentials — using the per-ASIN image CDN. See README for the proper setup.");
  }

  /* existing catalogue */
  let doc = { site: {}, products: [] };
  try { doc = JSON.parse(await fs.readFile(DATA, "utf8")); } catch { /* first run */ }
  const byId = new Map(doc.products.map((p) => [p.id, p]));

  let added = 0, updated = 0, failed = 0;

  for (const link of links) {
    const label = link.asin || link.url;
    log(`\n${c.dim}- ${label}${c.off}`);

    if (link.kind === "amazon-short") {
      warn("Short amzn.to link — expand it in a browser and paste the full /dp/ URL.");
      failed++; continue;
    }

    const item = link.asin ? paapi.get(link.asin) : null;

    let og = null;
    if (!item) {
      try { og = await scrapeOG(link.url || affiliateURL(link.asin, link.marketplace)); }
      catch (e) { if (link.kind === "generic") warn(`page fetch: ${e.message}`); }
    }

    const img = await resolveImage(link, item, og);
    if (img) ok(`image via ${img.via} -> ${img.local}`);
    else fail("no image found — add an `image` path by hand in products.json");

    const id = link.asin || slug(item?.title || og?.title || link.url);
    const prev = byId.get(id) || {};

    const fresh = {
      id,
      asin: link.asin || undefined,
      title: item?.title || og?.title || prev.title || id,
      brand: item?.brand || og?.brand || prev.brand,
      category: prev.category || item?.category || "Uncategorised",
      blurb: prev.blurb || (og?.description ? og.description.slice(0, 180) : ""),
      description: prev.description || og?.description || "",
      features: prev.features?.length ? prev.features : (item?.features || []).slice(0, 5),
      price: item?.price ?? og?.price ?? prev.price ?? null,
      listPrice: item?.listPrice ?? prev.listPrice ?? null,
      currency: item?.currency || og?.currency || "USD",
      rating: prev.rating ?? null,
      reviews: prev.reviews ?? null,
      badge: prev.badge,
      badgeStyle: prev.badgeStyle,
      drawback: prev.drawback,
      image: img?.local || prev.image || "",
      url: link.asin ? affiliateURL(link.asin, link.marketplace) : (og?.finalURL || link.url),
      merchant: link.asin ? "Amazon" : (og?.brand || "the store"),
      source: item ? "paapi" : og ? "opengraph" : "manual",
      checkedAt: new Date().toISOString().slice(0, 10),
    };

    // keep any hand-written field that already had a value
    for (const k of PRESERVE) if (prev[k] !== undefined && prev[k] !== "" && prev[k] !== null) fresh[k] = prev[k];

    if (byId.has(id)) { Object.assign(byId.get(id), fresh); updated++; }
    else { doc.products.push(fresh); byId.set(id, fresh); added++; }

    if (!img) failed++;
  }

  doc.site = {
    brand: "Pickd",
    tagline: "A small shelf, not a warehouse. Everything here earned its spot.",
    affiliateTag: TAG || doc.site?.affiliateTag || "",
    disclosure:
      "As an Amazon Associate this site earns from qualifying purchases. " +
      "Links marked as affiliate links may earn a commission at no additional cost to you. " +
      "Prices and availability are accurate as of the date shown and are subject to change.",
    updated: new Date().toISOString().slice(0, 10),
    ...doc.site,
    affiliateTag: TAG || doc.site?.affiliateTag || "",
  };

  await fs.writeFile(DATA, JSON.stringify(doc, null, 2) + "\n");

  step("Done");
  log(`  ${added} added · ${updated} updated · ${failed} needing attention`);
  log(`  catalogue: ${path.relative(ROOT, DATA)}\n`);
}

main().catch((e) => { fail(e.stack || e.message); process.exit(1); });
