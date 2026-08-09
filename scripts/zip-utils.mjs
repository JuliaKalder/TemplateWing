/**
 * Deterministic zip packaging, shared by scripts/build-xpi.mjs and
 * scripts/build-source-zip.mjs.
 *
 * A zip archive embeds four things that differ per machine and per run:
 *
 *   1. Per-file modification times — checkout times, different on every clone.
 *   2. The 0x5455 "universal time" extra field, which also records *access*
 *      times: reading a file changes the archive.
 *   3. The 0x7875 extra field, which records the packager's uid/gid.
 *   4. The DOS timestamp encoding, which is local time.
 *
 * Plus one that `zip -X` does NOT cover: the Unix file mode in the central
 * directory's external-attributes word. Git checks files out as 0666 & ~umask,
 * so the packager's umask would otherwise land in the hash.
 *
 * Staging into a scratch directory keeps the working tree untouched — stamping
 * the real files would clobber the user's timestamps.
 */

import { mkdirSync, mkdtempSync, copyFileSync, chmodSync, utimesSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

// 2020-01-01T00:00:00Z. Any fixed value works; zip's DOS timestamps cover
// 1980-01-01 through 2107-12-31 and silently wrap outside that range.
export const DEFAULT_SOURCE_DATE_EPOCH = 1577836800;
const MIN_EPOCH = 315532800; // 1980-01-01T00:00:00Z
const MAX_EPOCH = 4354819199; // 2107-12-31T23:59:59Z

/**
 * Resolve SOURCE_DATE_EPOCH (https://reproducible-builds.org/docs/source-date-epoch/),
 * falling back to the fixed default. Exits with a clear message on a value the
 * DOS timestamp field cannot represent — otherwise the build would silently
 * stamp a wrapped date while printing the one the user asked for.
 */
export function sourceDateEpoch() {
  const raw = process.env.SOURCE_DATE_EPOCH;
  if (!raw) return DEFAULT_SOURCE_DATE_EPOCH;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < MIN_EPOCH || parsed > MAX_EPOCH) {
    console.error(
      `SOURCE_DATE_EPOCH must be a whole Unix timestamp between ${MIN_EPOCH} ` +
        `(1980-01-01) and ${MAX_EPOCH} (2107-12-31), got: ${raw}`
    );
    process.exit(5);
  }
  return parsed;
}

/** Copy `files` into a scratch dir, stamped with one mtime and mode 0644. */
export function stageFiles(root, files, epoch) {
  const staging = mkdtempSync(join(tmpdir(), "templatewing-pkg-"));
  const stamp = new Date(epoch * 1000);
  for (const f of files) {
    const dest = join(staging, f);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(root, f), dest);
    chmodSync(dest, 0o644);
    utimesSync(dest, stamp, stamp);
  }
  return staging;
}

/**
 * Zip `files` from `staging` into `outPath`.
 *
 * Uses the platform `zip` binary rather than a Node zip library, keeping these
 * scripts dependency-free in line with the project's vanilla policy. `-X` drops
 * the 0x5455 and 0x7875 extra fields; TZ=UTC pins the DOS timestamp encoding;
 * `files` is passed in list order so entry ordering is fixed too.
 */
export function deterministicZip(outPath, staging, files) {
  const r = spawnSync("zip", ["-X", "-r", outPath, ...files], {
    cwd: staging,
    stdio: "inherit",
    env: { ...process.env, TZ: "UTC" },
  });
  if (r.status !== 0) {
    console.error("zip failed — install the `zip` utility or use a runner that has it");
    process.exit(4);
  }
}
