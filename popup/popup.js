import { getTemplates, getTemplate } from "../modules/template-store.js";

function localize() {
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const key = el.getAttribute("data-i18n");
    el.textContent = messenger.i18n.getMessage(key);
  }
}

async function renderTemplateList() {
  const list = document.getElementById("template-list");
  const emptyState = document.getElementById("empty-state");
  const templates = await getTemplates();

  list.innerHTML = "";

  if (templates.length === 0) {
    list.hidden = true;
    emptyState.hidden = false;
    return;
  }

  list.hidden = false;
  emptyState.hidden = true;

  for (const template of templates) {
    const item = document.createElement("div");
    item.className = "template-item";

    const nameRow = document.createElement("div");
    nameRow.className = "name-row";

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = template.name;
    nameRow.appendChild(name);

    if (template.attachments && template.attachments.length > 0) {
      const badge = document.createElement("span");
      badge.className = "att-badge";
      badge.textContent = template.attachments.length;
      badge.title = messenger.i18n.getMessage(
        "popupAttachmentCount",
        String(template.attachments.length)
      );
      nameRow.appendChild(badge);
    }

    const btn = document.createElement("button");
    btn.className = "insert-btn";
    btn.textContent = messenger.i18n.getMessage("popupInsert");
    btn.addEventListener("click", () => insertTemplate(template.id));

    item.appendChild(nameRow);
    item.appendChild(btn);
    list.appendChild(item);
  }
}

async function insertTemplate(id) {
  const template = await getTemplate(id);
  if (!template) return;

  const tabs = await messenger.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (tabs.length === 0) return;

  const tab = tabs[0];
  const details = await messenger.compose.getComposeDetails(tab.id);

  if (template.body) {
    const body = details.body || "";
    await messenger.compose.setComposeDetails(tab.id, {
      body: body + template.body,
    });
  }

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

  window.close();
}

document.getElementById("btn-manage").addEventListener("click", () => {
  messenger.runtime.openOptionsPage();
  window.close();
});

localize();
renderTemplateList();
