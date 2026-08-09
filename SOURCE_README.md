# TemplateWing — Source Code & Build Instructions

## Overview

TemplateWing is a Thunderbird 128+ MailExtension (WebExtension-based).
The source code is plain, unminified, untranspiled vanilla JavaScript.
No bundler, transpiler, minifier, or preprocessor is used. The files
inside the XPI are the source files as-is.

## Build Environment

- **OS:** macOS, Linux, or Windows
- **Required software:** Node.js 20+ and the `zip` command-line utility.
  `zip` ships with macOS and most Linux distributions; on Windows it is
  available through Git Bash or WSL.
- **Dependencies:** none are needed to build. The only devDependency
  (`@playwright/test`) is used by the optional UI test suite and is not
  bundled into the XPI.

## Building the XPI

```bash
node scripts/build-xpi.mjs
```

This writes `templatewing-<version>.xpi` to the parent directory and
prints its size and SHA-256. The version is read from `manifest.json`.

To write it somewhere else:

```bash
node scripts/build-xpi.mjs --out-dir /some/path
```

Windows users can run `build-xpi.ps1`, which delegates to the same
Node script.

The exact file list lives in `scripts/xpi-files.mjs` and is the single
source of truth: `scripts/build-xpi.mjs` packages precisely that list,
and `scripts/build-source-zip.mjs` packages that list plus the build and
test files in this archive.

## Verifying the build

The build is byte-reproducible. Building from this archive yields an XPI
with the same SHA-256 as the submitted one, on any machine, in any
timezone:

```bash
node scripts/build-xpi.mjs --out-dir /tmp/verify
sha256sum /tmp/verify/templatewing-<version>.xpi   # macOS: shasum -a 256
```

Compare that against the SHA-256 printed by the build and stated in the
review notes. If they differ, the sources differ.

This works because a zip archive would otherwise embed machine-specific
noise, all of which the builder removes:

- **Modification times** are checkout times and differ per clone, so all
  files are staged into a temporary directory and stamped with a fixed
  timestamp (2020-01-01T00:00:00Z). The working tree is never modified.
- **The 0x5455 extra field** additionally records *access* times, which
  change merely by reading a file. `zip -X` drops it, along with the
  0x7875 uid/gid field.
- **DOS timestamps are local time**, so `TZ` is pinned to UTC.
- **Unix file modes** are recorded in the central directory, and git checks
  files out as `0666 & ~umask` — so the packager's umask would otherwise
  change the hash. Staged files are normalised to `0644`. Note that `zip -X`
  does *not* cover this; it only drops the extra fields.
- **Line endings**: the archive stores file bytes verbatim, so a CRLF checkout
  would change every text file. `.gitattributes` pins the working tree to LF
  on every platform, including Windows, where git otherwise defaults to
  `core.autocrlf=true`.

The source archive is built the same way, so it has a stable hash too and
carries neither the packager's uid/gid nor file access times.

To build against a different fixed date, set `SOURCE_DATE_EPOCH` to a
Unix timestamp (see <https://reproducible-builds.org/docs/source-date-epoch/>).
Note that doing so changes the resulting hash.

## Verifying the tests

```bash
npm test             # unit tests, Node built-in runner, no dependencies
npm run lint         # checks all 7 locale files have identical keys

npm install          # needed only for the two checks below
npm run format:check # Prettier, pinned in devDependencies
npm run test:ui      # Playwright UI tests
```

`npm test` and `npm run lint` run without any dependency installation.

## Archive contents

Files that ship inside the XPI:

```
manifest.json                 — Extension manifest (Manifest V2)
background.html               — Background page (loads background.js)
background.js                 — Menus, commands, install hook, listeners
modules/template-store.js     — CRUD and migrations over storage.local
modules/template-insert.js    — Variables, conditionals, nested templates
modules/template-lint.js      — Template validation shown in the options list
modules/validation.js         — Pure validation helpers (unit-tested)
modules/compose-script.js     — Injected into compose windows
modules/compose-utils.js      — Compose tab/identity helpers
modules/message-utils.js      — MIME part extraction for saved messages
modules/ui-helpers.js         — Shared filter/select rendering
modules/prompt-collector.js   — Collects {PROMPT}/{CHOICE} answers
modules/usage-stats.js        — Usage dashboard aggregation
popup/popup.*                 — Compose-action popup (HTML/CSS/JS)
options/options.*             — Options page and template editor
prompt-dialog/dialog.*        — Ask-on-insert dialog
welcome/welcome.*             — Post-install welcome tab
images/icon.svg               — Icon source, also used by the welcome page
images/icon-{16,32,64,128}.png— Extension icons
_locales/{en,de,fr,es,it,nl,pt}/messages.json — UI strings
LICENSE                       — Mozilla Public License 2.0
```

Files included for building and verification only:

```
scripts/xpi-files.mjs         — The XPI file list (single source of truth)
scripts/build-xpi.mjs         — XPI builder
scripts/build-source-zip.mjs  — Builder for this source archive
scripts/lint-locales.js       — Locale key consistency check
build-xpi.ps1                 — Windows wrapper for the XPI builder
build-source-zip.ps1          — Windows wrapper for the source builder
tests/                        — Unit tests and Playwright UI tests
playwright.config.mjs         — UI test configuration
.github/workflows/            — CI and release automation
package.json, package-lock.json
.prettierrc.json, .editorconfig
README.md, SOURCE_README.md
```

## Notes

- No external libraries, no remote code, no CDNs.
- All JavaScript is vanilla ES6 modules (`<script type="module">`).
- No inline scripts or inline event handlers (CSP compliant).
