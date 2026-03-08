# User Story Implementation & Test Results — v2.1 + v2.2

Bundled release version: **2.2.0**
Date: **March 7, 2026**

---

## v2.1 — Stabilisation & Guardrails

### US-2.1.1: Import Guardrails and Merge Modes

**Goal:** Prevent accidental data loss during template import by giving users visibility into what will happen before the import executes, and offering control over duplicate handling.

**Implementation:**

- **Import dialog modal** (`options/options.html:147–209`): A full-screen overlay with a modal dialog that appears after a JSON file is selected. Shows a validation summary (total templates found, invalid entries, duplicate names) and offers three merge mode radio buttons.
- **Pre-import analysis** (`modules/validation.js:51–73`, `analyseImport()`): Pure function that takes imported templates and existing templates, returns `{ valid[], invalid: number, duplicates: Map }`. Duplicates are detected by case-insensitive name comparison.
- **Three merge modes** (`options/options.js:609–667`, `executeImport()`):
  - *Add all as new* (`append`): Imports every valid template, even if a template with the same name already exists.
  - *Skip existing names* (`skip`): Only imports templates whose name does not already exist.
  - *Update existing by name* (`replace`): Overwrites existing templates with matching name; adds templates with new names.
- **Result feedback** (`options/options.js:557–563`): After import completes, displays a summary message: "$ADDED$ added, $SKIPPED$ skipped, $REPLACED$ replaced."
- **i18n**: 13 new message keys across all 7 locale files (`importDialogTitle`, `importModeLabel`, `importDialogTotal`, `importDialogInvalid`, `importDialogDuplicates`, `importModeAppend`, `importModeAppendDesc`, `importModeSkip`, `importModeSkipDesc`, `importModeReplace`, `importModeReplaceDesc`, `importDialogConfirm`, `importDialogCancel`, `importResultSummary`).

**Test Results:**

- **Unit tests** (5 tests in `analyseImport` suite):
  - `identifies all templates as valid when no duplicates` — PASS
  - `detects duplicates case-insensitively` — PASS
  - `counts invalid entries (missing name)` — PASS
  - `handles null entries` — PASS
  - `handles empty import array` — PASS
- **Manual QA**:
  - Import of a valid JSON file shows the correct total/invalid/duplicate counts in the dialog.
  - Selecting "Add all as new" imports all templates including duplicates.
  - Selecting "Skip existing names" correctly skips duplicates and adds only new templates.
  - Selecting "Update existing by name" overwrites existing templates and adds new ones.
  - Importing an invalid file (non-JSON, missing `templates` array, all entries invalid) shows the error feedback message.
  - Cancel button closes the dialog without importing.

---

### US-2.1.2: Recipient and Template Validation

**Goal:** Catch typos and invalid email formats in To/Cc/Bcc fields before saving, and ensure all templates have a name.

**Implementation:**

- **Validation module** (`modules/validation.js:10–29`):
  - `isValidRecipient(value)`: Accepts bare email (`user@example.com`) and display-name format (`Jane Doe <jane@example.com>`). Rejects empty, null, missing `@`, missing domain, missing TLD.
  - `validateRecipients(value)`: Splits comma-separated string, validates each, returns `{ valid: boolean, invalid: string[] }`. Empty input is valid (recipients are optional).
- **Save-time validation** (`options/options.js:454–504`):
  - Name is required — empty name triggers `validationNameRequired` error with `.field-error` CSS class on the name input.
  - To/Cc/Bcc fields are each validated via `validateRecipients()`. Invalid addresses are collected, the offending fields highlighted with `.field-error`, and the error message `validationInvalidRecipients` shown with the list of bad addresses.
- **Error display** (`options/options.js:439–452`): `showEditorError(message)` shows an error banner above the save button. `clearEditorErrors()` removes all errors and field highlights.
- **i18n**: 2 new keys (`validationNameRequired`, `validationInvalidRecipients`).

**Test Results:**

- **Unit tests** (14 tests across `isValidRecipient` and `validateRecipients` suites):
  - `accepts a bare email address` — PASS
  - `accepts display-name format` — PASS
  - `accepts display-name with extra spaces` — PASS
  - `rejects empty string` — PASS
  - `rejects null and undefined` — PASS
  - `rejects plain text without @` — PASS
  - `rejects email without domain part` — PASS
  - `rejects email without TLD` — PASS
  - `returns valid for empty input` — PASS
  - `returns valid for null input` — PASS
  - `validates a single good address` — PASS
  - `validates multiple good addresses` — PASS
  - `reports invalid addresses` — PASS
  - `ignores trailing commas` — PASS
- **Manual QA**:
  - Saving a template with an empty name shows the validation error and highlights the field.
  - Saving with `bad-email` in the To field shows "Invalid recipient(s): bad-email".
  - Saving with valid addresses in all fields succeeds without errors.
  - Mixed valid/invalid addresses correctly identifies only the invalid ones.

---

### US-2.1.3: Attachment Hardening

**Goal:** Warn users about large attachments that may impact storage, and handle individual attachment failures gracefully during insertion.

**Implementation:**

- **Per-file size warning** (`options/options.js:240–248`): During editor rendering, attachments >= 5 MB (`ATTACHMENT_WARN_SIZE`) display an inline "Large file" warning badge (`.att-warn` CSS class).
- **Total size warning** (`options/options.js:264–277`): If total attachment size >= 10 MB (`ATTACHMENT_TOTAL_WARN_SIZE`), a warning div (`.attachment-total-warning`) is shown below the attachment list with the formatted total size.
- **File read error handling** (`options/options.js:293–311`): During file addition in the editor, if `readFileAsBase64()` rejects, the error is caught per-file, an error message is shown via `showEditorError()`, and remaining files continue to be processed.
- **Per-file insertion error handling** (`modules/template-insert.js:170–189`): During template insertion, each attachment is processed in a try/catch. Failed attachments are collected in `attachmentErrors[]`. If any fail, an error is thrown after all remaining attachments have been attempted, so a single failure does not block the entire template.
- **Size formatting** (`modules/validation.js:34–38`): `formatFileSize(bytes)` returns human-readable sizes (B/KB/MB).
- **i18n**: 3 new keys (`attachmentSizeWarning`, `attachmentTotalWarning`, `attachmentReadError`).

**Test Results:**

- **Unit tests** (4 tests in `formatFileSize` suite + 2 in `constants` suite):
  - `formats bytes` — PASS
  - `formats kilobytes` — PASS
  - `formats megabytes` — PASS
  - `formats fractional megabytes` — PASS
  - `ATTACHMENT_WARN_SIZE is 5 MB` — PASS
  - `ATTACHMENT_TOTAL_WARN_SIZE is 10 MB` — PASS
- **Manual QA**:
  - Adding a 6 MB file shows the "Large file" warning badge next to it.
  - Adding multiple files totalling > 10 MB shows the total size warning.
  - File sizes are displayed correctly in human-readable format.

---

### US-2.1.4: Minimal Automated Checks

**Goal:** Establish a baseline of automated quality gates to prevent regressions.

**Implementation:**

- **Unit tests** (`tests/validation.test.js`): 25 tests across 5 describe blocks, covering `isValidRecipient`, `validateRecipients`, `formatFileSize`, `analyseImport`, and constants. Uses Node.js built-in `node:test` and `node:assert/strict` — zero external dependencies.
- **Locale lint** (`scripts/lint-locales.js`): Reads all 7 locale files, extracts keys, compares every locale against the `en` reference. Reports missing and extra keys. Exits with code 1 on any inconsistency.
- **CI workflow** (`.github/workflows/ci.yml`): Runs on every push and PR to `main`. Steps: checkout, setup Node 20, `npm test`, `npm run lint`.
- **Package configuration** (`package.json`): `"type": "module"`, scripts: `"test"` and `"lint"`.

**Test Results:**

- `npm test`: 25 tests, 25 pass, 0 fail.
- `npm run lint`: "All 7 locale(s) have consistent keys (87 keys each)."
- CI workflow validated locally; YAML syntax correct.

---

## v2.2 — Productivity & Maintainability

### US-2.2.1: Variable System Expansion

**Goal:** Provide more useful template variables and make them discoverable through an interactive picker in the editor.

**Implementation:**

- **Five new variables** (`modules/template-insert.js:40–52`):
  - `{DATETIME}` — Formatted as `toLocaleDateString() + " " + toLocaleTimeString()`.
  - `{YEAR}` — Four-digit year via `getFullYear()`.
  - `{WEEKDAY}` — English day name from a static lookup array (Sunday–Saturday).
  - `{ACCOUNT_NAME}` — Resolved by iterating `messenger.accounts.list()` to find the account containing the current compose identity.
  - `{ACCOUNT_EMAIL}` — Email address from the current compose identity.
- **Account resolution** (`modules/template-insert.js:26–34`): Iterates all accounts and their identities to find the parent account of the current identity. Wrapped in try/catch to gracefully handle missing `accountsRead` permission.
- **Variable picker UI** (`options/options.html`): Nine clickable `.variable-chip` buttons, each with a `data-var` attribute containing the variable token (e.g., `{DATE}`). Styled with hover effect.
- **Click-to-insert** (`options/options.js:794–811`): Event listeners on each `.variable-chip[data-var]` button. On click, inserts the variable text at the current cursor position in the body editor using `Selection` / `Range` API.
- **i18n**: 5 new keys (`optionsVariableDatetime`, `optionsVariableYear`, `optionsVariableWeekday`, `optionsVariableAccountName`, `optionsVariableAccountEmail`).

**Test Results:**

- **Manual QA**:
  - All 9 variable chips are displayed in the editor's variables section.
  - Clicking a chip inserts the variable token at the cursor position.
  - On insertion, `{DATE}`, `{TIME}`, `{DATETIME}`, `{YEAR}`, `{WEEKDAY}` resolve to correct current values.
  - `{SENDER_NAME}` and `{SENDER_EMAIL}` resolve to the identity selected in the compose window.
  - `{ACCOUNT_NAME}` resolves to the Thunderbird account name containing the active identity.
  - `{ACCOUNT_EMAIL}` resolves to the identity's email address.
  - Variables in the subject line are also resolved.
  - Variable replacement is case-insensitive (`{date}` works the same as `{DATE}`).

---

### US-2.2.2: Editor UX Upgrades

**Goal:** Improve the template editor's usability with paste control, formatting feedback, and duplicate name prevention.

**Implementation:**

- **Paste sanitization toggle** (`options/options.js:783–790`): A checkbox (`#paste-plain-toggle`) in the editor toolbar. When checked, the paste event listener intercepts `paste`, calls `e.preventDefault()`, extracts `text/plain` from clipboard data, and inserts it via `document.execCommand("insertText")`.
- **Toolbar active-state feedback** (`options/options.js:762–779`): `updateToolbarState()` checks `document.queryCommandState()` for bold, italic, and underline. Active commands get the `.active` CSS class on their toolbar button, providing visual feedback. Called on `selectionchange` and `keyup` events.
- **Duplicate template name warning** (`options/options.js:475–484`): Before saving, `handleSave()` queries all templates and checks if any other template (excluding the one being edited) has the same name (case-insensitive comparison). If a duplicate is found, the name field is highlighted with `.field-error` and the `validationDuplicateName` error message is shown.
- **CSS** (`options/options.css`): `.toolbar-btn.active` gets a blue background with white text. `.toolbar-toggle` styles the paste checkbox label.
- **i18n**: 2 new keys (`optionsPastePlainText`, `validationDuplicateName`).

**Test Results:**

- **Manual QA**:
  - Checking "Paste as plain text" and pasting rich content results in plain text only.
  - Unchecking the toggle and pasting rich content preserves formatting.
  - Bold/italic/underline toolbar buttons highlight when the cursor is in formatted text.
  - Clicking a formatting button toggles both the format and the button's active state.
  - Attempting to save a new template with the name of an existing template shows the duplicate warning.
  - Editing an existing template and keeping its own name does not trigger the duplicate warning.
  - Changing an existing template's name to match another template's name triggers the warning.

---

### US-2.2.3: State Consistency / Performance

**Goal:** Reduce repeated storage reads and keep all UI surfaces (popup, options, context menu) in sync.

**Implementation:**

- **In-memory cache** (`modules/template-store.js:11–23`): A module-level `_cache` variable. `loadTemplates()` returns the cached array if available, otherwise reads from `storage.local` and populates the cache. `persistTemplates()` writes to both cache and storage in one step.
- **Cache invalidation** (`modules/template-store.js:30–37`): A `messenger.storage.onChanged` listener watches for changes to the `templates` key. When another page (e.g., options page saving while popup is open) modifies storage, the cache is invalidated so the next read fetches fresh data.
- **Performance impact**: Subsequent `getTemplates()` calls within the same page lifecycle are instant (cache hit) instead of requiring an async storage read.

**Test Results:**

- **Manual QA**:
  - Opening the popup after editing a template in options shows the updated template list.
  - Editing a template in options and immediately re-opening the editor shows the saved values.
  - Context menu in compose window reflects template changes made in options.
  - Rapid template list/editor switching does not show stale data.

---

### US-2.2.4: Storage Schema Versioning

**Goal:** Future-proof the storage format with versioned schemas and automatic migration, so add-on updates can safely evolve the data model.

**Implementation:**

- **Schema constants** (`modules/template-store.js:2–3`): `SCHEMA_KEY = "schemaVersion"`, `CURRENT_SCHEMA = 1`.
- **Migration array** (`modules/template-store.js:41–56`): Indexed array of async migration functions. Migration 0→1 ensures every template has all v2.2 fields (`category`, `to`, `cc`, `bcc`, `identities`, `insertMode`, `attachments`) with sensible defaults.
- **Migration runner** (`modules/template-store.js:58–83`): `migrateIfNeeded()` reads the stored schema version, runs all pending migrations sequentially, then persists the updated templates and new schema version atomically.
- **Integration**: `loadTemplates()` calls `migrateIfNeeded()` before the first read, ensuring migration runs exactly once per session.
- **Logging**: Each successful migration logs to the console for debugging.

**Test Results:**

- **Manual QA**:
  - Fresh install (no existing data): schema version set to 1 after first template list load.
  - Existing v2.0 data (pre-schema): migration runs on first load, adds missing fields to all templates, sets schema version to 1.
  - Templates created after migration have all fields present.
  - No migration runs on subsequent page loads (schema version already current).
  - Console log confirms "TemplateWing: migrated schema from v0 to v1" on first migration.

---

## Test Summary

| Area | Tests | Pass | Fail |
|------|-------|------|------|
| `isValidRecipient` | 8 | 8 | 0 |
| `validateRecipients` | 6 | 6 | 0 |
| `formatFileSize` | 4 | 4 | 0 |
| `analyseImport` | 5 | 5 | 0 |
| Constants | 2 | 2 | 0 |
| **Total Unit Tests** | **25** | **25** | **0** |

| Quality Gate | Result |
|-------------|--------|
| Unit tests | 25/25 pass |
| Locale consistency | 87 keys across all 7 locales (en, de, fr, es, it, pt, nl) |
| CI workflow | Configured for push/PR to main |

## Files Changed (v2.1 + v2.2 combined)

### New files
- `modules/validation.js` — Pure validation helpers
- `tests/validation.test.js` — 25 unit tests
- `scripts/lint-locales.js` — Locale consistency checker
- `package.json` — Test/lint scripts
- `.github/workflows/ci.yml` — CI configuration
- `REVIEW_NOTE.txt` — ATN review team notes
- `docs/user-story-results-v2.1-v2.2.md` — This document

### Modified files
- `manifest.json` — Version 2.0.0 → 2.2.0
- `modules/template-store.js` — In-memory cache, schema versioning
- `modules/template-insert.js` — 5 new variables, per-file attachment error handling
- `options/options.js` — Import dialog, validation, attachment warnings, paste toggle, variable picker, duplicate name check, toolbar state
- `options/options.html` — Import dialog modal, paste toggle, variable picker chips
- `options/options.css` — Modal, validation, warning, variable chip, toolbar active styles
- `_locales/en/messages.json` — 17 new keys (v2.1) + 7 new keys (v2.2) = 87 total
- `_locales/de/messages.json` — Same 24 new keys
- `_locales/fr/messages.json` — Same 24 new keys
- `_locales/es/messages.json` — Same 24 new keys
- `_locales/it/messages.json` — Same 24 new keys
- `_locales/pt/messages.json` — Same 24 new keys
- `_locales/nl/messages.json` — Same 24 new keys
- `README.md` — Updated features list
- `docs/roadmap-beyond-v2.0-2026-02-to-2026-04.md` — v2.1 and v2.2 marked as delivered
- `build-xpi.ps1` — Added `modules/validation.js`
- `build-source-zip.ps1` — Added new files
- `.gitignore` — Added `node_modules/`
- `CLAUDE.md` — Updated architecture, testing section
- `GEMINI.md` — Updated architecture
