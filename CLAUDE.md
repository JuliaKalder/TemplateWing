# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TemplateWing is a Thunderbird 128+ MailExtension (WebExtension-based add-on) for managing and inserting email templates with attachments. Vanilla JavaScript, no build step required.

## Architecture

- **manifest.json** — Manifest V2, targets TB 128+ (`strict_min_version: 128.0`), permissions: `compose`, `storage`, `menus`
- **background.html / background.js** — Background page with ES6 module support. Registers context menus in compose windows, handles message passing, listens for storage changes.
- **modules/template-store.js** — ES6 module providing CRUD operations (`getTemplates`, `getTemplate`, `saveTemplate`, `deleteTemplate`) over `messenger.storage.local` with in-memory cache and schema versioning (migrations). Template schema: `{ id, name, subject, body, attachments[], category, to, cc, bcc, identities, insertMode, createdAt, updatedAt, usageCount, lastUsedAt }`
- **modules/template-insert.js** — Template insertion logic: variable replacement (`{DATE}`, `{TIME}`, `{DATETIME}`, `{YEAR}`, `{WEEKDAY}`, `{SENDER_NAME}`, `{SENDER_EMAIL}`, `{ACCOUNT_NAME}`, `{ACCOUNT_EMAIL}`), nested template resolution with cycle detection, per-file attachment error handling.
- **modules/validation.js** — Pure validation helpers (no messenger.* dependency): `isValidRecipient`, `validateRecipients`, `formatFileSize`, `analyseImport`. Tested via Node.js built-in test runner.
- **popup/** — Compose-action popup shown when clicking the toolbar button in a compose window. Lists templates and inserts selected template into the active compose window via `messenger.compose.setComposeDetails`.
- **options/** — Options page for creating, editing, and deleting templates. Includes import dialog with merge modes, recipient validation, attachment size warnings. Opened via Add-ons Manager or from the popup.
- **_locales/{en,de,fr,es,it,pt,nl}/** — i18n strings. All user-visible text uses `messenger.i18n.getMessage()` or `data-i18n` attributes in HTML.

## Key APIs Used

- `messenger.compose.getComposeDetails(tabId)` / `setComposeDetails(tabId, details)` — read/write compose window content
- `messenger.compose.addAttachment(tabId, attachment)` — add file attachments
- `messenger.storage.local` — persistent template storage
- `messenger.menus` — context menu in compose body
- `messenger.composeAction` — toolbar button in compose window

## Development

**Load as temporary add-on in Thunderbird:**
1. Open Thunderbird → Menu (≡) → Add-ons and Themes (`Ctrl+Shift+A`)
2. Gear icon (⚙) → Debug Add-ons
3. "Load Temporary Add-on…" → select `manifest.json`
4. Click "Inspect" next to the add-on for console/debugging

**Reload after changes:** Click "Reload" on the Debug Add-ons page (no restart needed).

**Package as XPI:**
```bash
cd TemplateWing && zip -r ../templatewing.xpi * -x ".*"
```

## Testing

- `npm test` — Runs unit tests via Node.js built-in test runner (zero dependencies)
- `npm run lint` — Validates all locale files have consistent keys with `en`

## Conventions

- All HTML uses `<script type="module">` for ES6 import/export
- i18n: add strings to all 7 locale files under `_locales/`. Run `npm run lint` to verify.
- Use `messenger.*` API (Thunderbird's namespace), not `browser.*` or `chrome.*`
- No inline scripts or inline event handlers in HTML (CSP compliance)
- Keep validation logic in `modules/validation.js` (pure functions, testable without messenger.*)
