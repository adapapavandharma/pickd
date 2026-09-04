/* Minimal static server for local preview: node scripts/serve.mjs [port] */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.argv[2]) || 4173;
const TYPES = { ".html":"text/html", ".css":"text/css", ".js":"text/javascript", ".json":"application/json",
  ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".png":"image/png", ".webp":"image/webp", ".svg":"image/svg+xml",
  ".ico":"image/x-icon", ".txt":"text/plain", ".xml":"application/xml" };

http.createServer((req, res) => {
  const clean = decodeURIComponent(req.url.split("?")[0]);
  let file = path.join(ROOT, clean === "/" ? "index.html" : clean);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end("forbidden"); return; }
  fs.stat(file, (err, st) => {
    if (err || st.isDirectory()) { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
}).listen(PORT, () => console.log(`\n  Pickd running -> http://localhost:${PORT}\n`));
