import { getTemplates, getTemplate, trackUsage } from "./modules/template-store.js";
import { insertTemplateIntoTab } from "./modules/template-insert.js";

async function notifyInsertFailure(err) {
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
  } catch (notifyErr) {
    console.error("TemplateWing: could not show notification", notifyErr);
  }
}

async function getCurrentIdentityId(tabId) {
  try {
    const details = await messenger.compose.getComposeDetails(tabId);
    return details.identityId || null;
  } catch (err) {
    console.warn("TemplateWing: could not get current identity", err);
    return null;
  }
}

function isTemplateAllowedForIdentity(template, identityId) {
  if (!template.identities || template.identities.length === 0) return true;
  return template.identities.includes(identityId);
}

function getSortedTemplates(templates) {
  return [...templates].sort((a, b) => {
    const catA = (a.category || "").toLowerCase();
    const catB = (b.category || "").toLowerCase();
    if (catA !== catB) return catA.localeCompare(catB);
    return a.name.localeCompare(b.name);
  });
}

function getCategoryMenuId(category, index) {
  const slug = category.replace(/[^a-zA-Z0-9]/g, "_") || "uncategorized";
  return `templatewing-cat-${slug}-${index}`;
}

async function buildContextMenu(identityId = null) {
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

  const templates = (await getTemplates()).filter((t) =>
    isTemplateAllowedForIdentity(t, identityId)
  );

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

  for (const [index, category] of sortedCategories.entries()) {
    const categoryId = getCategoryMenuId(category, index);
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

  const currentIdentityId = await getCurrentIdentityId(tab.id);
  if (!isTemplateAllowedForIdentity(template, currentIdentityId)) {
    console.warn("TemplateWing: template not allowed for current identity");
    return;
  }

  try {
    await insertTemplateIntoTab(tab.id, template);
    await trackUsage(templateId);
  } catch (err) {
    console.error("TemplateWing: insert failed from context menu", err);
    await notifyInsertFailure(err);
  }
});

messenger.commands.onCommand.addListener(async (commandName) => {
  if (!commandName.startsWith("insert-template-")) return;

  const index = parseInt(commandName.replace("insert-template-", ""), 10) - 1;
  const allTemplates = await getTemplates();

  const tabs = await messenger.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (tabs.length === 0) return;

  const currentIdentityId = await getCurrentIdentityId(tabs[0].id);

  const templates = getSortedTemplates(
    allTemplates.filter((t) => isTemplateAllowedForIdentity(t, currentIdentityId))
  );

  if (index < 0 || index >= templates.length) return;

  const template = templates[index];

  try {
    await insertTemplateIntoTab(tabs[0].id, template);
    await trackUsage(template.id);
  } catch (err) {
    console.error("TemplateWing: insert failed from keyboard shortcut", err);
    await notifyInsertFailure(err);
  }
});

messenger.runtime.onMessage.addListener(async (message) => {
  if (!message || !message.action) return;

  if (message.action === "templatesChanged") {
    buildContextMenu();
    return;
  }

  // Popup delegates cursor-mode insertion here so it can close first and
  // return focus to the compose window before the insert runs.
  if (message.action === "templatewing:insertTemplate") {
    // Give the popup a tick to tear down so the compose window is focused
    // when we forward the insert request to the compose script. 150ms is
    // empirically enough on slow systems while still feeling instant.
    await new Promise((resolve) => setTimeout(resolve, 150));
    try {
      const template = await getTemplate(message.templateId);
      if (!template) return;
      await insertTemplateIntoTab(message.tabId, template);
      await trackUsage(message.templateId);
    } catch (err) {
      console.error("TemplateWing: insert failed from popup delegation", err);
      await notifyInsertFailure(err);
    }
  }
});

messenger.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.templates) {
    buildContextMenu();
  }
});

messenger.menus.onShown.addListener(async (info, tab) => {
  if (!info.contexts || !info.contexts.includes("compose_body") || !tab || !tab.id) {
    return;
  }
  const identityId = await getCurrentIdentityId(tab.id);
  await buildContextMenu(identityId);
  messenger.menus.refresh();
});

buildContextMenu();

// Thunderbird MV2's official mechanism for compose scripts is the
// `composeScripts.register()` runtime API, not the `compose_scripts`
// manifest key. The manifest key produces "unexpected property" schema
// warnings on TB 128 and — crucially — silently fails to inject in
// many cases (verified in field logs for v2.3.6 and v2.3.7), which
// caused cursor-mode inserts to degrade to the smart-insert fallback
// and append at end of body.
//
// Programmatic registration persists for the add-on's lifetime and
// auto-injects into every compose window that opens *after* the call.
// For compose windows that were already open when the add-on loaded
// (or that survived a reload), `register()` does not retroactively
// inject — we still executeScript those explicitly. Repeated injection
// is idempotent via the window.__templateWingCompose listener-swap
// guard in compose-script.js.
async function injectComposeScript(tabId) {
  try {
    await messenger.tabs.executeScript(tabId, {
      file: "/modules/compose-script.js",
    });
    console.log("TemplateWing: compose-script injected into tab", tabId);
  } catch (err) {
    console.warn(
      "TemplateWing: compose-script inject failed for tab",
      tabId,
      err && err.message
    );
  }
}

(async function setupComposeScripts() {
  try {
    await messenger.composeScripts.register({
      js: [{ file: "/modules/compose-script.js" }],
    });
    console.log("TemplateWing: composeScripts.register ok");
  } catch (err) {
    console.warn("TemplateWing: composeScripts.register failed", err);
  }

  try {
    const tabs = await messenger.tabs.query({ windowType: "messageCompose" });
    for (const tab of tabs) {
      if (!tab || typeof tab.id !== "number") continue;
      await injectComposeScript(tab.id);
    }
  } catch (err) {
    console.warn("TemplateWing: compose-script backfill query failed", err);
  }
})();
