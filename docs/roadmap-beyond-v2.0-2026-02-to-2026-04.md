# TemplateWing Roadmap Beyond v2.0

Time horizon: **February 18, 2026 to April 18, 2026** (next 2 months)  
Planning baseline date: **February 18, 2026**

## Inputs Used

- Current codebase state (`manifest.json` currently at version `1.3.0`, vanilla ES modules, no test suite in repo)
- Open GitHub issues (all labeled `v2.0`):
  - #13 Account-specific templates: https://github.com/JuliaKalder/TemplateWing/issues/13
  - #14 Nested templates / reusable blocks: https://github.com/JuliaKalder/TemplateWing/issues/14
  - #15 Additional localizations (FR, ES, IT, ...): https://github.com/JuliaKalder/TemplateWing/issues/15

## Strategy

All open issues are currently scoped to **v2.0**.  
For the period after v2.0, the priority should be:

1. Stabilize and harden core flows (edit, import/export, insert, attachments).
2. Add low-risk UX improvements that reduce support load.
3. Prepare the architecture for larger post-2.0 feature work (without trying to land another major feature set immediately).

## Release Plan (Post-v2.0)

## v2.1 (Target window: March 9, 2026 to March 29, 2026)

Theme: **Reliability + safety + quality**

### Scope

1. Import guardrails and merge options
- Add import modes: `append`, `skip duplicates`, `replace by name`.
- Show pre-import validation summary (valid templates, skipped entries, duplicates).
- Preserve deterministic behavior for malformed data.

2. Recipient and template validation
- Validate email-like recipient entries (`to/cc/bcc`) before save.
- Validate required fields and show inline errors consistently.
- Prevent empty or whitespace-only template body when configured as replace mode (optional warning).

3. Attachment handling hardening
- Add per-file and per-template size warnings.
- Gracefully handle attachment decode failures during insert with clear user feedback.
- Track and surface attachment import errors.

4. Minimal automated regression checks
- Add a lightweight test layer for pure modules (e.g., `template-store` data operations and parsing helpers).
- Add a CI-level smoke check (lint + unit tests) to prevent regressions.

### Exit Criteria

- No data-loss bugs in save/import/export flows during manual QA.
- Import failures become actionable (user can see what failed and why).
- At least one automated check runs in CI for core logic.

## v2.2 (Target window: March 30, 2026 to April 18, 2026)

Theme: **Productivity + maintainability**

### Scope

1. Variable system expansion (safe incremental)
- Add user-facing variable picker in editor.
- Add 3-5 new deterministic variables (e.g., `{DATETIME}`, `{ACCOUNT_NAME}`, `{ACCOUNT_EMAIL}`, `{WEEKDAY}`, `{YEAR}`).
- Keep variable resolution centralized in one helper module.

2. Editor UX upgrades
- Add plain-text paste option / sanitize-paste command for cleaner templates.
- Improve toolbar state feedback (active bold/italic/list indicators where feasible).
- Add duplicate-name warning before save.

3. Performance and state consistency
- Cache categories/templates per view render cycle to reduce repeated storage reads.
- Ensure popup/options/context menu stay in sync after mutations (single source update event strategy).

4. Post-v2.0 architecture prep
- Refactor storage model with explicit schema version field and migration hook.
- Document extension data schema and migration rules in `docs/`.

### Exit Criteria

- Template editing and insertion feel faster and more predictable in manual compose tests.
- New variables are documented and covered by regression checks.
- Storage schema versioning exists and can support future migrations without data loss.

## Backlog Candidate (Do not commit in this 2-month window unless capacity appears)

1. Cross-device sync option (`storage.sync`) with conflict strategy.
2. Snippet analytics (local only) for template optimization insights.
3. Keyboard shortcut customization UI.

## Dependencies and Risks

1. Thunderbird API constraints (compose/message APIs differ by version) may impact account and variable features.
2. Attachment size growth in `storage.local` can create performance pressure; warnings are needed before hard limits are hit.
3. No current formal test harness increases regression risk; v2.1 should prioritize this.

## Suggested Tracking Setup

1. Create milestones: `v2.1` and `v2.2`.
2. Convert each scope bullet into GitHub issues labeled `post-v2.0`.
3. Keep #13, #14, #15 in `v2.0`; do not slip them into post-v2.0 stabilization unless v2.0 scope changes.
