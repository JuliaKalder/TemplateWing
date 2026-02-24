# TemplateWing Roadmap Beyond v2.0

Time horizon: **February 24, 2026 to June 30, 2026**
Planning baseline date: **February 24, 2026**

## Current Baseline

- Current extension version: `2.0.0` (`manifest.json`)
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

## v2.1 (Target: March 2026)

Theme: **Stabilization + guardrails**

1. Import guardrails and merge modes
- Add import modes: `append`, `skip duplicates`, `replace by name`.
- Pre-import validation summary with counts.

2. Recipient and template validation
- Validate recipient format consistently for `to`, `cc`, `bcc`.
- Add save-time validation for invalid or incomplete templates.

3. Attachment hardening
- Add size warning thresholds and clearer attachment error feedback.
- Handle attachment decode/insert failure per file with clear messaging.

4. Minimal automated checks
- Add unit tests for pure helper logic.
- Add CI smoke run (lint + tests).

Exit criteria:
- No critical regressions in save/import/insert flows.
- At least one automated CI gate prevents broken mainline commits.

## v2.2 (Target: April to May 2026)

Theme: **Productivity + maintainability**

1. Variable system expansion
- Add variable picker in editor.
- Add deterministic variables (`{DATETIME}`, `{YEAR}`, `{WEEKDAY}`, `{ACCOUNT_NAME}`, `{ACCOUNT_EMAIL}`).

2. Editor UX upgrades
- Paste sanitization mode.
- Toolbar active-state feedback.
- Duplicate template name warning before save.

3. State consistency/performance
- Reduce repeated storage reads in popup/options render cycles.
- Keep popup/options/context menu in sync through a clear refresh strategy.

4. Storage schema versioning
- Add schema version field and migration hooks.
- Document schema and migration rules.

Exit criteria:
- Faster, predictable editing/insertion behavior under manual QA.
- Versioned storage supports forward migration safely.

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
