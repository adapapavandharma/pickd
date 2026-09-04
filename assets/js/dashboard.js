/* ============================================================
   Pickd — dashboard

   Hand-drawn SVG charts, no charting library. Every chart follows the same
   mark spec: thin marks, hairline solid gridlines, 2px surface gaps doing the
   separating (never a stroke around a mark), selective direct labels, and a
   table-view twin so no value is reachable only by hovering.
   ============================================================ */

import {
  simulate, mergeReal, getRealEvents, clearRealEvents,
  withinDays, previousWindow, totals, byDay, byProduct, byCategory, bySource, SOURCES,
} from "./analytics.js?v=9da3dafb";

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const NS = "http://www.w3.org/2000/svg";

const state = { products: [], rows: [], days: 30, sort: "clicks", dir: -1 };

/* ---------- formatting ---------- */
const nf = new Intl.NumberFormat();
const money = (n) =>
  n >= 10000 ? "$" + (n / 1000).toFixed(1) + "K"
             : n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: n < 100 ? 2 : 0 });
const moneyExact = (n) => n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const pct = (n, d = 1) => (n * 100).toFixed(d) + "%";
const compact = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "K" : nf.format(Math.round(n)));

/* ---------- tiny svg helper ---------- */
function el(tag, attrs = {}, text) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
}

/** Round a max up to a clean axis top, and give back even ticks. */
function ticks(max, count = 4) {
  if (max <= 0) return { top: 1, values: [0, 1] };
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
  const top = Math.ceil(max / step) * step;
  const values = [];
  for (let v = 0; v <= top + 1e-9; v += step) values.push(v);
  return { top, values };
}

/* ---------- tooltip ---------- */
const tip = $("#tip");
function showTip(html, x, y) {
  tip.innerHTML = html;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  const pad = 12;
  let left = x + 14, top = y - r.height - 10;
  if (left + r.width > innerWidth - pad) left = x - r.width - 14;
  if (top < pad) top = y + 18;
  tip.style.left = Math.max(pad, left) + "px";
  tip.style.top = top + "px";
}
const hideTip = () => { tip.hidden = true; };

/* ============================================================
   Chart: area + line, one series, crosshair tooltip
   ============================================================ */
function areaChart(host, data, { value, label, format = compact, tipFormat }) {
  host.innerHTML = "";
  const w = host.clientWidth, h = host.clientHeight;
  if (!w || !h || !data.length) return;

  const m = { top: 14, right: 14, bottom: 26, left: 46 };
  const iw = w - m.left - m.right, ih = h - m.top - m.bottom;

  const svg = el("svg", { width: w, height: h, viewBox: `0 0 ${w} ${h}`, role: "img",
                          "aria-label": `${label}: ${data.length} days` });
  const g = el("g", { transform: `translate(${m.left},${m.top})` });

  const vals = data.map(value);
  const { top, values: tv } = ticks(Math.max(...vals));
  const x = (i) => (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v) => ih - (v / top) * ih;

  // gridlines — hairline, solid, recessive
  for (const t of tv) {
    g.appendChild(el("line", { x1: 0, y1: y(t), x2: iw, y2: y(t), class: "gridline" }));
    g.appendChild(el("text", { x: -10, y: y(t) + 3.5, "text-anchor": "end", class: "ax" }, format(t)));
  }

  const line = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(value(d)).toFixed(1)}`).join("");
  // area fill: the series hue at ~10% — a wash, never a block
  g.appendChild(el("path", { d: `${line}L${x(data.length - 1)},${ih}L${x(0)},${ih}Z`,
                             fill: "var(--s1)", "fill-opacity": ".10" }));
  g.appendChild(el("path", { d: line, fill: "none", stroke: "var(--s1)", "stroke-width": 2,
                             "stroke-linejoin": "round", "stroke-linecap": "round" }));

  g.appendChild(el("line", { x1: 0, y1: ih, x2: iw, y2: ih, class: "axisline" }));

  // x labels: first, middle, last only — never one per point
  const marks = data.length > 2 ? [0, Math.floor(data.length / 2), data.length - 1] : [0, data.length - 1];
  for (const i of marks) {
    const d = data[i].date;
    g.appendChild(el("text", { x: x(i), y: ih + 17, "text-anchor": i === 0 ? "start" : i === data.length - 1 ? "end" : "middle", class: "ax" },
      d.toLocaleDateString(undefined, { month: "short", day: "numeric" })));
  }

  // end marker — >=8px with a 2px surface ring
  const lastY = y(value(data[data.length - 1]));
  g.appendChild(el("circle", { cx: x(data.length - 1), cy: lastY, r: 4.5, fill: "var(--s1)",
                               stroke: "var(--viz-surface)", "stroke-width": 2 }));

  // crosshair layer
  const focus = el("g", { opacity: 0 });
  const vline = el("line", { y1: 0, y2: ih, stroke: "var(--viz-axis)", "stroke-width": 1 });
  const dot = el("circle", { r: 4.5, fill: "var(--s1)", stroke: "var(--viz-surface)", "stroke-width": 2 });
  focus.append(vline, dot);
  g.appendChild(focus);

  const hit = el("rect", { x: 0, y: 0, width: iw, height: ih, fill: "transparent",
                           tabindex: 0, role: "application", "aria-label": `${label}, use arrow keys` });
  let idx = data.length - 1;

  const paint = (i, clientX, clientY) => {
    idx = Math.max(0, Math.min(data.length - 1, i));
    const d = data[idx];
    focus.setAttribute("opacity", 1);
    vline.setAttribute("x1", x(idx)); vline.setAttribute("x2", x(idx));
    dot.setAttribute("cx", x(idx)); dot.setAttribute("cy", y(value(d)));
    const box = hit.getBoundingClientRect();
    showTip(
      `<b>${d.date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</b>` +
      (tipFormat ? tipFormat(d) : `<div class="tip__row"><span>${label}</span><span>${nf.format(value(d))}</span></div>`),
      clientX ?? box.left + x(idx), clientY ?? box.top + y(value(d))
    );
  };

  hit.addEventListener("mousemove", (e) => {
    const box = hit.getBoundingClientRect();
    const i = Math.round(((e.clientX - box.left) / box.width) * (data.length - 1));
    paint(i, e.clientX, e.clientY);
  });
  hit.addEventListener("mouseleave", () => { focus.setAttribute("opacity", 0); hideTip(); });
  hit.addEventListener("focus", () => paint(idx));
  hit.addEventListener("blur", () => { focus.setAttribute("opacity", 0); hideTip(); });
  hit.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); paint(idx + 1); }
    if (e.key === "ArrowLeft")  { e.preventDefault(); paint(idx - 1); }
  });

  g.appendChild(hit);
  svg.appendChild(g);
  host.appendChild(svg);
}

/* ============================================================
   Chart: columns, one series -> one colour (never a value ramp)
   ============================================================ */
function columnChart(host, data, { name, value, format = compact, tipFormat }) {
  host.innerHTML = "";
  const w = host.clientWidth, h = host.clientHeight;
  if (!w || !h || !data.length) return;

  const m = { top: 20, right: 8, bottom: 40, left: 48 };
  const iw = w - m.left - m.right, ih = h - m.top - m.bottom;
  const svg = el("svg", { width: w, height: h, viewBox: `0 0 ${w} ${h}` });
  const g = el("g", { transform: `translate(${m.left},${m.top})` });

  const { top, values: tv } = ticks(Math.max(...data.map(value)));
  const band = iw / data.length;
  const bw = Math.min(24, band - 14);            // cap the bar, let the rest be air
  const y = (v) => ih - (v / top) * ih;

  for (const t of tv) {
    g.appendChild(el("line", { x1: 0, y1: y(t), x2: iw, y2: y(t), class: "gridline" }));
    g.appendChild(el("text", { x: -10, y: y(t) + 3.5, "text-anchor": "end", class: "ax" }, format(t)));
  }

  data.forEach((d, i) => {
    const cx = band * i + band / 2;
    const v = value(d);
    const bh = Math.max(2, ih - y(v));
    // 4px rounded data-end, square at the baseline
    const r = Math.min(4, bh / 2);
    const path = `M${cx - bw / 2},${ih} L${cx - bw / 2},${ih - bh + r}
                  Q${cx - bw / 2},${ih - bh} ${cx - bw / 2 + r},${ih - bh}
                  L${cx + bw / 2 - r},${ih - bh} Q${cx + bw / 2},${ih - bh} ${cx + bw / 2},${ih - bh + r}
                  L${cx + bw / 2},${ih} Z`;
    const bar = el("path", { d: path, fill: "var(--s1)" });
    bar.style.cursor = "pointer";
    bar.addEventListener("mousemove", (e) => showTip(tipFormat(d), e.clientX, e.clientY));
    bar.addEventListener("mouseleave", hideTip);
    g.appendChild(bar);

    // value on the cap
    g.appendChild(el("text", { x: cx, y: ih - bh - 7, "text-anchor": "middle", class: "val" }, format(v)));

    // category name, wrapped to two lines if needed
    const words = String(name(d)).split(" ");
    const lines = words.length > 1 && String(name(d)).length > 9
      ? [words[0], words.slice(1).join(" ")] : [String(name(d))];
    lines.forEach((ln, li) => {
      g.appendChild(el("text", { x: cx, y: ih + 16 + li * 12, "text-anchor": "middle", class: "ax--name" }, ln));
    });
  });

  g.appendChild(el("line", { x1: 0, y1: ih, x2: iw, y2: ih, class: "axisline" }));
  svg.appendChild(g);
  host.appendChild(svg);
}

/* ============================================================
   Chart: horizontal bars, ranked
   ============================================================ */
function barChart(host, data, { name, value, format = compact, tipFormat }) {
  host.innerHTML = "";
  const w = host.clientWidth;
  if (!w || !data.length) return;

  const rowH = 26, gap = 6;
  const m = { top: 4, right: 56, bottom: 4, left: Math.min(200, Math.max(120, w * 0.28)) };
  const h = data.length * (rowH + gap) + m.top + m.bottom;
  host.style.height = h + "px";

  const iw = w - m.left - m.right;
  const svg = el("svg", { width: w, height: h, viewBox: `0 0 ${w} ${h}` });
  const g = el("g", { transform: `translate(${m.left},${m.top})` });
  const max = Math.max(...data.map(value));

  data.forEach((d, i) => {
    const yy = i * (rowH + gap);
    const bh = Math.min(24, rowH);
    const bw = Math.max(2, (value(d) / max) * iw);
    const r = Math.min(4, bw / 2);

    const path = `M0,${yy} L${bw - r},${yy} Q${bw},${yy} ${bw},${yy + r}
                  L${bw},${yy + bh - r} Q${bw},${yy + bh} ${bw - r},${yy + bh} L0,${yy + bh} Z`;
    const bar = el("path", { d: path, fill: "var(--s1)" });
    bar.style.cursor = "pointer";
    bar.addEventListener("mousemove", (e) => showTip(tipFormat(d), e.clientX, e.clientY));
    bar.addEventListener("mouseleave", hideTip);
    g.appendChild(bar);

    // label to the left of the baseline, truncated with an ellipsis
    const label = el("text", { x: -12, y: yy + bh / 2 + 4, "text-anchor": "end", class: "ax--name" }, name(d));
    g.appendChild(label);
    // value at the tip
    g.appendChild(el("text", { x: bw + 9, y: yy + bh / 2 + 4, class: "val" }, format(value(d))));
  });

  svg.appendChild(g);
  host.appendChild(svg);

  // truncate any label that overruns its gutter
  $$("text.ax--name", svg).forEach((t) => {
    const limit = m.left - 16;
    let txt = t.textContent;
    while (t.getComputedTextLength() > limit && txt.length > 4) {
      txt = txt.slice(0, -1);
      t.textContent = txt.trimEnd() + "…";
    }
  });
}

/* ============================================================
   Chart: 100% stacked bar — part-to-whole without a pie
   ============================================================ */
function stackedBar(host, data, { name, value }) {
  host.innerHTML = "";
  const w = host.clientWidth;
  if (!w || !data.length) return;

  const barH = 44, h = barH + 8;
  host.style.height = h + "px";
  const svg = el("svg", { width: w, height: h, viewBox: `0 0 ${w} ${h}` });
  const total = data.reduce((a, d) => a + value(d), 0) || 1;

  const GAP = 2;                                   // the surface gap does the separating
  const usable = w - GAP * (data.length - 1);
  let x = 0;

  data.forEach((d, i) => {
    const seg = (value(d) / total) * usable;
    const first = i === 0, last = i === data.length - 1;
    const r = 5;
    // round only the outer ends of the whole bar
    const path = first
      ? `M${x + r},0 L${x + seg},0 L${x + seg},${barH} L${x + r},${barH} Q${x},${barH} ${x},${barH - r} L${x},${r} Q${x},0 ${x + r},0 Z`
      : last
      ? `M${x},0 L${x + seg - r},0 Q${x + seg},0 ${x + seg},${r} L${x + seg},${barH - r} Q${x + seg},${barH} ${x + seg - r},${barH} L${x},${barH} Z`
      : `M${x},0 L${x + seg},0 L${x + seg},${barH} L${x},${barH} Z`;

    const g = el("g");
    const rect = el("path", { d: path, fill: `var(--s${i + 1})` });
    rect.style.cursor = "pointer";
    rect.addEventListener("mousemove", (e) => showTip(
      `<b>${name(d)}</b><div class="tip__row"><span>Clicks</span><span>${nf.format(value(d))}</span></div>` +
      `<div class="tip__row"><span>Share</span><span>${pct(value(d) / total)}</span></div>`, e.clientX, e.clientY));
    rect.addEventListener("mouseleave", hideTip);
    g.appendChild(rect);

    // Direct label inside the segment — but only if it genuinely fits.
    // A clipped label is worse than no label; the legend and table carry the rest.
    const label = el("text", { x: x + seg / 2, y: barH / 2 + 4, "text-anchor": "middle",
                               "font-size": 12, "font-weight": 600, fill: "#fff" }, pct(value(d), 0));
    g.appendChild(label);
    svg.appendChild(g);

    if (label.getComputedTextLength() + 14 > seg) label.remove();

    x += seg + GAP;
  });

  host.appendChild(svg);
}

/* ---------- sparkline for the stat tiles ---------- */
function sparkline(host, values) {
  host.innerHTML = "";
  const w = host.clientWidth || 140, h = host.clientHeight || 30;
  if (!values.length) return;
  const max = Math.max(...values), min = Math.min(...values);
  const span = max - min || 1;
  const x = (i) => (i / (values.length - 1)) * (w - 2) + 1;
  const y = (v) => h - 3 - ((v - min) / span) * (h - 6);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const svg = el("svg", { width: w, height: h, viewBox: `0 0 ${w} ${h}`, "aria-hidden": "true" });
  svg.appendChild(el("path", { d: `${d}L${x(values.length - 1)},${h}L${x(0)},${h}Z`,
                               fill: "var(--s1)", "fill-opacity": ".09" }));
  svg.appendChild(el("path", { d, fill: "none", stroke: "var(--s1)", "stroke-width": 1.6,
                               "stroke-linejoin": "round", "stroke-linecap": "round" }));
  svg.appendChild(el("circle", { cx: x(values.length - 1), cy: y(values[values.length - 1]), r: 2.6,
                                 fill: "var(--s1)", stroke: "var(--viz-surface)", "stroke-width": 1.5 }));
  host.appendChild(svg);
}

/* ---------- deltas ---------- */
function deltaHTML(now, prev, { good = "up", asPct = false } = {}) {
  if (!prev) return `<span class="delta">—</span> no prior period`;
  const change = (now - prev) / prev;
  const up = change >= 0;
  const dirGood = good === "up" ? up : !up;
  const cls = Math.abs(change) < 0.001 ? "" : dirGood ? "delta--up" : "delta--down";
  const arrow = up ? "↑" : "↓";
  const amount = asPct ? Math.abs(now - prev).toFixed(1) + "pp" : pct(Math.abs(change), 1);
  return `<span class="delta ${cls}">${arrow} ${amount}</span> vs previous ${state.days} days`;
}

/* ---------- simple table builder ---------- */
function simpleTable(host, cols, rows) {
  host.innerHTML = "";
  const t = document.createElement("table");
  t.className = "dtable";
  t.innerHTML =
    `<thead><tr>${cols.map((c, i) => `<th scope="col"${i === 0 ? ' class="th--text"' : ""}>${c.label}</th>`).join("")}</tr></thead>` +
    `<tbody>${rows.map((r) => `<tr>${cols.map((c, i) => `<td${i === 0 ? ' class="td--text"' : ""}>${c.get(r)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  host.appendChild(t);
}

/* ============================================================
   render
   ============================================================ */
function render() {
  const win = withinDays(state.rows, state.days);
  const prevWin = previousWindow(state.rows, state.days);
  const t = totals(win), tPrev = totals(prevWin);
  const days = byDay(win, state.days);
  const products = byProduct(win, state.products);
  const cats = byCategory(win, state.products);
  const sources = bySource(win);

  $("#rangeMeta").textContent =
    `${days[0].date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ` +
    `${days[days.length - 1].date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ` +
    `${nf.format(t.clicks)} clicks`;

  /* hero */
  $("#heroValue").textContent = money(t.commission);
  $("#heroDelta").innerHTML = deltaHTML(t.commission, tPrev.commission);

  /* tiles */
  const tiles = [
    { label: "Clicks", value: nf.format(t.clicks), now: t.clicks, prev: tPrev.clicks, spark: days.map((d) => d.clicks) },
    { label: "Click-through", value: pct(t.ctr, 2), now: t.ctr * 100, prev: tPrev.ctr * 100, asPct: true,
      spark: days.map((d) => (d.impressions ? d.clicks / d.impressions : 0)) },
    { label: "Orders", value: nf.format(t.orders), now: t.orders, prev: tPrev.orders, spark: days.map((d) => d.orders) },
    { label: "Earnings / click", value: moneyExact(t.epc), now: t.epc, prev: tPrev.epc,
      spark: days.map((d) => (d.clicks ? d.commission / d.clicks : 0)) },
  ];
  $("#tiles").innerHTML = tiles.map((k, i) => `
    <div class="tile">
      <span class="tile__label">${k.label}</span>
      <span class="tile__value">${k.value}</span>
      <span class="tile__delta">${deltaHTML(k.now, k.prev, { asPct: k.asPct })}</span>
      <div class="tile__spark" data-spark="${i}"></div>
    </div>`).join("");
  $$("[data-spark]").forEach((n) => sparkline(n, tiles[+n.dataset.spark].spark));

  /* charts */
  areaChart($("#clicksChart"), days, {
    value: (d) => d.clicks, label: "Clicks",
    tipFormat: (d) => `
      <div class="tip__row"><span>Clicks</span><span>${nf.format(d.clicks)}</span></div>
      <div class="tip__row"><span>Orders</span><span>${nf.format(d.orders)}</span></div>
      <div class="tip__row"><span>Commission</span><span>${moneyExact(d.commission)}</span></div>`,
  });

  columnChart($("#categoryChart"), cats, {
    name: (d) => d.category, value: (d) => d.commission, format: (v) => money(v),
    tipFormat: (d) => `<b>${d.category}</b>
      <div class="tip__row"><span>Commission</span><span>${moneyExact(d.commission)}</span></div>
      <div class="tip__row"><span>Clicks</span><span>${nf.format(d.clicks)}</span></div>
      <div class="tip__row"><span>Orders</span><span>${nf.format(d.orders)}</span></div>`,
  });

  stackedBar($("#sourceChart"), sources, { name: (d) => d.source, value: (d) => d.clicks });
  $("#sourceLegend").innerHTML = sources.map((s, i) =>
    `<span><i style="background:var(--s${i + 1})"></i>${s.source} · ${pct(s.share, 0)}</span>`).join("");

  const top = [...products].sort((a, b) => b.clicks - a.clicks).slice(0, 10);
  barChart($("#topChart"), top, {
    name: (d) => d.title, value: (d) => d.clicks, format: (v) => nf.format(v),
    tipFormat: (d) => `<b>${d.title}</b>
      <div class="tip__row"><span>Clicks</span><span>${nf.format(d.clicks)}</span></div>
      <div class="tip__row"><span>Conversion</span><span>${pct(d.conversion)}</span></div>
      <div class="tip__row"><span>Commission</span><span>${moneyExact(d.commission)}</span></div>`,
  });

  /* table twins */
  simpleTable($("#clicksTable"),
    [{ label: "Day", get: (d) => d.date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) },
     { label: "Clicks", get: (d) => nf.format(d.clicks) },
     { label: "Orders", get: (d) => nf.format(d.orders) },
     { label: "Commission", get: (d) => moneyExact(d.commission) }], days);

  simpleTable($("#categoryTable"),
    [{ label: "Category", get: (d) => d.category },
     { label: "Clicks", get: (d) => nf.format(d.clicks) },
     { label: "Orders", get: (d) => nf.format(d.orders) },
     { label: "Commission", get: (d) => moneyExact(d.commission) }], cats);

  simpleTable($("#sourceTable"),
    [{ label: "Channel", get: (d) => d.source },
     { label: "Clicks", get: (d) => nf.format(d.clicks) },
     { label: "Share", get: (d) => pct(d.share) }], sources);

  renderPerfTable(products, t);
}

function renderPerfTable(products, t) {
  const sorted = [...products].sort((a, b) => {
    const av = a[state.sort], bv = b[state.sort];
    return typeof av === "string" ? av.localeCompare(bv) * -state.dir : (av - bv) * state.dir;
  });

  $("#perfTable").querySelector("tbody").innerHTML = sorted.map((p) => `
    <tr>
      <td class="td--text">${p.title}<span class="cat">${p.category}</span></td>
      <td>${nf.format(p.impressions)}</td>
      <td>${nf.format(p.clicks)}</td>
      <td>${pct(p.ctr, 2)}</td>
      <td>${nf.format(p.orders)}</td>
      <td>${pct(p.conversion)}</td>
      <td>${moneyExact(p.epc)}</td>
      <td>${moneyExact(p.commission)}</td>
    </tr>`).join("") +
    `<tr class="totals"><td class="td--text"><strong>All products</strong></td>
      <td><strong>${nf.format(t.impressions)}</strong></td>
      <td><strong>${nf.format(t.clicks)}</strong></td>
      <td><strong>${pct(t.ctr, 2)}</strong></td>
      <td><strong>${nf.format(t.orders)}</strong></td>
      <td><strong>${pct(t.conversion)}</strong></td>
      <td><strong>${moneyExact(t.epc)}</strong></td>
      <td><strong>${moneyExact(t.commission)}</strong></td></tr>`;

  $$("#perfTable th").forEach((th) => {
    if (th.dataset.sort === state.sort) th.setAttribute("aria-sort", state.dir === -1 ? "descending" : "ascending");
    else th.removeAttribute("aria-sort");
  });
}

/* ---------- theme ---------- */
function initTheme() {
  let stored = null;
  try { stored = localStorage.getItem("pickd:theme"); } catch { /* ignore */ }
  document.documentElement.dataset.theme =
    stored || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  $("#theme").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("pickd:theme", next); } catch { /* ignore */ }
    render();   // charts read their colours from CSS vars, so repaint
  });
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
  } catch (e) {
    $("#kpis").innerHTML = `<p style="color:var(--muted)">Could not load the catalogue (${e.message}).</p>`;
    return;
  }

  state.products = data.products || [];
  $$("[data-site]").forEach((n) => { const v = data.site?.[n.dataset.site]; if (v) n.textContent = v; });

  const real = getRealEvents();
  const merged = mergeReal(simulate(state.products, 90), real, state.products);
  state.rows = merged.rows;

  if (merged.realCount) {
    $("#resetReal").hidden = false;
    $("#resetReal").textContent = `Clear my ${merged.realCount} recorded click${merged.realCount === 1 ? "" : "s"}`;
  }

  render();

  /* events */
  $("#range").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-days]");
    if (!b) return;
    state.days = +b.dataset.days;
    $$("#range button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    render();
  });

  $("#perfTable").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-sort]");
    if (!th) return;
    if (state.sort === th.dataset.sort) state.dir *= -1;
    else { state.sort = th.dataset.sort; state.dir = -1; }
    render();
  });

  $("#resetReal").addEventListener("click", () => { clearRealEvents(); location.reload(); });

  /* Charts are sized in pixels, so they must be redrawn when the box changes.
     Two of them set their own height, which changes the observed box — so react
     to WIDTH only, otherwise the observer feeds itself. */
  let raf, lastWidth = $(".charts").clientWidth;
  new ResizeObserver((entries) => {
    const w = Math.round(entries[0].contentRect.width);
    if (w === lastWidth || !w) return;
    lastWidth = w;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(render);
  }).observe($(".charts"));
}

boot();
