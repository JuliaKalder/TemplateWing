#!/usr/bin/env node
/**
 * Portable source-archive builder for the ATN review team.
 *
 * Replaces the Windows-only build-source-zip.ps1, which kept its own hand-
 * maintained copy of the file list and had drifted eight files behind the XPI
 * (prompt-dialog/, template-lint.js, usage-stats.js, ui-helpers.js,
 * compose-utils.js, message-utils.js, prompt-collector.js, welcome/). A
 * reviewer would have received source that cannot produce the submitted XPI.
 *
 * The archive is now derived, not listed: every shipped file comes from
 * scripts/xpi-files.mjs, and the supporting build/test material is collected
 * by walking directories. Adding a file to the XPI therefore adds it here too.
 *
 * Usage:
 *   node scripts/build-source-zip.mjs [--out-dir ../]
 *
 * Writes templatewing-<version>-source.zip.
 * Exits 0 on success; non-zero with a clear message on failure.
 */

import { readFileSync, readdirSync, mkdirSync, rmSync, statSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { XPI_FILES } from "./xpi-files.mjs";
import { sourceDateEpoch, stageFiles, deterministicZip } from "./zip-utils.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

// Individual non-shipped files a reviewer needs to build and verify the XPI.
const EXTRA_FILES = [
  "SOURCE_README.md",
  "README.md",
  "package.json",
  "package-lock.json",
  "playwright.config.mjs",
  ".prettierrc.json",
  ".editorconfig",
  "build-xpi.ps1",
  "build-source-zip.ps1",
];

// Directories copied wholesale. Everything under them is build tooling or
// tests — no generated output lives here, so a plain walk is safe.
const EXTRA_DIRS = ["scripts", "tests", ".github/workflows"];

// OS and editor droppings must never reach a reviewer. `.DS_Store` in
// particular already exists at the repo root on macOS checkouts and would be
// picked up the moment one appears under a walked directory.
const JUNK = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(join(root, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (JUNK.has(entry.name) || entry.name.startsWith(".")) continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(rel));
    else out.push(rel);
  }
  return out;
}

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

function collectFiles() {
  const files = [...XPI_FILES, ...EXTRA_FILES];
  for (const dir of EXTRA_DIRS) files.push(...walk(dir));
  // De-duplicate in case an extra path also ships in the XPI.
  return [...new Set(files)];
}

function verifyFilesExist(files) {
  const missing = [];
  for (const f of files) {
    try {
      statSync(join(root, f));
    } catch {
      missing.push(f);
    }
  }
  if (missing.length > 0) {
    console.error("Missing required files in source archive list:");
    for (const f of missing) console.error("  - " + f);
    process.exit(3);
  }
}

function sha256(file) {
  const hash = createHash("sha256");
  hash.update(readFileSync(file));
  return hash.digest("hex");
}

const { outDir } = parseArgs(process.argv);
const version = readManifestVersion();
const files = collectFiles();
verifyFilesExist(files);
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `templatewing-${version}-source.zip`);

// Recreate from scratch each run so partial appends from prior failures can't
// leak in: `zip` UPDATES an existing archive rather than replacing it, so a
// failed delete would silently preserve stale entries.
rmSync(outPath, { force: true });

// Packaged with the same determinism as the XPI. This archive is attached to
// every release and handed to ATN reviewers, so it should not carry the
// packager's uid/gid or change hash just because the files were read.
const epoch = sourceDateEpoch();
const staging = stageFiles(root, files, epoch);
try {
  deterministicZip(outPath, staging, files);
} finally {
  rmSync(staging, { recursive: true, force: true });
}

const size = statSync(outPath).size;

console.log("");
console.log(`Created: ${relative(process.cwd(), outPath)}`);
console.log(`Files:   ${files.length} (${XPI_FILES.length} of them shipped in the XPI)`);
console.log(`Size:    ${(size / 1024).toFixed(1)} KB`);
console.log(`SHA-256: ${sha256(outPath)}`);
