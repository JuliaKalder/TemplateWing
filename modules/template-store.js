const STORAGE_KEY = "templates";

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

export async function getTemplates() {
  const result = await messenger.storage.local.get({ [STORAGE_KEY]: [] });
  return result[STORAGE_KEY];
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

  await messenger.storage.local.set({ [STORAGE_KEY]: templates });
  return template;
}

export async function getCategories() {
  const templates = await getTemplates();
  const categories = templates
    .map((t) => t.category)
    .filter(Boolean)
    .filter((cat, idx, arr) => arr.indexOf(cat) === idx)
    .sort();
  return categories;
}

export async function deleteTemplate(id) {
  const templates = await getTemplates();
  const filtered = templates.filter((t) => t.id !== id);
  await messenger.storage.local.set({ [STORAGE_KEY]: filtered });
}

export async function trackUsage(id) {
  const templates = await getTemplates();
  const t = templates.find((t) => t.id === id);
  if (!t) return;
  t.usageCount = (t.usageCount || 0) + 1;
  t.lastUsedAt = new Date().toISOString();
  await messenger.storage.local.set({ [STORAGE_KEY]: templates });
}
