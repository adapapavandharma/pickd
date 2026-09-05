#!/usr/bin/env node
/* ============================================================
   Pickd — static site generator

   One JSON catalogue in, a whole site out. This is what makes the site
   multi-layered rather than a single page with a modal:

     /                        the shelf          (hand-written)
     /p/<asin>.html           a page per product (generated)
     /guides/                 the guide index    (generated)
     /guides/<slug>.html      a buying guide     (generated)
     /dashboard.html          performance        (hand-written)
     /craft.html              how it was built   (hand-written)

   Product pages and guides cross-link both ways — a product page lists the
   guides that feature it, a guide links to every product page — so the
   editorial layer and the catalogue layer are genuinely wired together
   rather than sitting side by side.

   It also owns the shared navigation. Every page, generated or not, carries
   its nav between <!--nav--> markers, so there is exactly one definition of
   it and no page can drift out of sync.

   Asset paths are depth-aware: a page at /p/foo.html gets ../assets/...,
   the root gets assets/.... No absolute paths, so the site works at any
   base path — a user site, a project page, or a local folder.
   ============================================================ */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://adapapavandharma.github.io/pickd";

const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const catalogue = read("data/products.json");
const guidesDoc = read("data/guides.json");
const PRODUCTS = catalogue.products;
const GUIDES = guidesDoc.guides;
const SITEINFO = catalogue.site;

const byId = new Map(PRODUCTS.map((p) => [p.id, p]));

/* ---------- helpers ---------- */
const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const up = (depth) => "../".repeat(depth);

const money = (n, c = "USD") =>
  typeof n === "number" ? n.toLocaleString("en-US", { style: "currency", currency: c, maximumFractionDigits: 2 }) : "";

const stars = (r) =>
  !r ? "" : `<span class="stars" aria-hidden="true">★★★★★<i style="width:${(r / 5) * 100}%">★★★★★</i></span>`;

/** Which guides feature a given product. The cross-link that ties the layers together. */
const guidesFor = (id) => GUIDES.filter((g) => g.picks.some((p) => p.id === id));

/* ---------- shared chrome ---------- */

const NAV = [
  { href: "index.html", label: "Shelf", key: "shelf" },
  { href: "guides/index.html", label: "Guides", key: "guides" },
  { href: "dashboard.html", label: "Performance", key: "dash" },
  { href: "craft.html", label: "Craft", key: "craft" },
];

function nav(active, depth) {
  return (
    `<nav class="tabs" aria-label="Sections">` +
    NAV.map((n) => {
      const href = up(depth) + n.href;
      const cur = n.key === active ? ' aria-current="page"' : "";
      return `<a href="${href}"${cur}>${n.label}</a>`;
    }).join("") +
    `</nav>`
  );
}

function header(active, depth) {
  return `<header class="topbar" id="topbar">
  <div class="wrap topbar__inner">
    <a class="brand" href="${up(depth)}index.html">
      <span class="brand__mark" aria-hidden="true"></span>
      <span class="brand__name">${esc(SITEINFO.brand)}</span>
      <span class="pill">Demo</span>
    </a>
    <!--nav-->${nav(active, depth)}<!--/nav-->
    <button class="iconbtn" id="theme" type="button" aria-label="Toggle dark mode">
      <svg class="i-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/></svg>
      <svg class="i-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8.2 8.2 0 019.5 4 8.5 8.5 0 1020 14.5z"/></svg>
    </button>
  </div>
</header>`;
}

function footer(depth) {
  return `<footer class="foot">
  <div class="wrap foot__inner">
    <div class="foot__brand"><span class="brand__mark" aria-hidden="true"></span><strong>${esc(SITEINFO.brand)}</strong></div>
    <div class="foot__note">
      <strong>What this is.</strong> A demonstration build — an editorial affiliate storefront with a working
      analytics layer, made to show the finished article rather than describe it. The products and images are real;
      the affiliate tag is a placeholder and every figure on the dashboard is sample data.
      <a href="https://github.com/adapapavandharma/pickd">Source on GitHub &rarr;</a>
    </div>
    <p class="foot__disc">${esc(SITEINFO.disclosure)}</p>
    <p class="foot__meta">© <span id="year">2026</span> · <a href="${up(depth)}index.html">Back to the shelf</a></p>
  </div>
</footer>`;
}

function page({ title, description, active, depth, canonical, body, jsonld = [], extraCss = [], noindex = false }) {
  const a = up(depth);
  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="light dark">
${noindex ? '<meta name="robots" content="noindex">\n' : ""}<link rel="canonical" href="${esc(canonical)}">

<meta property="og:type" content="article">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">

<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>&#127793;</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300..700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${a}assets/css/styles.css">
<link rel="stylesheet" href="${a}assets/css/article.css">
${extraCss.map((c) => `<link rel="stylesheet" href="${a}${c}">`).join("\n")}
${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j)}</script>`).join("\n")}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
${header(active, depth)}
${body}
${footer(depth)}
<script src="${a}assets/js/page.js" type="module"></script>
</body>
</html>
`;
}

/* ---------- product pages ---------- */

function productPage(p, i) {
  const depth = 1;
  const a = up(depth);
  const featured = guidesFor(p.id);
  const siblings = PRODUCTS.filter((x) => x.category === p.category && x.id !== p.id).slice(0, 3);

  const jsonld = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.title,
    image: `${SITE}/${p.image}`,
    description: p.description || p.blurb,
    brand: { "@type": "Brand", name: p.brand || "Unknown" },
    sku: p.asin,
    ...(p.rating
      ? { aggregateRating: { "@type": "AggregateRating", ratingValue: p.rating, reviewCount: p.reviews } }
      : {}),
    ...(p.price
      ? { offers: { "@type": "Offer", price: p.price, priceCurrency: p.currency || "USD", url: p.url, availability: "https://schema.org/InStock" } }
      : {}),
  };

  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Shelf", item: `${SITE}/` },
      { "@type": "ListItem", position: 2, name: p.category, item: `${SITE}/#grid` },
      { "@type": "ListItem", position: 3, name: p.title, item: `${SITE}/p/${p.id}.html` },
    ],
  };

  const body = `<main id="main" class="wrap article">

  <nav class="crumbs" aria-label="Breadcrumb">
    <a href="${a}index.html">Shelf</a> <span aria-hidden="true">/</span>
    <a href="${a}index.html?category=${encodeURIComponent(p.category)}">${esc(p.category)}</a> <span aria-hidden="true">/</span>
    <span aria-current="page">${esc(p.title)}</span>
  </nav>

  <div class="phero">
    <div class="phero__media"><img src="${a}${esc(p.image)}" alt="${esc(p.title)}" width="500" height="500"></div>
    <div class="phero__info">
      <span class="card__cat">${esc(p.brand || p.category)}</span>
      <h1>${esc(p.title)}</h1>
      <p class="phero__blurb">${esc(p.blurb)}</p>
      ${p.rating ? `<div class="rating">${stars(p.rating)}<span>${p.rating} out of 5 · ${Number(p.reviews).toLocaleString("en-US")} ratings</span></div>` : ""}
      <div class="phero__buy">
        <span class="price">${money(p.price, p.currency)}${
          p.listPrice && p.listPrice > p.price ? `<s>${money(p.listPrice, p.currency)}</s>` : ""
        }</span>
        <a class="btn btn--solid" href="${esc(p.url)}" target="_blank" rel="nofollow sponsored noopener">Check price on ${esc(p.merchant || "Amazon")}</a>
      </div>
      <p class="phero__meta">Affiliate link · sample pricing, shown for demonstration</p>
    </div>
  </div>

  <div class="article__body">
    <section class="prose">
      <h2>The case for it</h2>
      ${(p.description || "").split("\n").filter(Boolean).map((t) => `<p>${esc(t)}</p>`).join("")}
    </section>

    ${
      p.features?.length
        ? `<section class="prose">
      <h2>What you actually get</h2>
      <ul class="spec">${p.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
    </section>`
        : ""
    }

    ${
      p.drawback
        ? `<section class="callout callout--warn">
      <h2>Where it falls down</h2>
      <p>${esc(p.drawback)}</p>
    </section>`
        : ""
    }

    ${
      featured.length
        ? `<section class="prose">
      <h2>Featured in</h2>
      <div class="guidecards">
        ${featured
          .map((g) => {
            const pick = g.picks.find((x) => x.id === p.id);
            return `<a class="guidecard" href="${a}guides/${g.slug}.html">
              ${pick.award ? `<span class="award">${esc(pick.award)}</span>` : ""}
              <strong>${esc(g.title)}</strong>
              <span>${esc(pick.verdict)}</span>
            </a>`;
          })
          .join("")}
      </div>
    </section>`
        : ""
    }

    ${
      siblings.length
        ? `<section class="prose">
      <h2>Others in ${esc(p.category)}</h2>
      <div class="minigrid">
        ${siblings
          .map(
            (s) => `<a class="minicard" href="${a}p/${s.id}.html">
            <div class="minicard__media"><img src="${a}${esc(s.image)}" alt="" loading="lazy" width="120" height="120"></div>
            <div><strong>${esc(s.title)}</strong><span>${esc(s.blurb.slice(0, 80))}…</span></div>
          </a>`
          )
          .join("")}
      </div>
    </section>`
        : ""
    }

    <section class="cta-strip">
      <p>${esc(p.blurb)}</p>
      <a class="btn btn--solid" href="${esc(p.url)}" target="_blank" rel="nofollow sponsored noopener">Check price on ${esc(p.merchant || "Amazon")}</a>
    </section>
  </div>
</main>`;

  return page({
    title: `${p.title} — ${SITEINFO.brand}`,
    description: p.blurb,
    active: "shelf",
    depth,
    canonical: `${SITE}/p/${p.id}.html`,
    body,
    jsonld: [jsonld, crumbs],
  });
}

/* ---------- guide pages ---------- */

function guidePage(g) {
  const depth = 1;
  const a = up(depth);
  const picks = g.picks.map((pick) => ({ pick, p: byId.get(pick.id) })).filter((x) => x.p);

  const jsonld = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: g.title,
    description: g.standfirst,
    itemListElement: picks.map((x, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: x.p.title,
      url: `${SITE}/p/${x.p.id}.html`,
    })),
  };

  const faq = g.faq?.length
    ? {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: g.faq.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      }
    : null;

  const compareTable = `
    <div class="tablewrap">
      <table class="ctable">
        <thead><tr><th scope="col">&nbsp;</th>${picks
          .map((x) => `<th scope="col"><a href="${a}p/${x.p.id}.html">${esc(x.p.title)}</a></th>`)
          .join("")}</tr></thead>
        <tbody>
          ${g.compare
            .map(
              (row) =>
                `<tr><th scope="row">${esc(row.label)}</th>${picks
                  .map((x) => `<td>${esc(row.values[x.p.id] ?? "—")}</td>`)
                  .join("")}</tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;

  const body = `<main id="main" class="wrap article">

  <nav class="crumbs" aria-label="Breadcrumb">
    <a href="${a}index.html">Shelf</a> <span aria-hidden="true">/</span>
    <a href="${a}guides/index.html">Guides</a> <span aria-hidden="true">/</span>
    <span aria-current="page">${esc(g.title)}</span>
  </nav>

  <header class="ghead">
    <p class="eyebrow">${esc(g.category)} guide · ${g.readingMinutes} min read</p>
    <h1>${esc(g.title)}</h1>
    <p class="ghead__stand">${esc(g.standfirst)}</p>
    <p class="ghead__meta">Updated ${new Date(g.updated).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} · ${picks.length} picks</p>
  </header>

  <div class="article__body">
    <section class="prose">${g.intro.map((t) => `<p>${esc(t)}</p>`).join("")}</section>

    <section class="verdicts">
      <h2 class="sec">The picks, in one line each</h2>
      <div class="verdictgrid">
        ${picks
          .map(
            ({ pick, p }) => `<a class="verdict" href="#${esc(p.id)}">
          <span class="badge ${pick.awardStyle === "gold" ? "badge--gold" : pick.awardStyle === "deal" ? "badge--deal" : ""}">${esc(pick.award)}</span>
          <div class="verdict__media"><img src="${a}${esc(p.image)}" alt="" loading="lazy" width="150" height="150"></div>
          <strong>${esc(p.title)}</strong>
          <span class="verdict__line">${esc(pick.verdict)}</span>
        </a>`
          )
          .join("")}
      </div>
    </section>

    ${picks
      .map(
        ({ pick, p }) => `<section class="pick" id="${esc(p.id)}">
      <div class="pick__head">
        <span class="badge ${pick.awardStyle === "gold" ? "badge--gold" : pick.awardStyle === "deal" ? "badge--deal" : ""}">${esc(pick.award)}</span>
        <h2><a href="${a}p/${p.id}.html">${esc(p.title)}</a></h2>
        ${p.rating ? `<div class="rating">${stars(p.rating)}<span>${p.rating} · ${Number(p.reviews).toLocaleString("en-US")} ratings</span></div>` : ""}
      </div>
      <div class="pick__body">
        <div class="pick__media">
          <a href="${a}p/${p.id}.html"><img src="${a}${esc(p.image)}" alt="${esc(p.title)}" loading="lazy" width="300" height="300"></a>
          <span class="price">${money(p.price, p.currency)}</span>
          <a class="btn btn--solid btn--block" href="${esc(p.url)}" target="_blank" rel="nofollow sponsored noopener">Check price</a>
          <a class="pick__more" href="${a}p/${p.id}.html">Full write-up &rarr;</a>
        </div>
        <div class="pick__prose prose">
          ${pick.body.map((t) => `<p>${esc(t)}</p>`).join("")}
          <dl class="forwho">
            <dt>Best for</dt><dd>${esc(pick.bestFor)}</dd>
            <dt>Skip it if</dt><dd>${esc(pick.skipIf)}</dd>
          </dl>
        </div>
      </div>
    </section>`
      )
      .join("")}

    <section class="prose">
      <h2 class="sec">Side by side</h2>
      ${compareTable}
    </section>

    <section class="prose">
      <h2 class="sec">The short version</h2>
      ${g.closing.map((t) => `<p>${esc(t)}</p>`).join("")}
    </section>

    ${
      g.faq?.length
        ? `<section class="prose">
      <h2 class="sec">Questions people actually ask</h2>
      ${g.faq.map((f) => `<details class="faq"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("")}
    </section>`
        : ""
    }
  </div>
</main>`;

  return page({
    title: `${g.title} — ${SITEINFO.brand}`,
    description: g.standfirst,
    active: "guides",
    depth,
    canonical: `${SITE}/guides/${g.slug}.html`,
    body,
    jsonld: faq ? [jsonld, faq] : [jsonld],
  });
}

/* ---------- guide index ---------- */

function guideIndex() {
  const depth = 1;
  const a = up(depth);
  const body = `<main id="main" class="wrap article">
  <header class="ghead ghead--index">
    <p class="eyebrow">Buying guides</p>
    <h1>Fewer things, explained <em>properly</em></h1>
    <p class="ghead__stand">Each guide picks a small number of things for one job and says plainly who each one is wrong for. No rankings of forty near-identical products.</p>
  </header>

  <div class="glist">
    ${GUIDES.map((g) => {
      const picks = g.picks.map((x) => byId.get(x.id)).filter(Boolean);
      return `<a class="gcard" href="${a}guides/${g.slug}.html">
        <div class="gcard__thumbs">
          ${picks.slice(0, 4).map((p) => `<img src="${a}${esc(p.image)}" alt="" loading="lazy" width="90" height="90">`).join("")}
        </div>
        <div class="gcard__text">
          <span class="card__cat">${esc(g.category)} · ${g.readingMinutes} min</span>
          <h2>${esc(g.title)}</h2>
          <p>${esc(g.standfirst)}</p>
          <span class="gcard__more">Read the guide &rarr;</span>
        </div>
      </a>`;
    }).join("")}
  </div>
</main>`;

  return page({
    title: `Buying guides — ${SITEINFO.brand}`,
    description: "Short, opinionated buying guides. A few picks per job, each with the case against it.",
    active: "guides",
    depth,
    canonical: `${SITE}/guides/`,
    body,
  });
}

/* ---------- nav injection into hand-written pages ---------- */

function syncNav() {
  const pages = [
    { file: "index.html", active: "shelf", depth: 0 },
    { file: "dashboard.html", active: "dash", depth: 0 },
    { file: "craft.html", active: "craft", depth: 0 },
  ];
  let synced = 0;
  for (const { file, active, depth } of pages) {
    const full = path.join(ROOT, file);
    if (!fs.existsSync(full)) continue;
    const src = fs.readFileSync(full, "utf8");
    const next = src.replace(/<!--nav-->[\s\S]*?<!--\/nav-->/, `<!--nav-->${nav(active, depth)}<!--/nav-->`);
    if (next !== src) { fs.writeFileSync(full, next); synced++; }
  }
  return synced;
}

/* ---------- sitemap ---------- */

function sitemap() {
  const urls = [
    { loc: `${SITE}/`, priority: "1.0", freq: "weekly" },
    { loc: `${SITE}/guides/`, priority: "0.9", freq: "weekly" },
    { loc: `${SITE}/craft.html`, priority: "0.7", freq: "monthly" },
    ...GUIDES.map((g) => ({ loc: `${SITE}/guides/${g.slug}.html`, priority: "0.8", freq: "monthly" })),
    ...PRODUCTS.map((p) => ({ loc: `${SITE}/p/${p.id}.html`, priority: "0.6", freq: "weekly" })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.loc}</loc><changefreq>${u.freq}</changefreq><priority>${u.priority}</priority></url>`).join("\n")}
</urlset>
`;
}

/* ---------- run ---------- */

function write(rel, contents) {
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
}

let count = 0;
for (const [i, p] of PRODUCTS.entries()) { write(`p/${p.id}.html`, productPage(p, i)); count++; }
for (const g of GUIDES) { write(`guides/${g.slug}.html`, guidePage(g)); count++; }
write("guides/index.html", guideIndex()); count++;
write("sitemap.xml", sitemap());

const synced = syncNav();

console.log(`
  ${PRODUCTS.length} product pages
  ${GUIDES.length} guides + index
  ${count} pages generated, sitemap rebuilt, nav synced into ${synced} hand-written page(s)
`);
