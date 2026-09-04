#!/usr/bin/env node
/* Catalogue sanity check. Runs in CI before deploy, and locally any time. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const doc = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "products.json"), "utf8"));

const errors = [];
const warnings = [];

if (!Array.isArray(doc.products) || doc.products.length === 0) {
  errors.push("products.json contains no products");
}

if (!doc.site?.disclosure) {
  errors.push("site.disclosure is missing — an affiliate disclosure is legally required");
}

const seen = new Set();

for (const [i, p] of (doc.products || []).entries()) {
  const at = `products[${i}]${p.id ? ` (${p.id})` : ""}`;

  for (const field of ["id", "title", "url", "image"]) {
    if (!p[field]) errors.push(`${at} is missing "${field}"`);
  }

  if (p.id) {
    if (seen.has(p.id)) errors.push(`${at} duplicates an earlier id`);
    seen.add(p.id);
  }

  if (p.image && !p.image.startsWith("http")) {
    const file = path.join(ROOT, p.image);
    if (!fs.existsSync(file)) errors.push(`${at} image not found on disk: ${p.image}`);
  }

  if (p.url && p.url.includes("amazon.") && !/[?&]tag=/.test(p.url)) {
    warnings.push(`${at} Amazon link has no affiliate tag — that click earns nothing`);
  }

  if (p.price != null && typeof p.price !== "number") {
    errors.push(`${at} price must be a number or null, got ${typeof p.price}`);
  }

  if (!p.blurb) warnings.push(`${at} has no blurb — the card will look empty`);
}

for (const w of warnings) console.log(`  warn  ${w}`);

if (errors.length) {
  console.error(`\n  ${errors.length} problem(s) found:\n`);
  for (const e of errors) console.error(`  error  ${e}`);
  console.error("");
  process.exit(1);
}

console.log(`\n  ${doc.products.length} products OK${warnings.length ? ` (${warnings.length} warning(s))` : ""}\n`);
