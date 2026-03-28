/**
 * Schema migrations for TemplateWing storage.
 *
 * Each migration is a pure async function that takes an array of templates
 * and returns { templates, changed } where changed is true if any template
 * was modified.
 *
 * To add a new migration:
 * 1. Increment CURRENT_SCHEMA
 * 2. Add a new function migrateV{N-1}toV{N}
 * 3. Add the function to the migrations array at index N-1
 * 4. Update migrateIfNeeded() to call up to CURRENT_SCHEMA
 * 5. Add tests for the new migration
 *
 * @module schema-migrations
 */

/** Current schema version. Bump when adding a new migration. */
export const CURRENT_SCHEMA = 1;

/** Storage key for schema version. */
export const SCHEMA_KEY = "schemaVersion";

/**
 * Migration 0 → 1: ensure every template has all v2.2 fields.
 *
 * Templates created before v2.2 may be missing fields like:
 * - category (default: "")
 * - to, cc, bcc (default: [])
 * - identities (default: [])
 * - insertMode (default: "append")
 * - attachments (default: [])
 *
 * @param {Array} templates - Array of template objects
 * @returns {Promise<{templates: Array, changed: boolean}>}
 */
export async function migrateV0toV1(templates) {
  let changed = false;
  for (const t of templates) {
    if (!t.category && t.category !== "") {
      t.category = "";
      changed = true;
    }
    if (!Array.isArray(t.to)) {
      t.to = [];
      changed = true;
    }
    if (!Array.isArray(t.cc)) {
      t.cc = [];
      changed = true;
    }
    if (!Array.isArray(t.bcc)) {
      t.bcc = [];
      changed = true;
    }
    if (!Array.isArray(t.identities)) {
      t.identities = [];
      changed = true;
    }
    if (!t.insertMode) {
      t.insertMode = "append";
      changed = true;
    }
    if (!Array.isArray(t.attachments)) {
      t.attachments = [];
      changed = true;
    }
  }
  return { templates, changed };
}

/**
 * Run all pending migrations from currentVersion up to CURRENT_SCHEMA.
 *
 * @param {Array} templates - Array of template objects
 * @param {number} currentVersion - Current schema version stored in storage.local
 * @returns {Promise<{templates: Array, finalVersion: number, anyChanged: boolean}>}
 */
export async function runMigrations(templates, currentVersion) {
  const migrations = [migrateV0toV1];
  let version = currentVersion;
  let anyChanged = false;

  while (version < CURRENT_SCHEMA) {
    const migration = migrations[version];
    if (migration) {
      const result = await migration(templates);
      if (result.changed) {
        anyChanged = true;
      }
      version++;
    } else {
      break;
    }
  }

  return { templates, finalVersion: version, anyChanged };
}
