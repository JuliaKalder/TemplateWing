#!/usr/bin/env node
/**
 * Portable XPI builder. Replaces the Windows-only build-xpi.ps1 — both produce
 * the same file list. Used locally and from .github/workflows/release.yml.
 *
 * Usage:
 *   node scripts/build-xpi.mjs [--out-dir ../]
 *
 * Writes templatewing-<version>.xpi (version read from manifest.json).
 * Exits 0 on success; non-zero with a clear message on failure.
 */

import { readFileSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

// The single source of truth for the XPI file list. Anything not listed
// here is excluded — tests, scripts, lockfiles, screenshots, source maps, etc.
const FILES = [
  "manifest.json",
  "background.html",
  "background.js",
  "LICENSE",
  "modules/template-store.js",
  "modules/template-insert.js",
  "modules/template-lint.js",
  "modules/validation.js",
  "modules/compose-script.js",
  "modules/compose-utils.js",
  "modules/message-utils.js",
  "modules/ui-helpers.js",
  "modules/prompt-collector.js",
  "modules/usage-stats.js",
  "popup/popup.html",
  "popup/popup.css",
  "popup/popup.js",
  "options/options.html",
  "options/options.css",
  "options/options.js",
  "prompt-dialog/dialog.html",
  "prompt-dialog/dialog.css",
  "prompt-dialog/dialog.js",
  "images/icon-16.png",
  "images/icon-32.png",
  "images/icon-64.png",
  "images/icon-128.png",
  "_locales/en/messages.json",
  "_locales/de/messages.json",
  "_locales/fr/messages.json",
  "_locales/es/messages.json",
  "_locales/it/messages.json",
  "_locales/nl/messages.json",
  "_locales/pt/messages.json",
];

function parseArgs(argv) {
  const opts = { outDir: resolve(root, "..") };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--out-dir" && argv[i + 1]) {
      opts.outDir = resolve(argv[++i]);
    } else if (argv[i].startsWith("--out-dir=")) {
      opts.outDir = resolve(argv[i].slice("--out-dir=".length));
    }
  }
  return opts;
}

function readManifestVersion() {
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf-8"));
  if (!manifest.version) {
    console.error("manifest.json has no `version` field");
    process.exit(2);
  }
  return manifest.version;
}

function verifyFilesExist() {
  const missing = [];
  for (const f of FILES) {
    try {
      statSync(join(root, f));
    } catch {
      missing.push(f);
    }
  }
  if (missing.length > 0) {
    console.error("Missing required files in XPI manifest list:");
    for (const f of missing) console.error("  - " + f);
    process.exit(3);
  }
}

function buildZip(outPath) {
  // Use the platform `zip` binary for cross-platform deterministic output.
  // It exists on macOS, Linux, and the GitHub `ubuntu-latest` runner. We
  // intentionally do not depend on a Node-side zip library to keep this
  // script dependency-free in line with the project's vanilla policy.
  const r = spawnSync("zip", ["-r", outPath, ...FILES], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) {
    console.error("zip failed — install the `zip` utility or use a runner that has it");
    process.exit(4);
  }
}

function sha256(file) {
  const hash = createHash("sha256");
  hash.update(readFileSync(file));
  return hash.digest("hex");
}

const { outDir } = parseArgs(process.argv);
const version = readManifestVersion();
verifyFilesExist();
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `templatewing-${version}.xpi`);

// Recreate from scratch each run so partial appends from prior failures
// can't leak in.
try {
  if (statSync(outPath)) {
    spawnSync("rm", ["-f", outPath]);
  }
} catch {
  /* file doesn't exist — fine */
}

buildZip(outPath);

const size = statSync(outPath).size;
const digest = sha256(outPath);

console.log("");
console.log(`Created: ${relative(process.cwd(), outPath)}`);
console.log(`Size:    ${(size / 1024).toFixed(1)} KB`);
console.log(`SHA-256: ${digest}`);

// Emit machine-readable output for CI when invoked under GitHub Actions.
if (process.env.GITHUB_OUTPUT) {
  const lines = [
    `xpi_path=${outPath}`,
    `xpi_version=${version}`,
    `xpi_size=${size}`,
    `xpi_sha256=${digest}`,
  ];
  writeFileSync(process.env.GITHUB_OUTPUT, lines.join("\n") + "\n", { flag: "a" });
}
