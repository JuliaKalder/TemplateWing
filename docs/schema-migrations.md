# Schema Migrations

TemplateWing uses a schema versioning system to handle storage format evolution safely across add-on updates. This document explains how it works and how to add new migrations.

## Overview

The storage system persists templates in Thunderbird's `storage.local` API. When the data model changes (e.g., new fields are added), existing user data must be upgraded without data loss.

## Schema Versioning

- **Storage key**: `schemaVersion` (stored in `storage.local`)
- **Current version**: `1`
- **Initial install**: Schema version is set to `1` after first template load
- **Upgrade**: Migration functions transform data from version N to N+1

## Files

- `modules/schema-migrations.js` — Pure migration functions (testable)
- `modules/template-store.js` — Storage layer that runs migrations via `migrateIfNeeded()`

## How Migrations Work

Each migration is an async function that:
1. Takes an array of templates
2. Transforms them to the new schema
3. Returns `{ templates, changed }` where `changed` is `true` if any template was modified

The migration runner in `template-store.js`:
1. Reads the current schema version from storage
2. Runs all pending migrations sequentially (v0→v1, v1→v2, etc.)
3. Persists the updated templates and new schema version atomically

## Adding a New Migration

When you need to add a new field or change the data model:

### Step 1: Increment `CURRENT_SCHEMA`

In `modules/schema-migrations.js`:

```javascript
export const CURRENT_SCHEMA = 2; // was 1
```

### Step 2: Add the Migration Function

```javascript
/**
 * Migration 1 → 2: add newField with default value.
 */
export async function migrateV1toV2(templates) {
  let changed = false;
  for (const t of templates) {
    if (t.newField === undefined) {
      t.newField = "default";
      changed = true;
    }
  }
  return { templates, changed };
}
```

### Step 3: Add to `runMigrations`

Update the `runMigrations` function to include the new migration in the array:

```javascript
const migrations = [migrateV0toV1, migrateV1toV2];
```

### Step 4: Add Tests

Create tests in `tests/schema-migrations.test.js`:

```javascript
describe("migrateV1toV2", () => {
  it("adds newField with default value", async () => {
    const templates = [{ id: "1", name: "Test" }];
    const result = await migrateV1toV2([...templates]);
    assert.strictEqual(result.changed, true);
    assert.strictEqual(result.templates[0].newField, "default");
  });
  // ... more tests
});
```

### Step 5: Run Tests

```bash
npm test
```

## Migration Guidelines

1. **Never delete fields** — Only add or rename. Users may downgrade the add-on.
2. **Provide defaults** — New fields should have sensible defaults.
3. **Be backward-compatible** — Handle missing fields gracefully.
4. **Test thoroughly** — Cover: existing data missing fields, existing data with fields, new installs.
5. **Log significant changes** — Use `console.log` for debugging.

## Current Schema (v1)

Template v1.2/v2.0 templates created before schema versioning may be missing these fields:

| Field | Type | Default |
|-------|------|---------|
| `category` | string | `""` |
| `to` | array | `[]` |
| `cc` | array | `[]` |
| `bcc` | array | `[]` |
| `identities` | array | `[]` |
| `insertMode` | string | `"append"` |
| `attachments` | array | `[]` |

## Manual Verification

To manually test migrations:

1. Install an older version of the add-on (pre-schema)
2. Create some templates
3. Install the new version
4. Open Browser Console (`Ctrl+Shift+J`)
5. Look for: `TemplateWing: migrated schema from v0 to v1`
6. Verify templates are intact and have all fields

## Debugging

The migration system logs to the console:
- `TemplateWing: migrated schema from v{old} to v{new}` — on successful migration

To force re-migration (development only):
1. Open `about:config` in Thunderbird
2. Find `templatewing.storage` (or the add-on's storage area)
3. Delete or set `schemaVersion` to `0`
4. Reload the add-on
