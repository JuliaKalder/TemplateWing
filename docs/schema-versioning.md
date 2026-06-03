# Storage Schema Versioning and Migration

## Overview

TemplateWing stores templates in `messenger.storage.local` under two keys:

| Key | Type | Purpose |
|-----|------|---------|
| `templates` | `Array` | All template objects |
| `schemaVersion` | `number` | Current schema version of stored data |

The schema version is checked and migrations are run automatically on the first `getTemplates()` call per page session.

## Current schema version: 1

### Template object (v1)

```json
{
  "id":          "string (base36 timestamp + random suffix)",
  "name":        "string (required, unique)",
  "subject":     "string",
  "body":        "string (HTML)",
  "category":    "string (empty string = uncategorised)",
  "to":          ["array of recipient strings"],
  "cc":          ["array of recipient strings"],
  "bcc":         ["array of recipient strings"],
  "identities":  ["array of identity IDs; empty = all accounts"],
  "insertMode":  "append | prepend | cursor | replace",
  "attachments": [{ "name": "string", "type": "MIME", "size": "number", "data": "base64" }],
  "createdAt":   "ISO 8601 string",
  "updatedAt":   "ISO 8601 string",
  "usageCount":  "number (optional)",
  "lastUsedAt":  "ISO 8601 string (optional)"
}
```

## Migration history

### v0 → v1  (`migrateV0toV1` in `modules/template-store.js`)

Pre-v2.2 data had no `schemaVersion` key (defaults to `0`). Migration adds missing fields with safe defaults:

| Field | Default added |
|-------|--------------|
| `category` | `""` |
| `to` | `[]` |
| `cc` | `[]` |
| `bcc` | `[]` |
| `identities` | `[]` |
| `insertMode` | `"append"` |
| `attachments` | `[]` |

The migration is idempotent — templates that already have all fields are left unchanged and `changed` is returned as `false`.

## How migration runs

```
loadTemplates()
  └─ migrateIfNeeded()
       ├─ reads schemaVersion (default 0)
       ├─ if version < CURRENT_SCHEMA:
       │    for each pending migration function in `migrations[]`:
       │      run migration, collect updated templates
       │    write templates + new schemaVersion atomically
       └─ loadTemplates continues with fresh storage read
```

Source: `modules/template-store.js` — `migrateIfNeeded()`, `loadTemplates()`.

## Adding a future migration (v1 → v2 example)

1. Bump `CURRENT_SCHEMA` to `2` in `template-store.js`.
2. Write a new async function `migrateV1toV2(templates)`:
   ```js
   export async function migrateV1toV2(templates) {
     let changed = false;
     for (const t of templates) {
       if (!t.newField) { t.newField = "default"; changed = true; }
     }
     return { templates, changed };
   }
   ```
3. Append it to the `migrations` array: `const migrations = [migrateV0toV1, migrateV1toV2];`
4. Export the function and add a unit test in `tests/template-store.test.js`.

## Tests

Migration behaviour is covered by `tests/template-store.test.js`:

- `migrateV0toV1` suite — unit tests for each field default and edge cases (empty array, mixed data, idempotency).
- `getTemplates triggers migration on stale schema` suite — integration test that seeds pre-v1 storage and asserts fields are normalised and `schemaVersion` is stamped.
