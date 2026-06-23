export const STORAGE_KEY = "templates";
export const SCHEMA_KEY = "schemaVersion";
export const SETTINGS_KEY = "settings";
export const CURRENT_SCHEMA = 2;
export const EXPORT_FORMAT_VERSION = "2.6";

/** Shared insert mode constants used across popup, options, and template-insert. */
export const INSERT_MODES = Object.freeze({
  APPEND: "append",
  PREPEND: "prepend",
  REPLACE: "replace",
  CURSOR: "cursor",
});

/** Generate a unique ID for a template or attachment. */
export function generateId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

// ---- In-memory cache ----

let _cache = null;

function invalidateCache() {
  _cache = null;
}

async function loadTemplates() {
  if (_cache !== null) return _cache;
  await migrateIfNeeded();
  const result = await messenger.storage.local.get({ [STORAGE_KEY]: [] });
  _cache = result[STORAGE_KEY];
  return _cache;
}

async function persistTemplates(templates) {
  await messenger.storage.local.set({ [STORAGE_KEY]: templates });
  _cache = templates;
}

// Invalidate cache when storage changes externally (e.g. from another page)
if (typeof messenger !== "undefined" && messenger.storage) {
  messenger.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEY]) {
      invalidateCache();
    }
  });
}

// ---- Schema migrations ----

// Migration 0 → 1: backfill name, category, to/cc/bcc, identities, insertMode, attachments
export async function migrateV0toV1(templates) {
  let changed = false;
  const migrated = templates.map((t) => {
    const updates = {};
    if (typeof t.name !== "string" || !t.name.trim()) updates.name = "(unnamed)";
    if (!t.category && t.category !== "") updates.category = "";
    if (!Array.isArray(t.to)) updates.to = [];
    if (!Array.isArray(t.cc)) updates.cc = [];
    if (!Array.isArray(t.bcc)) updates.bcc = [];
    if (!Array.isArray(t.identities)) updates.identities = [];
    if (!t.insertMode) updates.insertMode = "append";
    if (!Array.isArray(t.attachments)) updates.attachments = [];
    if (Object.keys(updates).length > 0) {
      changed = true;
      return { ...t, ...updates };
    }
    return t;
  });
  return { templates: migrated, changed };
}

// Migration 1 → 2: backfill pinned: false on every template.
export async function migrateV1toV2(templates) {
  let changed = false;
  const migrated = templates.map((t) => {
    if (typeof t.pinned !== "boolean") {
      changed = true;
      return { ...t, pinned: false };
    }
    return t;
  });
  return { templates: migrated, changed };
}

const migrations = [migrateV0toV1, migrateV1toV2];

async function migrateIfNeeded() {
  const result = await messenger.storage.local.get({ [SCHEMA_KEY]: 0 });
  let version = result[SCHEMA_KEY];

  if (version >= CURRENT_SCHEMA) return;

  const raw = await messenger.storage.local.get({ [STORAGE_KEY]: [] });
  let templates = raw[STORAGE_KEY];

  while (version < CURRENT_SCHEMA) {
    const migration = migrations[version];
    if (migration) {
      const migrationResult = await migration(templates);
      templates = migrationResult.templates;
      if (migrationResult.changed) {
        console.log(`TemplateWing: migrated schema from v${version} to v${version + 1}`);
      }
    }
    version++;
  }

  await messenger.storage.local.set({
    [STORAGE_KEY]: templates,
    [SCHEMA_KEY]: CURRENT_SCHEMA,
  });
}

// ---- Public API ----

/** Get all templates. Returns a shallow copy of the cached array. */
export async function getTemplates() {
  const templates = await loadTemplates();
  return [...templates];
}

/** Get a single template by ID. Returns a defensive copy, or null. */
export async function getTemplate(id) {
  const templates = await getTemplates();
  const t = templates.find((t) => t.id === id);
  if (!t) return null;
  return {
    ...t,
    to: [...(t.to || [])],
    cc: [...(t.cc || [])],
    bcc: [...(t.bcc || [])],
    attachments: [...(t.attachments || [])],
    identities: [...(t.identities || [])],
  };
}

/** Save (create or update) a template. Throws if name is missing or duplicate. */
export async function saveTemplate(template) {
  if (!template || typeof template.name !== "string" || !template.name.trim()) {
    throw new TypeError("template.name must be a non-empty string");
  }
  const templates = await getTemplates();
  const nameLower = template.name.trim().toLowerCase();
  const conflict = templates.find(
    (t) => t.name.toLowerCase() === nameLower && t.id !== template.id
  );
  if (conflict) {
    const err = new Error("A template with this name already exists");
    err.code = "DUPLICATE_NAME";
    throw err;
  }
  const now = new Date().toISOString();

  if (template.id) {
    const index = templates.findIndex((t) => t.id === template.id);
    if (index !== -1) {
      templates[index] = { ...templates[index], ...template, updatedAt: now };
    } else {
      templates.push({ ...template, createdAt: now, updatedAt: now });
    }
  } else {
    // Strip the incoming id so a caller-supplied null/undefined cannot
    // overwrite the freshly-generated id below. The UI passes
    // { id: editingId, ... } where editingId is null for new templates.
    const { id: _ignored, ...rest } = template;
    const newTemplate = {
      id: generateId(),
      attachments: [],
      insertMode: "append",
      category: "",
      to: [],
      cc: [],
      bcc: [],
      identities: [],
      pinned: false,
      ...rest,
      createdAt: now,
      updatedAt: now,
    };
    templates.push(newTemplate);
    await persistTemplates(templates);
    return newTemplate;
  }

  await persistTemplates(templates);
  return template;
}

/** Get distinct, sorted, non-empty category names. */
export async function getCategories() {
  const templates = await getTemplates();
  return [...new Set(templates.map((t) => t.category).filter(Boolean))].sort();
}

/** Delete a template by ID. Also clears it from any identity defaults that pointed at it. */
export async function deleteTemplate(id) {
  const templates = await getTemplates();
  const filtered = templates.filter((t) => t.id !== id);
  await persistTemplates(filtered);

  // Garbage-collect identity defaults that referenced the now-gone template.
  const defaults = await getDefaults();
  let touched = false;
  for (const [identityId, templateId] of Object.entries(defaults)) {
    if (templateId === id) {
      delete defaults[identityId];
      touched = true;
    }
  }
  if (touched) await setDefaults(defaults);
}

/** Toggle or set the pinned flag for a template. */
export async function setPinned(id, pinned) {
  const templates = await getTemplates();
  const index = templates.findIndex((t) => t.id === id);
  if (index === -1) return;
  const updated = [...templates];
  updated[index] = { ...updated[index], pinned: !!pinned };
  await persistTemplates(updated);
}

/** Increment usageCount and update lastUsedAt for a template. */
export async function trackUsage(id) {
  const templates = await getTemplates();
  const index = templates.findIndex((t) => t.id === id);
  if (index === -1) return;
  const now = new Date().toISOString();
  const updated = {
    ...templates[index],
    usageCount: (templates[index].usageCount || 0) + 1,
    lastUsedAt: now,
  };
  const updatedTemplates = [...templates];
  updatedTemplates[index] = updated;
  await persistTemplates(updatedTemplates);
}

// ---- Identity data access ----

/**
 * Fetch all mail identities from Thunderbird accounts and return structured data.
 * Separates data retrieval from DOM rendering so label-formatting logic is unit-testable.
 */
export async function getIdentities() {
  const accounts = await messenger.accounts.list();
  const identities = [];
  for (const account of accounts) {
    for (const identity of account.identities || []) {
      identities.push({
        id: identity.id,
        label: identity.name ? `${identity.name} (${identity.email})` : identity.email,
        email: identity.email,
      });
    }
  }
  return identities;
}

// ---- Identity filtering ----

/** Check if a template is allowed for the given identity (empty identities list means allowed for all). */
export function isTemplateAllowedForIdentity(template, identityId) {
  if (!template.identities || template.identities.length === 0) return true;
  return template.identities.includes(identityId);
}

// ---- Prefill template (cross-page channel) ----

const PREFILL_KEY = "_prefillTemplate";

export async function setPrefillTemplate(data) {
  await messenger.storage.local.set({ [PREFILL_KEY]: data });
}

export async function consumePrefillTemplate() {
  const result = await messenger.storage.local.get({ [PREFILL_KEY]: null });
  const prefill = result[PREFILL_KEY];
  if (prefill) {
    await messenger.storage.local.remove(PREFILL_KEY);
  }
  return prefill;
}

export { PREFILL_KEY };

// ---- Export ----

/** Serialise all templates into an export payload string. Strips internal-only fields. */
export async function exportTemplates() {
  const templates = await getTemplates();
  const safeTemplates = templates.map(
    ({ id, usageCount, lastUsedAt, createdAt, updatedAt, pinned, ...t }) => ({
      ...t,
      attachments: (t.attachments || []).map(({ data: _data, ...rest }) => rest),
    })
  );
  return JSON.stringify(
    {
      version: EXPORT_FORMAT_VERSION,
      schemaVersion: CURRENT_SCHEMA,
      exportedAt: new Date().toISOString(),
      templates: safeTemplates,
    },
    null,
    2
  );
}

// ---- Grouping ----

/** Group templates by category, returning sorted category keys and uncategorized templates. */
export function groupTemplatesByCategory(templates) {
  const byCategory = {};
  const uncategorized = [];
  for (const t of templates) {
    if (t.category) {
      (byCategory[t.category] ??= []).push(t);
    } else {
      uncategorized.push(t);
    }
  }
  return {
    sortedCategories: Object.keys(byCategory).sort(),
    byCategory,
    uncategorized,
  };
}

// ---- Sorting ----

/** Sort templates by category then by name (case-insensitive). */
export function getSortedTemplates(templates) {
  return [...templates].sort((a, b) => {
    const catA = (a.category || "").toLowerCase();
    const catB = (b.category || "").toLowerCase();
    if (catA !== catB) return catA.localeCompare(catB);
    return (a.name || "").localeCompare(b.name || "");
  });
}

/**
 * Sort for the popup: pinned templates first (alpha by name),
 * then unpinned (most-recently-used first, untouched last).
 * Pure function — no DOM, no storage.
 */
export function getPopupSortedTemplates(templates) {
  const pinned = templates.filter((t) => t.pinned);
  const unpinned = templates.filter((t) => !t.pinned);
  pinned.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  unpinned.sort((a, b) => {
    if (!a.lastUsedAt && !b.lastUsedAt) return (a.name || "").localeCompare(b.name || "");
    if (!a.lastUsedAt) return 1;
    if (!b.lastUsedAt) return -1;
    return b.lastUsedAt.localeCompare(a.lastUsedAt);
  });
  return [...pinned, ...unpinned];
}

// ---- Settings: per-identity defaults ----

async function readSettings() {
  const result = await messenger.storage.local.get({ [SETTINGS_KEY]: {} });
  return result[SETTINGS_KEY] || {};
}

async function writeSettings(settings) {
  await messenger.storage.local.set({ [SETTINGS_KEY]: settings });
}

/** Returns a map of identityId → templateId. Missing key → empty object. */
export async function getDefaults() {
  const settings = await readSettings();
  return { ...(settings.defaults || {}) };
}

async function setDefaults(defaults) {
  const settings = await readSettings();
  settings.defaults = defaults;
  await writeSettings(settings);
}

/** Set or clear the default template for an identity. Pass `null`/`""` to clear. */
export async function setDefault(identityId, templateId) {
  if (!identityId) return;
  const defaults = await getDefaults();
  if (templateId) {
    defaults[identityId] = templateId;
  } else {
    delete defaults[identityId];
  }
  await setDefaults(defaults);
}

// ---- Import merge strategy ----

/**
 * Import templates into storage using the specified merge mode.
 *
 * @param {Array<Object>} validTemplates - Pre-validated (and pre-sanitized) template objects to import.
 *   Each template should have tracking fields (id, createdAt, updatedAt, usageCount, lastUsedAt) already stripped.
 * @param {"append"|"skip"|"replace"} mode - Merge strategy:
 *   - "append"  — always add as a new template, even if a duplicate name exists
 *   - "skip"    — leave existing templates unchanged when a name collision is found
 *   - "replace" — overwrite the existing template when a name collision is found
 * @returns {Promise<{added: number, skipped: number, replaced: number}>}
 */
export async function importTemplates(validTemplates, mode) {
  const existingTemplates = await getTemplates();
  const existingByName = new Map(existingTemplates.map((t) => [t.name.toLowerCase(), t]));

  let added = 0;
  let skipped = 0;
  let replaced = 0;

  for (const template of validTemplates) {
    const nameKey = template.name.trim().toLowerCase();
    const existing = existingByName.get(nameKey);

    if (existing) {
      if (mode === "skip") {
        skipped++;
        continue;
      }
      if (mode === "replace") {
        try {
          const saved = await saveTemplate({ ...template, id: existing.id });
          existingByName.set(nameKey, saved);
          replaced++;
        } catch (err) {
          console.error("TemplateWing: import replace failed for", template.name, err);
          skipped++;
        }
        continue;
      }
    }

    // mode === "append" or no duplicate
    try {
      const saved = await saveTemplate(template);
      existingByName.set(nameKey, saved);
      added++;
    } catch (err) {
      console.error("TemplateWing: import failed for template", template.name, err);
      skipped++;
    }
  }

  return { added, skipped, replaced };
}

// Test-only: reset the in-memory cache so tests using a fresh messenger stub
// are not poisoned by state from earlier tests.
export function _resetCacheForTests() {
  _cache = null;
}
