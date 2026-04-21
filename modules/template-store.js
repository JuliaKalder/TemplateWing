export const STORAGE_KEY = "templates";
export const SCHEMA_KEY = "schemaVersion";
export const CURRENT_SCHEMA = 1;

export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

// ---- In-memory cache ----

let _cache = null;
let _categoriesCache = null;

function invalidateCache() {
  _cache = null;
  _categoriesCache = null;
}

async function loadTemplates() {
  if (_cache !== null) return _cache;
  await migrateIfNeeded();
  const result = await messenger.storage.local.get({ [STORAGE_KEY]: [] });
  _cache = result[STORAGE_KEY];
  return _cache;
}

async function persistTemplates(templates) {
  _cache = templates;
  _categoriesCache = null; // Invalidate categories cache since templates changed
  await messenger.storage.local.set({ [STORAGE_KEY]: templates });
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

// Migration 0 → 1: ensure every template has all v2.2 fields
export async function migrateV0toV1(templates) {
  let changed = false;
  for (const t of templates) {
    if (!t.category && t.category !== "") { t.category = ""; changed = true; }
    if (!Array.isArray(t.to)) { t.to = []; changed = true; }
    if (!Array.isArray(t.cc)) { t.cc = []; changed = true; }
    if (!Array.isArray(t.bcc)) { t.bcc = []; changed = true; }
    if (!Array.isArray(t.identities)) { t.identities = []; changed = true; }
    if (!t.insertMode) { t.insertMode = "append"; changed = true; }
    if (!Array.isArray(t.attachments)) { t.attachments = []; changed = true; }
  }
  return { templates, changed };
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

export async function getTemplates() {
  return loadTemplates();
}

export async function getTemplate(id) {
  const templates = await getTemplates();
  return templates.find((t) => t.id === id) || null;
}

export async function saveTemplate(template) {
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
    template.id = generateId();
    template.createdAt = now;
    template.updatedAt = now;
    template.attachments = template.attachments || [];
    template.insertMode = template.insertMode || "append";
    template.category = template.category || "";
    template.to = template.to || [];
    template.cc = template.cc || [];
    template.bcc = template.bcc || [];
    template.identities = template.identities || [];
    templates.push(template);
  }

  await persistTemplates(templates);
  return template;
}

export async function getCategories() {
  if (_categoriesCache !== null) return _categoriesCache;
  const templates = await getTemplates();
  _categoriesCache = templates
    .map((t) => t.category)
    .filter(Boolean)
    .filter((cat, idx, arr) => arr.indexOf(cat) === idx)
    .sort();
  return _categoriesCache;
}

export async function deleteTemplate(id) {
  const templates = await getTemplates();
  const filtered = templates.filter((t) => t.id !== id);
  await persistTemplates(filtered);
}

export async function trackUsage(id) {
  const templates = await getTemplates();
  const t = templates.find((t) => t.id === id);
  if (!t) return;
  t.usageCount = (t.usageCount || 0) + 1;
  t.lastUsedAt = new Date().toISOString();
  await persistTemplates(templates);
}

// Test-only: reset the in-memory cache so tests using a fresh messenger stub
// are not poisoned by state from earlier tests.
export function _resetCacheForTests() {
  _cache = null;
}
