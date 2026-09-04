#!/usr/bin/env node
/* ============================================================
   Stamp local asset URLs in index.html with a content hash.

   GitHub Pages serves assets with Cache-Control: max-age=600, so for ten
   minutes after a deploy a returning visitor can be handed a fresh index.html
   and a stale stylesheet. Any CSS/JS pair that has to agree with each other
   will then disagree.

   This rewrites   assets/css/styles.css
   into           assets/css/styles.css?v=a1b2c3d4
   where the hash is of the file's own contents, so the URL changes only when
   the file does, and returning visitors keep their cached copy when it hasn't.

   Runs in CI before upload. Safe to run locally too — it is idempotent.
   ============================================================ */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = path.join(ROOT, "index.html");

let html = fs.readFileSync(HTML, "utf8");
let stamped = 0;

// href="assets/..." or src="assets/..." for .css and .js, with or without an existing ?v=
html = html.replace(
  /(href|src)="(assets\/[^"?]+\.(?:css|js))(?:\?v=[a-f0-9]+)?"/g,
  (match, attr, rel) => {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) {
      console.warn(`  warn  referenced but missing: ${rel}`);
      return match;
    }
    const hash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 8);
    stamped++;
    return `${attr}="${rel}?v=${hash}"`;
  }
);

fs.writeFileSync(HTML, html);
console.log(`\n  stamped ${stamped} asset reference(s) with a content hash\n`);
