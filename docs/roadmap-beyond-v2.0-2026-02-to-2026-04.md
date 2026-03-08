# TemplateWing Roadmap Beyond v2.0

Time horizon: **February 24, 2026 to June 30, 2026**
Planning baseline date: **February 24, 2026**

## Current Baseline

- Current extension version: `2.2.0` (`manifest.json`)
- v2.0 issues delivered and closed:
  - #13 Account-specific templates
  - #14 Nested templates / reusable blocks (with cycle detection)
  - #15 Additional localizations (FR, ES, IT, PT, NL)
- Fresh hardening pass already pushed to `main` (`7884c1a`):
  - Identity-aware compose context menu rendering
  - Shortcut insertion usage tracking consistency
  - More robust nested-include detection/error flow
  - Safer nested-template insertion in editor (no dynamic `innerHTML +=`)

## Strategy

1. Keep v2.0 stable for Thunderbird shop handoff.
2. Prioritize low-risk reliability and validation improvements in v2.1.
3. Add productivity features in v2.2 without increasing support burden.
4. Start targeted UX and ecosystem features in v2.3 only after regression coverage exists.

## Release Plan

## v2.1 (Delivered: March 2026) ✓

Theme: **Stabilization + guardrails**

All items delivered:

1. ✓ Import guardrails and merge modes
   - Import modal with pre-import validation summary (total, invalid, duplicates).
   - Three import modes: *Add all as new*, *Skip existing names*, *Update existing by name*.
   - Detailed result message (added/skipped/replaced).

2. ✓ Recipient and template validation
   - Save-time email format validation for To, Cc, Bcc fields.
   - Required-name validation with field highlighting.
   - Extracted pure validation module (`modules/validation.js`).

3. ✓ Attachment hardening
   - Per-file size warning (≥5 MB) and total size warning (≥10 MB).
   - Per-file error handling during attachment insertion.
   - File read error feedback in editor.

4. ✓ Minimal automated checks
   - 25 unit tests for validation helpers (Node.js built-in test runner, zero dependencies).
   - Locale consistency lint script.
   - GitHub Actions CI workflow (tests + locale lint).

Exit criteria met:
- No critical regressions in save/import/insert flows.
- CI gate in place: tests + locale lint run on every push/PR to main.

## v2.2 (Delivered: March 2026) ✓

Theme: **Productivity + maintainability**

All items delivered:

1. ✓ Variable system expansion
   - Clickable variable picker chips in the editor toolbar.
   - Five new deterministic variables: `{DATETIME}`, `{YEAR}`, `{WEEKDAY}`, `{ACCOUNT_NAME}`, `{ACCOUNT_EMAIL}`.
   - Variables are resolved at insertion time; account variables resolved from `messenger.accounts.list()`.

2. ✓ Editor UX upgrades
   - Paste sanitization toggle ("Paste as plain text") strips HTML formatting from clipboard.
   - Toolbar active-state feedback: bold/italic/underline buttons highlight when active at cursor.
   - Duplicate template name warning prevents saving templates with conflicting names.

3. ✓ State consistency/performance
   - In-memory template cache eliminates repeated `storage.local.get()` calls.
   - Cache invalidation via `messenger.storage.onChanged` keeps popup, options, and background in sync.

4. ✓ Storage schema versioning
   - Schema version field (`schemaVersion`) persisted in `storage.local`.
   - Sequential migration hooks ensure forward compatibility (migration 0→1 normalises template fields).
   - `migrateIfNeeded()` runs on first read per session.

Exit criteria met:
- All editor interactions are faster due to cached reads.
- Schema versioning supports safe forward migration on add-on updates.

## v2.3 (Target: June 2026)

Theme: **Power-user features with low risk**

1. Insert-position controls
- Add explicit insert-at-cursor / top / end behavior (building on issue #24 direction).

2. Smart template chooser
- Optional favorites and pinning.
- Recent + favorites hybrid sort mode.

3. Better import/export interoperability
- Import preview with conflict resolution UI.
- Optional per-template export.

Exit criteria:
- Power-user controls are available without increasing default-flow complexity.

## Proposed Future Features (Candidates Beyond v2.3)

1. Optional sync profile (`storage.sync`) with conflict policy.
2. Account-level default signatures via nested template blocks.
3. Template linting assistant (detect unresolved variables/includes before save).
4. Shortcut customization UI in options.
5. Optional plain-text-only template mode for strict clients.
6. Bulk template operations (multi-select delete/category move/export).
7. Local usage insights dashboard (fully on-device, no telemetry).

## Risks and Constraints

1. Thunderbird compose/message API behavior can vary by version.
2. Attachment-heavy templates can pressure `storage.local` size/performance.
3. Without automated regression coverage, feature velocity increases break risk.

## Tracking Setup

1. Maintain milestones: `v2.1`, `v2.2`, `v2.3`.
2. Keep roadmap issues labeled with `post-v2.0` and their target version label.
3. Gate new feature work on passing CI smoke checks once v2.1 testing lands.
