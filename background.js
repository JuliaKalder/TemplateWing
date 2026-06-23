import {
  getTemplates,
  getTemplate,
  trackUsage,
  setPrefillTemplate,
  isTemplateAllowedForIdentity,
  getSortedTemplates,
  groupTemplatesByCategory,
  getDefaults,
} from "./modules/template-store.js";
import { insertTemplateIntoTab, extractPromptTokens } from "./modules/template-insert.js";
import { findPart, extractBody } from "./modules/message-utils.js";
import { getIdentityIdForTab } from "./modules/compose-utils.js";
import { collectPromptAnswers } from "./modules/prompt-collector.js";

async function notifyInsertFailure(err) {
  // User-cancelled prompts are an explicit choice, not a failure — stay silent.
  if (err && err.code === "PROMPT_CANCELLED") return;
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

/**
 * If the template body or subject contains {PROMPT}/{CHOICE} tokens, open
 * the prompt dialog and collect answers. Returns the answers map (possibly
 * empty). Re-throws PROMPT_CANCELLED so callers can abort the insert.
 */
async function collectAnswersForTemplate(template) {
  const combined = `${template.body || ""}\n${template.subject || ""}`;
  const tokens = extractPromptTokens(combined);
  if (tokens.length === 0) return {};
  return await collectPromptAnswers(tokens);
}

function getCategoryMenuId(category, index) {
  // category is always a non-empty string here (from Object.keys(categorized))
  const slug = category.replace(/[^a-zA-Z0-9]/g, "_");
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

  const { sortedCategories, byCategory, uncategorized } = groupTemplatesByCategory(templates);

  for (const [index, category] of sortedCategories.entries()) {
    const categoryId = getCategoryMenuId(category, index);
    messenger.menus.create({
      id: categoryId,
      title: category,
      parentId: "templatewing-root",
      contexts: ["compose_body"],
    });

    for (const template of byCategory[category]) {
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

/**
 * Sanitize email HTML before storing in _prefillTemplate to prevent XSS
 * via inline event handlers (onerror, onload, etc.) when the content
 * is later parsed by DOMParser and inserted into the contenteditable editor.
 */
function sanitizeEmailBodyForPrefill(html) {
  const doc = new DOMParser().parseFromString(html || "", "text/html");
  for (const el of doc.body.querySelectorAll("*")) {
    // Remove all inline event handlers (onerror, onload, onclick, etc.)
    for (const attr of [...el.attributes]) {
      if (attr.name.toLowerCase().startsWith("on")) el.removeAttribute(attr.name);
    }
    // Remove dangerous elements entirely
    if (["SCRIPT", "OBJECT", "EMBED", "IFRAME"].includes(el.tagName)) el.remove();
  }
  return doc.body.innerHTML;
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
          ? sanitizeEmailBodyForPrefill(extracted.body)
          : extracted.body
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;")
              .replace(/\n/g, "<br>");
      }
    } catch (err) {
      console.error("TemplateWing: could not get message body", err);
    }

    await setPrefillTemplate({ subject: msg.subject || "", body });
    await messenger.runtime.openOptionsPage();
    return;
  }

  if (!info.menuItemId.startsWith("templatewing-insert-")) return;

  const templateId = info.menuItemId.replace("templatewing-insert-", "");
  const template = await getTemplate(templateId);
  if (!template) return;

  const currentIdentityId = await getIdentityIdForTab(tab.id);
  if (!isTemplateAllowedForIdentity(template, currentIdentityId)) {
    console.warn("TemplateWing: template not allowed for current identity");
    return;
  }

  try {
    const promptAnswers = await collectAnswersForTemplate(template);
    await insertTemplateIntoTab(tab.id, template, { promptAnswers });
    await trackUsage(templateId);
  } catch (err) {
    console.error("TemplateWing: insert failed from context menu", err);
    await notifyInsertFailure(err);
  }
});

messenger.commands.onCommand.addListener(async (commandName) => {
  if (!commandName.startsWith("insert-template-")) return;

  const parsed = parseInt(commandName.replace("insert-template-", ""), 10);
  if (!Number.isFinite(parsed)) return;
  const index = parsed - 1;
  const allTemplates = await getTemplates();

  const tabs = await messenger.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (tabs.length === 0) return;

  const currentIdentityId = await getIdentityIdForTab(tabs[0].id);

  const templates = getSortedTemplates(
    allTemplates.filter((t) => isTemplateAllowedForIdentity(t, currentIdentityId))
  );

  if (index < 0 || index >= templates.length) return;

  const template = templates[index];

  try {
    const promptAnswers = await collectAnswersForTemplate(template);
    await insertTemplateIntoTab(tabs[0].id, template, { promptAnswers });
    await trackUsage(template.id);
  } catch (err) {
    console.error("TemplateWing: insert failed from keyboard shortcut", err);
    await notifyInsertFailure(err);
  }
});

// Popup delegates cursor-mode insertion here so it can close first and
// return focus to the compose window before the insert runs.
async function handleInsertTemplateFromPopup(message, sender) {
  // Only accept this message from the popup page.
  const expectedUrl = messenger.runtime.getURL("popup/popup.html");
  if (!sender || sender.url !== expectedUrl) {
    console.warn(
      "TemplateWing: rejecting templatewing:insertTemplate from untrusted sender",
      sender && sender.url
    );
    return;
  }

  // Give the popup a tick to tear down so the compose window is focused
  // when we forward the insert request to the compose script.
  const POPUP_TEARDOWN_DELAY_MS = 150;
  await new Promise((resolve) => setTimeout(resolve, POPUP_TEARDOWN_DELAY_MS));
  try {
    // Validate tabId is a compose window before acting on it.
    if (typeof message.tabId !== "number") return;
    const tabDetails = await messenger.compose.getComposeDetails(message.tabId);
    if (!tabDetails) return;

    const template = await getTemplate(message.templateId);
    if (!template) return;

    // Re-validate identity at the enforcement point, not just in the popup UI.
    const currentIdentityId = tabDetails.identityId || null;
    if (!isTemplateAllowedForIdentity(template, currentIdentityId)) {
      console.warn("TemplateWing: templatewing:insertTemplate — identity not allowed");
      return;
    }

    const promptAnswers = await collectAnswersForTemplate(template);
    await insertTemplateIntoTab(message.tabId, template, { promptAnswers });
    await trackUsage(message.templateId);
  } catch (err) {
    console.error("TemplateWing: insert failed from popup delegation", err);
    await notifyInsertFailure(err);
  }
}

// Synchronous listener per Thunderbird MV3 messaging guide:
// an async listener always returns a Promise — even for messages it doesn't
// handle — which signals "I will respond" for every message and conflicts
// with other listeners. Return a Promise *only* from handlers we own; return
// undefined for everything else.
messenger.runtime.onMessage.addListener((message, sender) => {
  if (!message || !message.action) return;

  if (message.action === "templatesChanged") {
    buildContextMenu();
    return;
  }

  if (message.action === "templatewing:insertTemplate") {
    return handleInsertTemplateFromPopup(message, sender);
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
  const identityId = await getIdentityIdForTab(tab.id);
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
    console.warn("TemplateWing: compose-script inject failed for tab", tabId, err && err.message);
  }
}

// ---- Default template per identity (auto-insert on compose open) ----

/**
 * Returns true when the compose body is effectively empty (i.e. nothing the
 * user has typed yet). HTML signatures and quoted reply blocks must NOT
 * count as content — we strip those before testing. If the user already
 * typed even a single word, we skip auto-insert to avoid clobbering work.
 */
function isComposeBodyEmpty(body, isPlainText) {
  if (!body) return true;
  if (isPlainText) {
    // Plaintext signatures live below "-- \n"; reply quotes start with "> ".
    const stripped = body.replace(/\n--\s*\n[\s\S]*$/, "").replace(/^>.*$/gm, "");
    return stripped.trim().length === 0;
  }
  try {
    const doc = new DOMParser().parseFromString(body, "text/html");
    for (const el of doc.body.querySelectorAll(
      ".moz-signature, .moz-cite-prefix, blockquote[type='cite']"
    )) {
      el.remove();
    }
    return (doc.body.textContent || "").trim().length === 0;
  } catch (_) {
    return body.trim().length === 0;
  }
}

async function maybeApplyDefaultTemplate(tabId) {
  let details;
  try {
    details = await messenger.compose.getComposeDetails(tabId);
  } catch (err) {
    return;
  }
  if (!details) return;
  // Replies/forwards intentionally skipped per spec: the user is responding
  // to a specific message and a generic greeting template would overwrite
  // context Thunderbird has already wired up.
  if (details.relatedMessageId != null) return;
  if (!isComposeBodyEmpty(details.body || "", !!details.isPlainText)) return;

  const identityId = details.identityId;
  if (!identityId) return;

  const defaults = await getDefaults();
  const templateId = defaults[identityId];
  if (!templateId) return;

  const template = await getTemplate(templateId);
  if (!template) return;

  try {
    const promptAnswers = await collectAnswersForTemplate(template);
    await insertTemplateIntoTab(tabId, template, { promptAnswers });
    await trackUsage(template.id);
  } catch (err) {
    if (err && err.code === "PROMPT_CANCELLED") return;
    console.error("TemplateWing: default-template auto-insert failed", err);
  }
}

// Auto-insert hook. windows.onCreated fires before compose's tab is fully
// settled, so we use tabs.onCreated which Thunderbird does fire for new
// compose tabs (verified TB 128+). We still defer slightly so the editor's
// initial body/sig get populated before we read them.
messenger.tabs.onCreated.addListener(async (tab) => {
  if (!tab || typeof tab.id !== "number") return;
  // TB tags compose tabs as type:"messageCompose"; everything else (mail
  // 3-pane, content tabs) skips out cheaply here.
  if (tab.type !== "messageCompose") {
    // Some TB builds don't populate `type` on the initial event; fall back
    // to a compose-details probe — if it succeeds, this is a compose tab.
    try {
      const probe = await messenger.compose.getComposeDetails(tab.id);
      if (!probe) return;
    } catch (_) {
      return;
    }
  }
  // Give the compose editor a moment to settle (sig insertion, identity
  // selection, body initialisation). 300ms is empirically the sweet spot:
  // long enough for the editor to stabilise, short enough that users don't
  // see their template arrive late.
  setTimeout(() => {
    maybeApplyDefaultTemplate(tab.id).catch((err) =>
      console.error("TemplateWing: default-template hook failed", err)
    );
  }, 300);
});

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
