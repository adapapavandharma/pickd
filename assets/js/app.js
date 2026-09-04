/* ============================================================
   Pickd — storefront runtime
   Pure ES module, no dependencies. Data comes from data/products.json.
   ============================================================ */

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  site: {},
  products: [],
  category: "All",
  query: "",
  sort: "featured",
};

/* ---------- theme ---------- */
const THEME_KEY = "pickd:theme";

function readStored(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStored(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode — ignore */ }
}

function initTheme() {
  const stored = readStored(THEME_KEY);
  const prefersDark = matchMedia("(prefers-color-scheme: dark)").matches;
  setTheme(stored || (prefersDark ? "dark" : "light"));

  $("#theme").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    setTheme(next);
    writeStored(THEME_KEY, next);
  });
}
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
}

/* ---------- formatting ---------- */
const money = (n, currency = "USD") =>
  typeof n === "number"
    ? new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(n)
    : "";

function priceHTML(p) {
  // No price unless it came from PA-API. Amazon's Associates terms require live
  // pricing, so a stale hard-coded number is worse than none at all.
  if (p.price == null) return `<span class="price price--live">Live price on Amazon</span>`;
  const now = money(p.price, p.currency);
  const was = p.listPrice && p.listPrice > p.price ? `<s>${money(p.listPrice, p.currency)}</s>` : "";
  return `<span class="price">${now}${was}</span>`;
}

function starsHTML(rating) {
  if (!rating) return "";
  const pct = Math.max(0, Math.min(100, (rating / 5) * 100));
  return `<span class="stars" aria-hidden="true">★★★★★<i style="width:${pct}%">★★★★★</i></span>`;
}

const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- rendering ---------- */
function cardHTML(p, i) {
  const badge = p.badge
    ? `<span class="badge ${p.badgeStyle === "gold" ? "badge--gold" : p.badgeStyle === "deal" ? "badge--deal" : ""}">${esc(p.badge)}</span>`
    : "";

  const reviews = p.reviews ? `${p.rating ?? ""} · ${Intl.NumberFormat().format(p.reviews)} ratings` : "";

  return `
  <article class="card" style="--d:${Math.min(i, 11) * 55}ms" data-id="${esc(p.id)}">
    ${badge}
    <div class="card__media loading" data-open="${esc(p.id)}" role="button" tabindex="0" aria-label="View details for ${esc(p.title)}">
      <img src="${esc(p.image)}" alt="${esc(p.title)}" decoding="async" data-loading
           loading="${i < 4 ? "eager" : "lazy"}" fetchpriority="${i < 4 ? "high" : "auto"}">
    </div>
    <div class="card__body">
      <span class="card__cat">${esc(p.category || "Pick")}</span>
      <h3 class="card__title">${esc(p.title)}</h3>
      <p class="card__blurb">${esc(p.blurb || "")}</p>
      ${p.rating ? `<div class="rating">${starsHTML(p.rating)}<span>${esc(reviews)}</span></div>` : ""}
      <div class="card__foot">
        ${priceHTML(p)}
        <a class="card__cta" href="${esc(p.url)}" target="_blank" rel="nofollow sponsored noopener">
          View
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>
        </a>
      </div>
    </div>
  </article>`;
}

function visible() {
  const q = state.query.trim().toLowerCase();
  let list = state.products.filter((p) => {
    const inCat = state.category === "All" || p.category === state.category;
    if (!inCat) return false;
    if (!q) return true;
    return [p.title, p.blurb, p.category, p.brand, ...(p.features || [])]
      .filter(Boolean).join(" ").toLowerCase().includes(q);
  });

  const by = {
    "price-asc":  (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
    "price-desc": (a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity),
    rating:       (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
    title:        (a, b) => a.title.localeCompare(b.title),
    featured:     (a, b) => (a.order ?? 999) - (b.order ?? 999),
  }[state.sort];

  return list.sort(by);
}

function render() {
  const list = visible();
  const grid = $("#grid");

  grid.innerHTML = list.map(cardHTML).join("");
  $("#count").textContent = `${list.length} ${list.length === 1 ? "pick" : "picks"}`;
  $("#empty").hidden = list.length > 0;

  $$(".card__media img", grid).forEach((img) => {
    const done = () => {
      img.removeAttribute("data-loading");
      img.parentElement.classList.remove("loading");
    };
    if (img.complete && img.naturalWidth) done();
    else {
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", () => {
        done();
        img.src =
          "data:image/svg+xml," +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 250"><rect width="200" height="250" fill="#eee6da"/><text x="100" y="130" font-family="serif" font-size="15" fill="#a99b8a" text-anchor="middle">image unavailable</text></svg>`
          );
      }, { once: true });
    }
  });

  revealOnScroll(grid);
}

/* Scroll-reveal, armed only when we can actually deliver it. The .js-reveal class
   is what hides the cards, so if any of this is unavailable they simply stay visible. */
function revealOnScroll(grid) {
  const cards = $$(".card", grid);
  if (!cards.length) return;

  const canReveal =
    "IntersectionObserver" in window &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!canReveal) return;

  document.documentElement.classList.add("js-reveal");

  // Safety net: if the observer has not reported within 1.2s — a backgrounded tab,
  // a throttled frame loop — drop the reveal entirely. Removing the class restores
  // the plain visible state rather than starting a transition, because a tab that
  // is not painting will not advance transitions either.
  const failsafe = setTimeout(() => {
    document.documentElement.classList.remove("js-reveal");
  }, 1200);

  const io = new IntersectionObserver((entries, obs) => {
    clearTimeout(failsafe);
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("in"); obs.unobserve(e.target); }
    });
  }, { rootMargin: "200px 0px -40px 0px" });

  cards.forEach((c) => io.observe(c));
}

function renderChips() {
  const cats = ["All", ...new Set(state.products.map((p) => p.category).filter(Boolean))];
  $("#chips").innerHTML = cats
    .map((c) => `<button class="chip" type="button" aria-pressed="${c === state.category}" data-cat="${esc(c)}">${esc(c)}</button>`)
    .join("");
}

/* ---------- detail sheet ---------- */
function openSheet(id) {
  const p = state.products.find((x) => x.id === id);
  if (!p) return;

  $("#sheetBody").innerHTML = `
    <div class="sheet__media"><img src="${esc(p.image)}" alt="${esc(p.title)}"></div>
    <div class="sheet__info">
      <span class="card__cat">${esc(p.category || "Pick")}</span>
      <h2>${esc(p.title)}</h2>
      ${p.rating ? `<div class="rating">${starsHTML(p.rating)}<span>${p.rating} out of 5${p.reviews ? ` · ${Intl.NumberFormat().format(p.reviews)} ratings` : ""}</span></div>` : ""}
      <p>${esc(p.description || p.blurb || "")}</p>
      ${p.features?.length ? `<ul class="spec">${p.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
      ${p.drawback ? `<p><strong>Where it falls down:</strong> ${esc(p.drawback)}</p>` : ""}
      <div class="sheet__price">${priceHTML(p)}</div>
      <a class="btn btn--solid btn--block" href="${esc(p.url)}" target="_blank" rel="nofollow sponsored noopener">
        Check price on ${esc(p.merchant || "Amazon")}
      </a>
      <p class="sheet__meta">Affiliate link · price and availability may have changed since ${esc(p.checkedAt || "last check")}.</p>
    </div>`;

  $("#sheet").showModal();
}

/* ---------- boot ---------- */
async function boot() {
  initTheme();
  $("#year").textContent = new Date().getFullYear();

  let data;
  try {
    const res = await fetch("data/products.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    $("#grid").innerHTML = `<p style="color:var(--muted)">Could not load the shelf (${esc(err.message)}). If you are opening this file directly, run a local server instead: <code>npx serve</code></p>`;
    return;
  }

  state.site = data.site || {};
  state.products = (data.products || []).map((p, i) => ({ order: i, ...p }));

  $$("[data-site]").forEach((el) => {
    const v = state.site[el.dataset.site];
    if (v) el.textContent = v;
  });
  if (state.site.brand) document.title = `${state.site.brand} — things worth owning`;

  renderChips();
  render();

  /* events */
  $("#chips").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    state.category = chip.dataset.cat;
    $$(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
    render();
  });

  let t;
  $("#q").addEventListener("input", (e) => {
    clearTimeout(t);
    t = setTimeout(() => { state.query = e.target.value; render(); }, 130);
  });

  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; render(); });

  $("#clear").addEventListener("click", () => {
    state.query = ""; state.category = "All"; $("#q").value = "";
    $$(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.cat === "All")));
    render();
  });

  $("#grid").addEventListener("click", (e) => {
    const media = e.target.closest("[data-open]");
    if (media) openSheet(media.dataset.open);
  });
  $("#grid").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const media = e.target.closest("[data-open]");
    if (media) { e.preventDefault(); openSheet(media.dataset.open); }
  });

  $("#sheetClose").addEventListener("click", () => $("#sheet").close());
  $("#sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") $("#sheet").close(); });

  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== $("#q")) { e.preventDefault(); $("#q").focus(); }
  });

  const topbar = $("#topbar");
  addEventListener("scroll", () => topbar.classList.toggle("is-stuck", scrollY > 12), { passive: true });
}

boot();
