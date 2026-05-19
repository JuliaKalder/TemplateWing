export const STORAGE_KEY = "templates";
export const SCHEMA_KEY = "schemaVersion";
export const CURRENT_SCHEMA = 1;
export const EXPORT_FORMAT_VERSION = "2.2";

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

const migrations = [migrateV0toV1];

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

/** Save (create or update) a template. Throws if name is missing. */
export async function saveTemplate(template) {
  if (!template || typeof template.name !== "string" || !template.name.trim()) {
    throw new TypeError("template.name must be a non-empty string");
  }
  const templates = await getTemplates();
  const now = new Date().toISOString();

  if (template.id) {
    const index = templates.findIndex((t) => t.id === template.id);
    if (index !== -1) {
      templates[index] = { ...templates[index], ...template, updatedAt: now };
    } else {
      templates.push({ ...template, createdAt: now, updatedAt: now });
    }
  } else {
    const newTemplate = {
      id: generateId(),
      attachments: [],
      insertMode: "append",
      category: "",
      to: [],
      cc: [],
      bcc: [],
      identities: [],
      ...template,
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

/** Delete a template by ID. */
export async function deleteTemplate(id) {
  const templates = await getTemplates();
  const filtered = templates.filter((t) => t.id !== id);
  await persistTemplates(filtered);
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

// Test-only: reset the in-memory cache so tests using a fresh messenger stub
// are not poisoned by state from earlier tests.
export function _resetCacheForTests() {
  _cache = null;
}
