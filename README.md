# Pickd

An editorial affiliate storefront — a static site plus a script that turns a product link into a finished product card, image and all.

No build step, no framework, no dependencies. Three files do the work: `index.html`, `assets/`, and `data/products.json`.

**Live:** https://adapapavandharma.github.io/pickd/

---

## What it does

You paste product links into `data/links.txt`, run one command, and the script:

1. Reduces each Amazon link to its **ASIN** and rebuilds it as a clean `/dp/<ASIN>?tag=<yourtag>` affiliate URL.
2. Resolves the **product image** through a fallback chain (below).
3. **Downloads the image locally** into `assets/img/` — the site never hotlinks, so images don't break when a CDN path rotates.
4. Merges into `data/products.json` **without overwriting anything you wrote by hand**.

```bash
npm run extract -- --tag yourtag-20
```

Your editorial copy is safe across re-runs. These fields are never clobbered once set:
`title`, `blurb`, `description`, `features`, `badge`, `badgeStyle`, `category`, `drawback`, `order`.

---

## How images are resolved

The script tries three sources in order and stops at the first real image:

| # | Source | When it works | Notes |
|---|--------|---------------|-------|
| 1 | **PA-API 5.0** | You have Associates API credentials | The correct path. Also returns live price, brand, features, and category. |
| 2 | **Amazon per-ASIN image CDN** | Any valid ASIN | No credentials needed. This is the endpoint SiteStripe image embeds resolve to. |
| 3 | **OpenGraph `<meta>` tags** | Non-Amazon merchants | Works well for most other stores. |

Amazon returns a ~43-byte placeholder GIF instead of a 404 when an ASIN has no image, so the script sniffs magic bytes and rejects GIFs and anything under 2.5 KB rather than saving a blank file.

### One thing to know about Amazon

Amazon's Associates Operating Agreement asks that product images and data come from the **Product Advertising API** or **SiteStripe** — not from scraping product pages. Amazon also blocks automated page fetches, so scraping is unreliable even setting the terms aside.

That is why the fallback uses the per-ASIN **image endpoint** rather than parsing the product page, and why **prices are never hard-coded**. Amazon requires displayed prices to come from PA-API and be refreshed within 24 hours; a stale number on your page is a compliance problem. Without credentials the card shows a live-price indicator and sends the click to Amazon, which is both correct and what converts.

**To get real prices, ratings and titles**, connect PA-API:

```bash
# .env  (or export these in your shell / set them as Actions secrets)
AMZ_ACCESS_KEY=...
AMZ_SECRET_KEY=...
AMZ_PARTNER_TAG=yourtag-20
AMZ_MARKETPLACE=www.amazon.com
```

API access requires an approved Associates account that has made qualifying sales. Until then, tiers 2 and 3 keep the site fully functional.

---

## Quick start

```bash
git clone https://github.com/adapapavandharma/pickd.git
cd pickd
node scripts/serve.mjs        # http://localhost:4173
```

There is nothing to install. `npm run extract` and the server both use only the Node standard library.

### Adding a product

1. Put the link (or a bare ASIN) on its own line in `data/links.txt`.
2. Run `npm run extract -- --tag yourtag-20`.
3. Open `data/products.json` and write the `blurb`, `description`, `features` and `drawback`.
4. Commit. GitHub Actions redeploys on push to `main`.

Ad-hoc, without touching `links.txt`:

```bash
node scripts/extract.mjs --tag yourtag-20 https://www.amazon.com/dp/B09XS7JWHH
```

---

## Making it yours

| What | Where |
|------|-------|
| Site name, tagline, disclosure | `site` block in `data/products.json` |
| Colours, type, spacing | CSS custom properties at the top of `assets/css/styles.css` |
| Hero headline, "how it works" copy | `index.html` |
| Categories | Just the `category` field on each product — chips build themselves |
| Badges | `badge` plus `badgeStyle`: `gold`, `deal`, or omit for the default |

The accent colour, paper tone and both dark-mode palettes are all variables in `:root` and `[data-theme="dark"]`. Change `--accent` and the whole site follows.

---

## What's in the box

- **Editorial layout** — Fraunces display serif over Inter, warm paper ground, film-grain overlay
- **Dark mode** — follows the system by default, toggle persists in `localStorage`
- **Filter, search, sort** — category chips, `/` to focus search, sort by price, rating or name
- **Detail sheet** — native `<dialog>`, click a product image to open it
- **Every affiliate link** carries `rel="nofollow sponsored noopener"` and `target="_blank"`, which is what the FTC and Google both expect
- **Disclosure** in the hero and the footer
- **Accessible** — keyboard-operable cards, focus rings, `prefers-reduced-motion` respected, skip link
- **Responsive** down to 320px
- **Zero dependencies** — no npm install, nothing to audit, nothing to patch

---

## Deployment

`.github/workflows/deploy.yml` publishes to GitHub Pages on every push to `main`. In the repo: **Settings → Pages → Source → GitHub Actions**.

Any static host works too — there is no build output, the repo root *is* the site.

---

## The sample catalogue

The eight products shipped here are real, and their images were pulled by the extractor as a working demonstration of the pipeline. The **written copy is sample editorial** — replace it with your own opinions before you publish anything you want taken seriously. Ratings and review counts are deliberately left empty rather than invented; they populate from PA-API.

---

## Legal

You are responsible for your own compliance. The short version:

- **Disclose.** The FTC requires a clear, conspicuous affiliate disclosure. One ships in the hero and the footer — keep it.
- **Say the sentence.** Associates must display: *"As an Amazon Associate I earn from qualifying purchases."* It is in the footer disclosure.
- **Don't hard-code prices.** Covered above.
- **Images belong to their owners.** Serving them through the Associates programme is the arrangement that makes it fine; ripping them for unrelated use is not.

Code is MIT. Product names, images and trademarks belong to their respective owners.
