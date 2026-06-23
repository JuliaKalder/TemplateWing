import {
  getTemplates,
  getTemplate,
  trackUsage,
  isTemplateAllowedForIdentity,
  getPopupSortedTemplates,
  setPinned,
  INSERT_MODES,
} from "../modules/template-store.js";
import { insertTemplateIntoTab, extractPromptTokens } from "../modules/template-insert.js";
import { setFilterOptions } from "../modules/ui-helpers.js";
import { getIdentityIdForTab } from "../modules/compose-utils.js";

const SEARCH_SESSION_KEY = "templatewing.popup.search";

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

  const templates = getPopupSortedTemplates(
    allTemplates.filter((t) => isTemplateAllowedForIdentity(t, currentIdentityId))
  );

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
    item.dataset.id = template.id;
    item.dataset.name = (template.name || "").toLowerCase();
    item.dataset.subject = (template.subject || "").toLowerCase();
    item.dataset.category = (template.category || "").toLowerCase();

    const topRow = document.createElement("div");
    topRow.className = "top-row";

    const pinBtn = document.createElement("button");
    pinBtn.className = "pin-btn" + (template.pinned ? " pinned" : "");
    pinBtn.type = "button";
    pinBtn.textContent = template.pinned ? "★" : "☆";
    pinBtn.title = messenger.i18n.getMessage(
      template.pinned ? "popupUnpinTemplate" : "popupPinTemplate"
    );
    pinBtn.setAttribute(
      "aria-label",
      messenger.i18n.getMessage(template.pinned ? "popupUnpinTemplate" : "popupPinTemplate")
    );
    pinBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await setPinned(template.id, !template.pinned);
      await renderTemplateList();
      applyFilter();
    });
    topRow.appendChild(pinBtn);

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = template.name;
    topRow.appendChild(name);

    const btn = document.createElement("button");
    btn.className = "insert-btn";
    btn.textContent = messenger.i18n.getMessage("popupInsert");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      insertTemplate(template.id);
    });
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
  // Cursor mode AND prompt-bearing templates both delegate to the background.
  // Cursor mode needs the popup closed so the compose editor regains focus
  // for the Range API. Prompt dialogs need to outlive the closing popup, so
  // the background opens them in a long-lived popup window instead.
  const hasPrompts =
    extractPromptTokens(`${template.body || ""}\n${template.subject || ""}`).length > 0;
  if (template.insertMode === INSERT_MODES.CURSOR || hasPrompts) {
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
      } else if (err && err.code === "PROMPT_CANCELLED") {
        // User cancelled a {PROMPT}/{CHOICE} dialog — silent abort.
        return;
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

function getVisibleItems() {
  return Array.from(document.querySelectorAll("#template-list .template-item")).filter(
    (item) => !item.hidden
  );
}

function applyFilter() {
  const input = document.getElementById("search-input");
  const query = input.value.toLowerCase().trim();
  const selectedCategory = document.getElementById("category-filter").value.toLowerCase();

  for (const item of document.querySelectorAll("#template-list .template-item")) {
    const matchesSearch =
      !query ||
      item.dataset.name.includes(query) ||
      item.dataset.subject.includes(query) ||
      item.dataset.category.includes(query);
    const matchesCategory = !selectedCategory || item.dataset.category === selectedCategory;
    item.hidden = !(matchesSearch && matchesCategory);
  }

  // Empty-state for "no template matches the current filter" (distinct
  // from "no templates exist", which renderTemplateList already handles).
  const noMatchEl = document.getElementById("no-match-state");
  const list = document.getElementById("template-list");
  const anyTemplates = list.children.length > 0;
  const anyVisible = getVisibleItems().length > 0;
  noMatchEl.hidden = !(anyTemplates && !anyVisible);
}

function onSearchInput() {
  applyFilter();
  try {
    sessionStorage.setItem(SEARCH_SESSION_KEY, document.getElementById("search-input").value);
  } catch (_) {
    /* sessionStorage may be unavailable in some contexts */
  }
}

function onSearchKeydown(e) {
  const input = e.currentTarget;
  if (e.key === "Enter") {
    e.preventDefault();
    const visible = getVisibleItems();
    if (visible.length > 0) {
      const firstId = visible[0].dataset.id;
      if (firstId) insertTemplate(firstId);
    }
    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    input.value = "";
    try {
      sessionStorage.removeItem(SEARCH_SESSION_KEY);
    } catch (_) {
      /* ignore */
    }
    applyFilter();
    input.focus();
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

const searchInput = document.getElementById("search-input");
searchInput.addEventListener("input", onSearchInput);
searchInput.addEventListener("keydown", onSearchKeydown);
document.getElementById("category-filter").addEventListener("change", applyFilter);

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

// Restore last query from this browser session only — explicitly NOT
// persisted across restarts (sessionStorage, not localStorage).
try {
  const saved = sessionStorage.getItem(SEARCH_SESSION_KEY);
  if (saved) {
    searchInput.value = saved;
    applyFilter();
  }
} catch (_) {
  /* ignore */
}

searchInput.focus();
searchInput.select();
