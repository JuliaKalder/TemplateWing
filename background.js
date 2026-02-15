import { getTemplates } from "./modules/template-store.js";

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
  const { getTemplate } = await import("./modules/template-store.js");
  const template = await getTemplate(templateId);
  if (!template) return;

  const details = await messenger.compose.getComposeDetails(tab.id);
  const body = details.body || "";
  await messenger.compose.setComposeDetails(tab.id, {
    body: body + template.body,
  });

  if (template.subject) {
    await messenger.compose.setComposeDetails(tab.id, {
      subject: template.subject,
    });
  }

  if (template.attachments && template.attachments.length > 0) {
    for (const att of template.attachments) {
      const binary = atob(att.data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const file = new File([bytes], att.name, { type: att.type });
      await messenger.compose.addAttachment(tab.id, { file, name: att.name });
    }
  }
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
