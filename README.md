# Pickd

**A demonstration build for affiliate operators** — an editorial storefront wired to a working analytics layer, so you can see the finished article instead of reading a description of it.

- **Storefront** → https://adapapavandharma.github.io/pickd/
- **Dashboard** → https://adapapavandharma.github.io/pickd/dashboard.html

Static site. No framework, no build step, no dependencies — `npm install` does nothing because there is nothing to install. The repo root *is* the site.

> **This is a demo, not a live storefront.** The products, images and links are real; the affiliate tag is a placeholder, and prices, ratings and every dashboard figure are sample data. It is labelled as such on the site itself.

---

## What it demonstrates

**1. A storefront that doesn't look like an affiliate site.** Editorial layout, warm paper ground, Fraunces over Inter, film grain, dark mode that follows the system, filter chips, live search, sort, and a detail sheet. 16 products across 10 categories.

**2. Product images pulled straight from the link.** Paste a product URL or ASIN, run one command, and the extractor resolves the image, downloads it locally, and writes the card. No manual asset wrangling.

**3. An analytics layer that actually measures something.** Every affiliate click on the storefront is recorded and appears on the dashboard. Click a product, open Performance, and your click is in the numbers.

**4. Charts built to a standard, not to taste.** Hand-drawn SVG — no charting library. Bars capped at 24px with 4px rounded data-ends, 2px surface gaps doing the separating, hairline solid gridlines, crosshair tooltips with keyboard equivalents, and a table-view twin on every chart so no value is reachable only by hovering. The categorical palette was run through a colour-vision-deficiency and contrast validator, not eyeballed.

---

## The extractor

```bash
npm run extract -- --tag yourtag-20
```

Put links (or bare ASINs) in [`data/links.txt`](data/links.txt), one per line. The script then:

1. Reduces each Amazon link to its **ASIN** and rebuilds it as a clean `/dp/<ASIN>?tag=<yourtag>` affiliate URL.
2. Resolves the **product image** through a fallback chain (below).
3. **Downloads the image locally** into `assets/img/` — the site never hotlinks, so images don't break when a CDN path rotates.
4. Merges into `data/products.json` **without overwriting anything you wrote by hand**.

Re-running is safe. These fields are never clobbered once set:
`title`, `blurb`, `description`, `features`, `badge`, `badgeStyle`, `category`, `drawback`, `order`.

### How images resolve

| # | Source | When it works | Notes |
|---|--------|---------------|-------|
| 1 | **PA-API 5.0** | You have Associates API credentials | The correct path. Also returns live price, brand, features and category. |
| 2 | **Amazon per-ASIN image CDN** | Any valid ASIN | No credentials needed. This is what's running here. |
| 3 | **OpenGraph `<meta>`** | Non-Amazon merchants | Works well for most other stores. |

Amazon returns a ~43-byte placeholder GIF rather than a 404 when an ASIN has no image, so the script sniffs magic bytes and rejects GIFs and anything under 2.5 KB instead of saving a blank file. Tier 2 tops out at 500px on the long edge, which is about 2.2× for the card slot — retina-adequate. PA-API returns larger.

### The Amazon rules this respects

Amazon's Associates Operating Agreement asks that product images and data come from the **Product Advertising API** or **SiteStripe**, not from scraping product pages — and Amazon blocks automated page fetches anyway, so scraping is unreliable even setting the terms aside. That is why tier 2 uses the image endpoint rather than parsing HTML.

It is also why **prices are never fetched and cached**: Amazon requires displayed prices to come from PA-API and be refreshed within 24 hours. The sample prices here are demo data, clearly labelled. Connect credentials and real prices flow in:

```bash
# .env, or exported in your shell, or as Actions secrets
AMZ_ACCESS_KEY=...
AMZ_SECRET_KEY=...
AMZ_PARTNER_TAG=yourtag-20
AMZ_MARKETPLACE=www.amazon.com
```

The SigV4 request signing is implemented in [`scripts/paapi.mjs`](scripts/paapi.mjs). API access needs an approved Associates account with qualifying sales; until then tiers 2 and 3 keep everything working.

---

## The dashboard

Two data sources feed it, and the split is stated on the page:

- **Real events.** Affiliate clicks are recorded to `localStorage` with channel attribution derived from `utm_source` or the referrer. In production this is the part that becomes a server.
- **Simulated history.** A 90-day dataset generated from a **seeded** PRNG, so it is identical on every load and every machine — a dashboard that reshuffles itself on refresh looks broken. Popularity is anchored to review count and conversion falls as price rises, so the shape is plausible rather than random.

What's on it: a hero commission figure, four stat tiles with sparklines and period-over-period deltas, clicks over time, commission by category, channel mix, top products by clicks, and a sortable per-product table with impressions, CTR, orders, conversion, EPC and commission. One filter row (7/30/90 days) scopes everything.

---

## Quick start

```bash
git clone https://github.com/adapapavandharma/pickd.git
cd pickd
node scripts/serve.mjs        # http://localhost:4173
```

| Task | Command |
|---|---|
| Add products | Edit `data/links.txt`, then `npm run extract -- --tag yourtag-20` |
| Check the catalogue | `npm run validate` |
| Preview locally | `npm run dev` |

---

## Making it yours

| What | Where |
|------|-------|
| Site name, tagline, disclosure | `site` block in [`data/products.json`](data/products.json) |
| Colours, type, spacing | CSS custom properties at the top of [`assets/css/styles.css`](assets/css/styles.css) |
| Chart palette | Token block at the top of [`assets/css/dashboard.css`](assets/css/dashboard.css) |
| Hero and section copy | [`index.html`](index.html) |
| Categories | Just the `category` field on each product — the chips build themselves |
| Badges | `badge` plus `badgeStyle`: `gold`, `deal`, or omit |

Change `--accent` and the whole site follows. If you swap the chart palette, re-run the validator against your own surfaces rather than trusting it by eye — the slot *ordering* is the colour-blindness safety mechanism, not decoration.

---

## Notes on the build

- **Cache busting.** GitHub Pages serves assets with `max-age=600`, so a returning visitor can get fresh HTML with a stale stylesheet. [`scripts/stamp.mjs`](scripts/stamp.mjs) stamps each CSS/JS reference with a hash of its own contents at deploy time, so the URL changes exactly when the file does and unchanged assets stay cached.
- **The reveal can't fail closed.** Cards are visible by default; the scroll animation is opt-in behind a class JS only adds once it has a live `IntersectionObserver`, with a 1.2s failsafe. A blocked script can never leave the shelf blank.
- **Affiliate links** carry `rel="nofollow sponsored noopener"` and `target="_blank"` — what the FTC and Google both expect.
- **Accessible.** Keyboard-operable cards and charts, focus rings, `prefers-reduced-motion` respected, skip links, table views, and a disclosure in both the hero and the footer.
- **CI** validates the catalogue (required fields, duplicate ids, images present on disk, price types, and a warning for any Amazon link missing its tag) before it will deploy.
- **`robots.txt`** allows search engines and opts out of AI training crawlers.

---

## Legal

If you run this for real, you are responsible for your own compliance. The short version:

- **Disclose.** The FTC requires a clear, conspicuous affiliate disclosure. One ships in the hero and the footer — keep it.
- **Say the sentence.** Associates must display *"As an Amazon Associate I earn from qualifying purchases."*
- **Don't hard-code prices.** Covered above.
- **Images belong to their owners.** Serving them through the Associates programme is the arrangement that makes it fine.

Code is MIT. Product names, images and trademarks belong to their respective owners.
