#!/usr/bin/env node
/* ============================================================
   Stamp asset URLs with a content hash.

   GitHub Pages serves assets with Cache-Control: max-age=600, so for ten
   minutes after a deploy a returning visitor can be handed a fresh page and a
   stale stylesheet. Any CSS/JS pair that has to agree with each other will
   then disagree — which is exactly how this site once rendered every product
   invisible.

   Two levels need stamping:

     1. Every <link href> and <script src> in every .html file.
     2. Bare ES-module imports *between* the scripts — a stamped app.js is no
        use if the analytics.js it imports is served from cache.

   Order matters. A module's own hash changes when its import specifiers are
   rewritten, so leaf modules are hashed and their importers rewritten before
   any importer is itself hashed.

   Idempotent: re-running replaces an existing ?v= rather than appending.
   ============================================================ */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Modules that are imported by other modules, in dependency order (leaves first). */
const SHARED_MODULES = ["assets/js/analytics.js"];

const hashOf = (rel) =>
  crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, rel))).digest("hex").slice(0, 8);

const htmlFiles = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"));
const jsFiles = fs.existsSync(path.join(ROOT, "assets/js"))
  ? fs.readdirSync(path.join(ROOT, "assets/js")).filter((f) => f.endsWith(".js")).map((f) => `assets/js/${f}`)
  : [];

let stamped = 0;

/* ---- 1. rewrite module-to-module imports, leaves first ---- */
for (const mod of SHARED_MODULES) {
  if (!fs.existsSync(path.join(ROOT, mod))) continue;
  const hash = hashOf(mod);
  const base = path.basename(mod);
  // matches:  from "./analytics.js"  |  from "./analytics.js?v=abc12345"
  const re = new RegExp(`(from\\s+["'](?:\\./)?)${base.replace(".", "\\.")}(?:\\?v=[a-f0-9]+)?(["'])`, "g");

  for (const js of jsFiles) {
    if (js === mod) continue;
    const file = path.join(ROOT, js);
    const src = fs.readFileSync(file, "utf8");
    const next = src.replace(re, `$1${base}?v=${hash}$2`);
    if (next !== src) { fs.writeFileSync(file, next); stamped++; }
  }
}

/* ---- 2. rewrite <link href> / <script src> in every page ---- */
for (const page of htmlFiles) {
  const file = path.join(ROOT, page);
  const src = fs.readFileSync(file, "utf8");

  const next = src.replace(
    /(href|src)="(assets\/[^"?]+\.(?:css|js))(?:\?v=[a-f0-9]+)?"/g,
    (match, attr, rel) => {
      if (!fs.existsSync(path.join(ROOT, rel))) {
        console.warn(`  warn  referenced but missing: ${rel} (in ${page})`);
        return match;
      }
      stamped++;
      return `${attr}="${rel}?v=${hashOf(rel)}"`;
    }
  );

  if (next !== src) fs.writeFileSync(file, next);
}

console.log(`\n  stamped ${stamped} reference(s) across ${htmlFiles.length} page(s)\n`);
