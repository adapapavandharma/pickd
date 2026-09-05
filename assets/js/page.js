/* ============================================================
   Pickd — shared runtime for the generated pages

   Product pages and guides are fully server-rendered: every word is in the
   HTML before this file loads, and the page is complete with JavaScript
   switched off. This only adds the things that genuinely need a runtime —
   the theme toggle, the year, and affiliate-click recording.
   ============================================================ */

import { recordClick } from "./analytics.js?v=9da3dafb";

const THEME_KEY = "pickd:theme";

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const save = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

/* theme — matches the storefront, shares the same stored preference */
const stored = read(THEME_KEY);
document.documentElement.dataset.theme =
  stored || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

document.getElementById("theme")?.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  save(THEME_KEY, next);
});

const year = document.getElementById("year");
if (year) year.textContent = new Date().getFullYear();

/* topbar hairline on scroll */
const topbar = document.getElementById("topbar");
if (topbar) {
  addEventListener("scroll", () => topbar.classList.toggle("is-stuck", scrollY > 12), { passive: true });
}

/* Channel attribution, same rules as the storefront. */
function visitSource() {
  const utm = new URLSearchParams(location.search).get("utm_source");
  if (utm) {
    const u = utm.toLowerCase();
    if (u.includes("news") || u.includes("email")) return "Newsletter";
    if (/twitter|x\.com|insta|facebook|reddit|tiktok|pinterest|linkedin/.test(u)) return "Social";
    return "Referral";
  }
  const ref = document.referrer;
  if (!ref) return "Direct";
  try {
    const host = new URL(ref).hostname.replace(/^www\./, "");
    if (host === location.hostname) return "Direct";
    if (/google|bing|duckduckgo|yahoo|ecosia|brave/.test(host)) return "Organic search";
    if (/twitter|x\.com|instagram|facebook|reddit|tiktok|pinterest|linkedin|youtube/.test(host)) return "Social";
    return "Referral";
  } catch { return "Direct"; }
}

/* Record outbound affiliate clicks. The ASIN is recoverable from the link
   itself here, so these pages need no embedded catalogue to attribute a click. */
const source = visitSource();
document.addEventListener("click", (e) => {
  const link = e.target.closest('a[rel~="sponsored"]');
  if (!link) return;
  const asin = link.href.match(/\/dp\/([A-Z0-9]{10})/i)?.[1];
  if (asin) recordClick(asin.toUpperCase(), source);
});

/* Section reveal, fail-safe in the same way as the shelf: the class that hides
   things is only added once an observer is confirmed running, and a timeout
   removes it outright if the observer never reports. */
const sections = [...document.querySelectorAll(".article__body > section")];
if (sections.length && "IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  document.documentElement.classList.add("js-reveal");
  const failsafe = setTimeout(() => document.documentElement.classList.remove("js-reveal"), 1200);
  const io = new IntersectionObserver((entries, obs) => {
    clearTimeout(failsafe);
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); obs.unobserve(e.target); }
  }, { rootMargin: "200px 0px -40px 0px" });
  sections.forEach((s) => io.observe(s));
}
