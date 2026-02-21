import { getTemplates, getTemplate, getCategories, trackUsage } from "../modules/template-store.js";
import { insertTemplateIntoTab } from "../modules/template-insert.js";

async function getCurrentIdentityId() {
  try {
    const tabs = await messenger.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tabs.length === 0) return null;
    const details = await messenger.compose.getComposeDetails(tabs[0].id);
    return details.identityId || null;
  } catch (err) {
    console.warn("TemplateWing: could not get current identity", err);
    return null;
  }
}

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
  const allTemplates = await getTemplates();
  const currentIdentityId = await getCurrentIdentityId();

  const templates = allTemplates
    .filter((t) => {
      if (!t.identities || t.identities.length === 0) return true;
      return t.identities.includes(currentIdentityId);
    })
    .slice()
    .sort((a, b) => {
      if (!a.lastUsedAt && !b.lastUsedAt) return 0;
      if (!a.lastUsedAt) return 1;
      if (!b.lastUsedAt) return -1;
      return b.lastUsedAt.localeCompare(a.lastUsedAt);
    });

  list.replaceChildren();

  if (templates.length === 0) {
    list.hidden = true;
    emptyState.hidden = false;
    return;
  }

  list.hidden = false;
  emptyState.hidden = true;

  for (let i = 0; i < templates.length; i++) {
    const template = templates[i];
    const item = document.createElement("div");
    item.className = "template-item";
    item.dataset.name = template.name.toLowerCase();
    item.dataset.subject = (template.subject || "").toLowerCase();
    item.dataset.category = (template.category || "").toLowerCase();

    const topRow = document.createElement("div");
    topRow.className = "top-row";

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = template.name;
    topRow.appendChild(name);

    const btn = document.createElement("button");
    btn.className = "insert-btn";
    btn.textContent = messenger.i18n.getMessage("popupInsert");
    btn.addEventListener("click", () => insertTemplate(template.id));
    topRow.appendChild(btn);

    item.appendChild(topRow);

    const hasMeta = template.category
      || (template.attachments && template.attachments.length > 0)
      || i < 9;

    if (hasMeta) {
      const metaRow = document.createElement("div");
      metaRow.className = "meta-row";

      if (template.category) {
        const catBadge = document.createElement("span");
        catBadge.className = "category-badge";
        catBadge.textContent = template.category;
        metaRow.appendChild(catBadge);
      }

      if (template.attachments && template.attachments.length > 0) {
        const badge = document.createElement("span");
        badge.className = "att-badge";
        badge.textContent = template.attachments.length;
        badge.title = messenger.i18n.getMessage(
          "popupAttachmentCount",
          String(template.attachments.length)
        );
        metaRow.appendChild(badge);
      }

      if (i < 9) {
        const shortcutBadge = document.createElement("span");
        shortcutBadge.className = "shortcut-badge";
        shortcutBadge.textContent = `Ctrl+Shift+${i + 1}`;
        metaRow.appendChild(shortcutBadge);
      }

      item.appendChild(metaRow);
    }

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
  await trackUsage(id);
  window.close();
}

function filterTemplates() {
  const query = document.getElementById("search-input").value.toLowerCase().trim();
  const selectedCategory = document.getElementById("category-filter").value.toLowerCase();
  const items = document.querySelectorAll("#template-list .template-item");
  for (const item of items) {
    const matchesSearch = !query
      || item.dataset.name.includes(query)
      || item.dataset.subject.includes(query);
    const matchesCategory = !selectedCategory
      || item.dataset.category === selectedCategory;
    item.style.display = (matchesSearch && matchesCategory) ? "" : "none";
  }
}

async function populateCategoryFilter() {
  const filter = document.getElementById("category-filter");
  const categories = await getCategories();
  const options = filter.querySelectorAll("option:not(:first-child)");
  options.forEach((opt) => opt.remove());
  for (const cat of categories) {
    const option = document.createElement("option");
    option.value = cat;
    option.textContent = cat;
    filter.appendChild(option);
  }
}

document.getElementById("search-input").addEventListener("input", filterTemplates);
document.getElementById("category-filter").addEventListener("change", filterTemplates);

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
renderTemplateList().then(() => populateCategoryFilter());
