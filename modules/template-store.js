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
    templates.push(template);
  }

  await messenger.storage.local.set({ [STORAGE_KEY]: templates });
  return template;
}

export async function deleteTemplate(id) {
  const templates = await getTemplates();
  const filtered = templates.filter((t) => t.id !== id);
  await messenger.storage.local.set({ [STORAGE_KEY]: filtered });
}
