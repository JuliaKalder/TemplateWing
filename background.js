import { getTemplates, getTemplate } from "./modules/template-store.js";
import { insertTemplateIntoTab } from "./modules/template-insert.js";

async function buildContextMenu() {
  await messenger.menus.removeAll();

  messenger.menus.create({
    id: "templatewing-root",
    title: messenger.i18n.getMessage("menuInsertTemplate"),
    contexts: ["compose_body"],
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
  } else {
    for (const template of templates) {
      messenger.menus.create({
        id: `templatewing-insert-${template.id}`,
        title: template.name,
        parentId: "templatewing-root",
        contexts: ["compose_body"],
      });
    }
  }
}

messenger.menus.onClicked.addListener(async (info, tab) => {
  if (!info.menuItemId.startsWith("templatewing-insert-")) return;

  const templateId = info.menuItemId.replace("templatewing-insert-", "");
  const template = await getTemplate(templateId);
  if (!template) return;

  await insertTemplateIntoTab(tab.id, template);
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
