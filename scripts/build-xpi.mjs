#!/usr/bin/env node
/**
 * Portable, byte-reproducible XPI builder. Used locally and from
 * .github/workflows/release.yml.
 *
 * Usage:
 *   node scripts/build-xpi.mjs [--out-dir ../]
 *
 * Writes templatewing-<version>.xpi (version read from manifest.json).
 * Exits 0 on success; non-zero with a clear message on failure.
 *
 * Two builds of the same commit produce a byte-identical XPI on any machine,
 * so the published SHA-256 can be verified rather than taken on trust. See
 * scripts/zip-utils.mjs for what that requires and why; .gitattributes pins
 * line endings to LF, without which a Windows clone would hash differently.
 */

import { readFileSync, mkdirSync, writeFileSync, statSync, rmSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { XPI_FILES } from "./xpi-files.mjs";
import { sourceDateEpoch, stageFiles, deterministicZip } from "./zip-utils.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const FILES = XPI_FILES;

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

// Recreate from scratch each run so partial appends from prior failures can't
// leak in: `zip` UPDATES an existing archive rather than replacing it, so a
// failed delete would silently preserve stale entries.
rmSync(outPath, { force: true });

const epoch = sourceDateEpoch();
const staging = stageFiles(root, FILES, epoch);
try {
  deterministicZip(outPath, staging, FILES);
} finally {
  rmSync(staging, { recursive: true, force: true });
}

const size = statSync(outPath).size;
const digest = sha256(outPath);

console.log("");
console.log(`Created: ${relative(process.cwd(), outPath)}`);
console.log(`Size:    ${(size / 1024).toFixed(1)} KB`);
console.log(`SHA-256: ${digest}`);
console.log(`Stamped: ${new Date(epoch * 1000).toISOString()} (SOURCE_DATE_EPOCH=${epoch})`);

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
