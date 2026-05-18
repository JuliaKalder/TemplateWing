export const STORAGE_KEY = "templates";
export const SCHEMA_KEY = "schemaVersion";
export const CURRENT_SCHEMA = 1;

export function generateId() {
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
  for (const t of templates) {
    if (typeof t.name !== "string" || !t.name.trim()) {
      t.name = "(unnamed)";
      changed = true;
    }
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
  const templates = await loadTemplates();
  return [...templates];
}

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

export async function getCategories() {
  const templates = await getTemplates();
  return [...new Set(templates.map((t) => t.category).filter(Boolean))].sort();
}

export async function deleteTemplate(id) {
  const templates = await getTemplates();
  const filtered = templates.filter((t) => t.id !== id);
  await persistTemplates(filtered);
}

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

// Test-only: reset the in-memory cache so tests using a fresh messenger stub
// are not poisoned by state from earlier tests.
export function _resetCacheForTests() {
  _cache = null;
}
