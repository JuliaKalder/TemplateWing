#!/usr/bin/env node
/**
 * Tiny dependency-free static file server used by Playwright UI tests.
 * Serves the repo root over HTTP so the popup/options pages can resolve
 * their relative ES-module imports — Chromium blocks cross-file `file://`
 * module loads by default and the `--allow-file-access-from-files` flag is
 * unreliable across versions, so we serve over HTTP for determinism.
 *
 * Reads `PORT` from the environment (default 4173). Exits 0 on SIGTERM,
 * which lets Playwright's `webServer` lifecycle hook clean up cleanly.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, resolve, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(here, "../..");
const port = Number(process.env.PORT) || 4173;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    // Defend against `..` path traversal — normalize, then verify the
    // resolved absolute path is still inside `root`.
    const safePath = normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, "");
    const filePath = resolve(root, safePath || "index.html");
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      return res.end("forbidden");
    }
    const info = await stat(filePath).catch(() => null);
    if (!info || !info.isFile()) {
      res.writeHead(404);
      return res.end("not found");
    }
    res.writeHead(200, {
      "content-type": MIME[extname(filePath).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(await readFile(filePath));
  } catch (err) {
    res.writeHead(500);
    res.end(String(err && err.message ? err.message : err));
  }
}).listen(port, () => {
  console.log(`UI test static server listening on http://127.0.0.1:${port}`);
});
