import { getTemplates, getTemplate, trackUsage } from "./modules/template-store.js";
import { insertTemplateIntoTab } from "./modules/template-insert.js";

function getSortedTemplates(templates) {
  return [...templates].sort((a, b) => {
    const catA = (a.category || "").toLowerCase();
    const catB = (b.category || "").toLowerCase();
    if (catA !== catB) return catA.localeCompare(catB);
    return a.name.localeCompare(b.name);
  });
}

async function buildContextMenu() {
  await messenger.menus.removeAll();

  messenger.menus.create({
    id: "templatewing-root",
    title: messenger.i18n.getMessage("menuInsertTemplate"),
    contexts: ["compose_body"],
  });

  messenger.menus.create({
    id: "templatewing-save-as-template",
    title: messenger.i18n.getMessage("menuSaveAsTemplate"),
    contexts: ["message_list"],
  });

  const templates = await getTemplates();

  if (templates.length === 0) {
    messenger.menus.create({
      id: "templatewing-empty",
      title: messenger.i18n.getMessage("menuNoTemplates"),
      parentId: "templatewing-root",
      contexts: ["compose_body"],
      enabled: false,
    });
    return;
  }

  const categorized = {};
  const uncategorized = [];

  for (const template of templates) {
    if (template.category) {
      if (!categorized[template.category]) {
        categorized[template.category] = [];
      }
      categorized[template.category].push(template);
    } else {
      uncategorized.push(template);
    }
  }

  const sortedCategories = Object.keys(categorized).sort();

  for (const category of sortedCategories) {
    const categoryId = `templatewing-cat-${category.replace(/[^a-zA-Z0-9]/g, "_")}`;
    messenger.menus.create({
      id: categoryId,
      title: category,
      parentId: "templatewing-root",
      contexts: ["compose_body"],
    });

    for (const template of categorized[category]) {
      messenger.menus.create({
        id: `templatewing-insert-${template.id}`,
        title: template.name,
        parentId: categoryId,
        contexts: ["compose_body"],
      });
    }
  }

  for (const template of uncategorized) {
    messenger.menus.create({
      id: `templatewing-insert-${template.id}`,
      title: template.name,
      parentId: "templatewing-root",
      contexts: ["compose_body"],
    });
  }
}

function findPart(part, contentType) {
  if (part.contentType === contentType && part.body) return part.body;
  if (part.parts) {
    for (const child of part.parts) {
      const found = findPart(child, contentType);
      if (found) return found;
    }
  }
  return null;
}

function extractBody(part) {
  const html = findPart(part, "text/html");
  if (html) return { html: true, body: html };
  const plain = findPart(part, "text/plain");
  if (plain) return { html: false, body: plain };
  return null;
}

messenger.menus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "templatewing-save-as-template") {
    const messages = info.selectedMessages && info.selectedMessages.messages;
    if (!messages || messages.length === 0) return;

    const msg = messages[0];
    let body = "";
    try {
      const full = await messenger.messages.getFull(msg.id);
      const extracted = extractBody(full);
      if (extracted) {
        body = extracted.html
          ? extracted.body
          : extracted.body.replace(/\n/g, "<br>");
      }
    } catch (e) {
      console.error("TemplateWing: could not get message body", e);
    }

    await messenger.storage.local.set({
      _prefillTemplate: { subject: msg.subject || "", body },
    });
    await messenger.runtime.openOptionsPage();
    return;
  }

  if (!info.menuItemId.startsWith("templatewing-insert-")) return;

  const templateId = info.menuItemId.replace("templatewing-insert-", "");
  const template = await getTemplate(templateId);
  if (!template) return;

  await insertTemplateIntoTab(tab.id, template);
  await trackUsage(templateId);
});

messenger.commands.onCommand.addListener(async (commandName) => {
  if (!commandName.startsWith("insert-template-")) return;

  const index = parseInt(commandName.replace("insert-template-", ""), 10) - 1;
  const templates = getSortedTemplates(await getTemplates());

  if (index < 0 || index >= templates.length) return;

  const template = templates[index];

  const tabs = await messenger.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (tabs.length === 0) return;

  await insertTemplateIntoTab(tabs[0].id, template);
});

messenger.runtime.onMessage.addListener((message) => {
  if (message.action === "templatesChanged") {
    buildContextMenu();
  }
});

messenger.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.templates) {
    buildContextMenu();
  }
});

buildContextMenu();
