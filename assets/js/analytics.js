/* ============================================================
   Pickd — analytics layer

   Two sources feed the dashboard:

   1. REAL events. Every affiliate click on the storefront is recorded to
      localStorage. Click a product, open the dashboard, and your own click is
      in there. This is the part that would be a server in production.

   2. SIMULATED history. A demonstration site with an empty dashboard shows
      nothing, so a 90-day dataset is generated from a seeded PRNG. It is
      deterministic — same numbers on every load and every machine, because a
      dashboard that reshuffles itself on refresh looks broken.

   Simulated rows are flagged `sim: true` throughout and the dashboard labels
   them. Nothing here is real traffic and the UI never implies otherwise.
   ============================================================ */

const STORE_KEY = "pickd:events:v1";
export const SOURCES = ["Organic search", "Newsletter", "Social", "Direct", "Referral"];

/* Roughly where affiliate traffic actually comes from — search first by a wide
   margin, referral the tail. Per-product variance is applied around these. */
const SOURCE_ANCHORS = [0.46, 0.19, 0.15, 0.12, 0.08];

/* ---------- storage (never throws — private mode, blocked cookies) ---------- */

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

/** Every real click the visitor has made on this browser. */
export function getRealEvents() {
  try {
    const raw = read(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

/** Record one affiliate click. Called from the storefront. */
export function recordClick(productId, source = "Direct") {
  if (!productId) return;
  const events = getRealEvents();
  events.push({ id: productId, ts: Date.now(), source, sim: false });
  // keep the log bounded — this is a browser, not a warehouse
  write(STORE_KEY, JSON.stringify(events.slice(-2000)));
}

export function clearRealEvents() {
  try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
}

/* ---------- deterministic pseudo-randomness ---------- */

/** FNV-1a — string to 32-bit seed. */
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, good enough, and repeatable. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- the simulated history ---------- */

const DAY = 86400000;

/** Midnight local time, `offset` days ago. */
function dayStart(offset = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime() - offset * DAY;
}

/**
 * Build a per-product, per-day table for the last `days` days.
 * Popularity is anchored to review count so the ranking matches the catalogue's
 * own plausibility, and conversion is inversely related to price — cheap things
 * convert, laptops do not.
 */
export function simulate(products, days = 90) {
  const rows = [];

  for (const p of products) {
    const seed = hashSeed(p.id);
    const rand = rng(seed);

    // popularity: log of review count, so a 200k-review product is ~2x a
    // 3k-review one rather than 60x
    const pop = Math.log10(Math.max(p.reviews || 500, 500)) - 2.4;      // ~0.3 .. 3.0
    const base = Math.max(1.5, pop * 7 * (0.7 + rand() * 0.6));

    // cheap converts, expensive does not
    const price = p.price || 60;
    const conv = Math.max(0.012, Math.min(0.11, 0.10 - Math.log10(price) * 0.028));

    // A fixed source mix per product. Anchored to a realistic affiliate shape —
    // search dominates, referral is the tail — with per-product variance around
    // each anchor. An even split would be both wrong and unreadable as a chart.
    const mixWeights = SOURCE_ANCHORS.map((a) => a * (0.65 + rand() * 0.7));
    const mixTotal = mixWeights.reduce((a, b) => a + b, 0);
    const mix = mixWeights.map((w) => w / mixTotal);

    for (let d = days - 1; d >= 0; d--) {
      const ts = dayStart(d);
      const date = new Date(ts);
      const dow = date.getDay();

      // weekends run quieter; a mild upward trend across the window; weekly wobble
      const weekend = dow === 0 || dow === 6 ? 0.72 : 1;
      const trend = 1 + (days - d) / days * 0.35;
      const wobble = 0.75 + rand() * 0.5;

      const clicks = Math.round(base * weekend * trend * wobble);
      if (clicks <= 0) continue;

      // impressions are what the card was seen; clicks are a slice of that
      const impressions = Math.round(clicks * (14 + rand() * 10));
      const orders = Math.round(clicks * conv * (0.6 + rand() * 0.8));
      const commission = orders * price * (p.commissionRate ?? 0.03);

      // split clicks across sources by the product's fixed mix
      let left = clicks;
      const bySource = {};
      mix.forEach((share, i) => {
        const n = i === mix.length - 1 ? left : Math.round(clicks * share);
        bySource[SOURCES[i]] = Math.max(0, Math.min(n, left));
        left -= bySource[SOURCES[i]];
      });

      rows.push({
        id: p.id, ts, date, impressions, clicks, orders,
        commission, bySource, sim: true,
      });
    }
  }
  return rows;
}

/**
 * Fold the visitor's real clicks into the simulated table so the dashboard
 * reflects what they actually did on the storefront a moment ago.
 */
export function mergeReal(rows, realEvents, products) {
  if (!realEvents.length) return { rows, realCount: 0 };

  const index = new Map(rows.map((r) => [`${r.id}|${r.ts}`, r]));
  const byId = new Map(products.map((p) => [p.id, p]));
  let realCount = 0;

  for (const ev of realEvents) {
    const p = byId.get(ev.id);
    if (!p) continue;
    const d = new Date(ev.ts);
    d.setHours(0, 0, 0, 0);
    const key = `${ev.id}|${d.getTime()}`;

    let row = index.get(key);
    if (!row) {
      row = {
        id: ev.id, ts: d.getTime(), date: d,
        impressions: 0, clicks: 0, orders: 0, commission: 0,
        bySource: {}, sim: false,
      };
      rows.push(row);
      index.set(key, row);
    }
    row.clicks += 1;
    row.impressions += 1;
    row.bySource[ev.source] = (row.bySource[ev.source] || 0) + 1;
    row.hasReal = true;
    realCount++;
  }
  return { rows, realCount };
}

/* ---------- aggregation ---------- */

export function withinDays(rows, days) {
  const cutoff = dayStart(days - 1);
  return rows.filter((r) => r.ts >= cutoff);
}

export function totals(rows) {
  const t = { impressions: 0, clicks: 0, orders: 0, commission: 0 };
  for (const r of rows) {
    t.impressions += r.impressions;
    t.clicks += r.clicks;
    t.orders += r.orders;
    t.commission += r.commission;
  }
  t.ctr = t.impressions ? t.clicks / t.impressions : 0;
  t.conversion = t.clicks ? t.orders / t.clicks : 0;
  t.epc = t.clicks ? t.commission / t.clicks : 0;
  t.aov = t.orders ? t.commission / t.orders : 0;
  return t;
}

/** One point per day, ascending. Fills gaps so the line has no holes. */
export function byDay(rows, days) {
  const buckets = new Map();
  for (let d = days - 1; d >= 0; d--) {
    const ts = dayStart(d);
    buckets.set(ts, { ts, date: new Date(ts), clicks: 0, orders: 0, commission: 0, impressions: 0 });
  }
  for (const r of rows) {
    const b = buckets.get(r.ts);
    if (!b) continue;
    b.clicks += r.clicks;
    b.orders += r.orders;
    b.commission += r.commission;
    b.impressions += r.impressions;
  }
  return [...buckets.values()].sort((a, b) => a.ts - b.ts);
}

export function byProduct(rows, products) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const acc = new Map();
  for (const r of rows) {
    let a = acc.get(r.id);
    if (!a) {
      const p = byId.get(r.id);
      if (!p) continue;
      a = { id: r.id, title: p.title, category: p.category, price: p.price,
            image: p.image, url: p.url, impressions: 0, clicks: 0, orders: 0, commission: 0 };
      acc.set(r.id, a);
    }
    a.impressions += r.impressions;
    a.clicks += r.clicks;
    a.orders += r.orders;
    a.commission += r.commission;
  }
  for (const a of acc.values()) {
    a.ctr = a.impressions ? a.clicks / a.impressions : 0;
    a.conversion = a.clicks ? a.orders / a.clicks : 0;
    a.epc = a.clicks ? a.commission / a.clicks : 0;
  }
  return [...acc.values()];
}

export function byCategory(rows, products) {
  const acc = new Map();
  for (const p of byProduct(rows, products)) {
    const c = acc.get(p.category) || { category: p.category, clicks: 0, orders: 0, commission: 0 };
    c.clicks += p.clicks;
    c.orders += p.orders;
    c.commission += p.commission;
    acc.set(p.category, c);
  }
  return [...acc.values()].sort((a, b) => b.commission - a.commission);
}

export function bySource(rows) {
  const acc = Object.fromEntries(SOURCES.map((s) => [s, 0]));
  for (const r of rows) {
    for (const [s, n] of Object.entries(r.bySource || {})) {
      if (acc[s] === undefined) acc[s] = 0;
      acc[s] += n;
    }
  }
  const total = Object.values(acc).reduce((a, b) => a + b, 0) || 1;
  return SOURCES.map((s) => ({ source: s, clicks: acc[s] || 0, share: (acc[s] || 0) / total }));
}

/** Same window length, immediately before the current one — for deltas. */
export function previousWindow(rows, days) {
  const end = dayStart(days - 1);
  const start = dayStart(days * 2 - 1);
  return rows.filter((r) => r.ts >= start && r.ts < end);
}
