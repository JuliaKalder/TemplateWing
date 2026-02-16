import { getTemplates, getTemplate } from "../modules/template-store.js";
import { insertTemplateIntoTab } from "../modules/template-insert.js";

function localize() {
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const key = el.getAttribute("data-i18n");
    el.textContent = messenger.i18n.getMessage(key);
  }
  for (const el of document.querySelectorAll("[data-i18n-placeholder]")) {
    const key = el.getAttribute("data-i18n-placeholder");
    el.placeholder = messenger.i18n.getMessage(key);
  }
}

async function renderTemplateList() {
  const list = document.getElementById("template-list");
  const emptyState = document.getElementById("empty-state");
  const templates = await getTemplates();

  list.replaceChildren();

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
    item.dataset.name = template.name.toLowerCase();
    item.dataset.subject = (template.subject || "").toLowerCase();

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

  await insertTemplateIntoTab(tabs[0].id, template);
  window.close();
}

function filterTemplates() {
  const query = document.getElementById("search-input").value.toLowerCase().trim();
  const items = document.querySelectorAll("#template-list .template-item");
  for (const item of items) {
    const matches = !query
      || item.dataset.name.includes(query)
      || item.dataset.subject.includes(query);
    item.hidden = !matches;
  }
}

document.getElementById("search-input").addEventListener("input", filterTemplates);

document.getElementById("btn-manage").addEventListener("click", async () => {
  await messenger.runtime.openOptionsPage();
  const allWindows = await messenger.windows.getAll();
  for (const win of allWindows) {
    if (win.type === "normal") {
      await messenger.windows.update(win.id, { focused: true });
      break;
    }
  }
  window.close();
});

localize();
renderTemplateList();
