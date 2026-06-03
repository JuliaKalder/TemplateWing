import {
  getTemplates,
  getTemplate,
  trackUsage,
  isTemplateAllowedForIdentity,
  INSERT_MODES,
} from "../modules/template-store.js";
import { insertTemplateIntoTab } from "../modules/template-insert.js";
import { setFilterOptions } from "../modules/ui-helpers.js";
import { getIdentityIdForTab } from "../modules/compose-utils.js";

async function getCurrentIdentityId() {
  const tabs = await messenger.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (tabs.length === 0) return null;
  return getIdentityIdForTab(tabs[0].id);
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
  for (const el of document.querySelectorAll("[data-i18n-title]")) {
    const key = el.getAttribute("data-i18n-title");
    el.title = messenger.i18n.getMessage(key);
  }
}

async function renderTemplateList() {
  const list = document.getElementById("template-list");
  const emptyState = document.getElementById("empty-state");
  const allTemplates = await getTemplates();
  const currentIdentityId = await getCurrentIdentityId();

  const templates = allTemplates
    .filter((t) => isTemplateAllowedForIdentity(t, currentIdentityId))
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
    item.dataset.name = (template.name || "").toLowerCase();
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

    const hasTemplateMeta =
      template.category || (template.attachments && template.attachments.length > 0);
    const hasShortcut = i < 9;

    if (hasTemplateMeta || hasShortcut) {
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
  const currentIdentityId = await getCurrentIdentityId();
  if (!isTemplateAllowedForIdentity(template, currentIdentityId)) {
    return;
  }

  // Cursor-mode insertion runs in the compose-script (Range API) and needs
  // the compose window to hold focus / have a live selection. While the popup
  // is open, focus sits with the popup and the editor's selection collapses,
  // so the insert lands at the wrong place (or falls back to prepend).
  // Delegate to the background page so the popup can close first; the
  // background then runs the insert against the focused compose window.
  // Other modes use setComposeDetails and don't need focus.
  if (template.insertMode === INSERT_MODES.CURSOR) {
    messenger.runtime.sendMessage({
      action: "templatewing:insertTemplate",
      tabId: tabs[0].id,
      templateId: id,
    });
    window.close();
    return;
  }

  try {
    await insertTemplateIntoTab(tabs[0].id, template);
  } catch (err) {
    console.error("TemplateWing: insert failed", err);
    try {
      const title = messenger.i18n.getMessage("notificationInsertFailedTitle");
      let message;
      if (err && err.code === "ATTACHMENT_FAILED" && Array.isArray(err.failedNames)) {
        message = messenger.i18n.getMessage(
          "notificationAttachmentFailed",
          err.failedNames.join(", ")
        );
      } else {
        message = messenger.i18n.getMessage("notificationInsertFailedGeneric");
      }
      await messenger.notifications.create({
        type: "basic",
        iconUrl: messenger.runtime.getURL("images/icon-64.png"),
        title,
        message,
      });
    } catch (_) {
      /* ignore notification failure */
    }
    return;
  }
  await trackUsage(id);
  window.close();
}

function filterTemplates() {
  const query = document.getElementById("search-input").value.toLowerCase().trim();
  const selectedCategory = document.getElementById("category-filter").value.toLowerCase();
  const items = document.querySelectorAll("#template-list .template-item");
  for (const item of items) {
    const matchesSearch =
      !query || item.dataset.name.includes(query) || item.dataset.subject.includes(query);
    const matchesCategory = !selectedCategory || item.dataset.category === selectedCategory;
    item.hidden = !(matchesSearch && matchesCategory);
  }
}

async function populateCategoryFilter() {
  const currentIdentityId = await getCurrentIdentityId();
  const allTemplates = await getTemplates();
  const visibleTemplates = allTemplates.filter((t) =>
    isTemplateAllowedForIdentity(t, currentIdentityId)
  );
  const categories = [...new Set(visibleTemplates.map((t) => t.category).filter(Boolean))].sort();
  setFilterOptions("category-filter", categories);
}

document.getElementById("search-input").addEventListener("input", filterTemplates);
document.getElementById("category-filter").addEventListener("change", filterTemplates);

// Thunderbird opens the options page in an Add-ons Manager tab that may live
// in a background window. Focus the first normal window so it comes to front.
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
await renderTemplateList();
await populateCategoryFilter();
