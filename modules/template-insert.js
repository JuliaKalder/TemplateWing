export const WEEKDAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"
];

/**
 * Insert `insertHtml` into `existingBody` at the most user-meaningful
 * position for a cursor-mode template when the real caret is unknown.
 * Priority:
 *   1. Before the Thunderbird reply/forward cite-prefix (`moz-cite-prefix`)
 *      — that's where the user types their reply, above the quoted message.
 *   2. Before the signature block (`moz-signature`) — so the template
 *      lands above the sign-off rather than after it.
 *   3. At the end of the body — as a last resort.
 * Uses regex rather than DOMParser to avoid any parse-serialize round-trip
 * that could reformat the user's in-flight HTML.
 */
export function smartInsertHtml(existingBody, insertHtml) {
  if (!existingBody) return insertHtml || "";
  if (!insertHtml) return existingBody;

  const citeRe = /<(div|blockquote)\b[^>]*\bclass\s*=\s*["'][^"']*\bmoz-cite-prefix\b[^"']*["'][^>]*>/i;
  const sigRe = /<(div|pre)\b[^>]*\bclass\s*=\s*["'][^"']*\bmoz-signature\b[^"']*["'][^>]*>/i;

  const cite = existingBody.match(citeRe);
  const sig = existingBody.match(sigRe);

  let idx = -1;
  if (cite && sig) idx = Math.min(cite.index, sig.index);
  else if (cite) idx = cite.index;
  else if (sig) idx = sig.index;

  if (idx >= 0) {
    return existingBody.slice(0, idx) + insertHtml + existingBody.slice(idx);
  }
  return existingBody + insertHtml;
}

/**
 * Plaintext equivalent. The standard signature delimiter is a line
 * consisting of exactly "-- " (dash dash space). Reply quotes in plaintext
 * usually start with lines prefixed "> ".
 */
export function smartInsertPlaintext(existingBody, insertText) {
  if (!existingBody) return insertText || "";
  if (!insertText) return existingBody;

  // Match the standalone sig delimiter line.
  const sigMatch = existingBody.match(/(^|\n)-- \n/);
  const quoteMatch = existingBody.match(/(^|\n)> /);

  let idx = -1;
  if (sigMatch && quoteMatch) {
    idx = Math.min(
      sigMatch.index + (sigMatch[1] ? 1 : 0),
      quoteMatch.index + (quoteMatch[1] ? 1 : 0)
    );
  } else if (sigMatch) {
    idx = sigMatch.index + (sigMatch[1] ? 1 : 0);
  } else if (quoteMatch) {
    idx = quoteMatch.index + (quoteMatch[1] ? 1 : 0);
  }

  if (idx >= 0) {
    const suffix = insertText.endsWith("\n") ? "" : "\n";
    return existingBody.slice(0, idx) + insertText + suffix + existingBody.slice(idx);
  }
  return existingBody + insertText;
}

/**
 * Pure helper: substitute the supported variable tokens in `text`.
 * Does not touch messenger.* or Date; all values are provided by the caller.
 * @param {string} text
 * @param {object} vars - { date, time, datetime, year, weekday, senderName, senderEmail, accountName, accountEmail }
 */
export function applyVariables(text, vars) {
  if (!text) return text;
  return text
    .replace(/\{DATE\}/gi, vars.date)
    .replace(/\{TIME\}/gi, vars.time)
    .replace(/\{DATETIME\}/gi, vars.datetime)
    .replace(/\{YEAR\}/gi, String(vars.year))
    .replace(/\{WEEKDAY\}/gi, vars.weekday)
    .replace(/\{SENDER_NAME\}/gi, vars.senderName)
    .replace(/\{SENDER_EMAIL\}/gi, vars.senderEmail)
    .replace(/\{ACCOUNT_NAME\}/gi, vars.accountName)
    .replace(/\{ACCOUNT_EMAIL\}/gi, vars.accountEmail);
}

/**
 * Replace template variables in text.
 * @param {string} text - Text containing placeholders
 * @param {number} tabId - The compose tab ID (used to resolve sender identity)
 * @returns {Promise<string>} Text with placeholders replaced
 */
export async function replaceVariables(text, tabId) {
  if (!text) return text;

  const now = new Date();
  let senderName = "";
  let senderEmail = "";
  let accountName = "";
  let accountEmail = "";

  try {
    const details = await messenger.compose.getComposeDetails(tabId);
    if (details.identityId) {
      const identity = await messenger.identities.get(details.identityId);
      if (identity) {
        senderName = identity.name || "";
        senderEmail = identity.email || "";
        accountEmail = identity.email || "";
      }
      // Resolve account name from the identity's parent account
      try {
        const accounts = await messenger.accounts.list();
        for (const acct of accounts) {
          if (acct.identities && acct.identities.some((id) => id.id === details.identityId)) {
            accountName = acct.name || "";
            break;
          }
        }
      } catch { /* accountsRead may not be available */ }
    }
  } catch (err) {
    console.warn("TemplateWing: could not resolve sender identity", err);
  }

  return applyVariables(text, {
    date: now.toLocaleDateString(),
    time: now.toLocaleTimeString(),
    datetime: now.toLocaleDateString() + " " + now.toLocaleTimeString(),
    year: now.getFullYear(),
    weekday: WEEKDAY_NAMES[now.getDay()],
    senderName,
    senderEmail,
    accountName,
    accountEmail,
  });
}

export const TEMPLATE_INCLUDE_REGEX = /\{\{template(id)?:([^}]+)\}\}/gi;

/**
 * Resolve nested template includes in text.
 * Syntax: {{template:Template Name}} or {{templateid:abc123}}
 * @param {string} text - Text containing template includes
 * @param {Set} visited - Set of visited template IDs to detect circular references
 * @param {Map} templatesById - Map of template ID to template object
 * @param {Map} templatesByName - Map of template name (lowercase) to template object
 * @returns {Promise<string>} Text with includes resolved
 */
export async function resolveNestedTemplates(text, visited, templatesById, templatesByName) {
  if (!text) return text;

  // Use a fresh regex per call to avoid lastIndex state on the shared exported one.
  const includeRegex = new RegExp(TEMPLATE_INCLUDE_REGEX.source, TEMPLATE_INCLUDE_REGEX.flags);

  let resolved = text;
  let match;
  const matches = [];
  while ((match = includeRegex.exec(text)) !== null) {
    matches.push(match);
  }

  for (const m of matches) {
    const fullMatch = m[0];
    const useId = m[1];
    const identifier = m[2].trim();
    let nestedTemplate = null;

    if (useId) {
      nestedTemplate = templatesById.get(identifier);
    } else {
      nestedTemplate = templatesByName.get(identifier.toLowerCase());
    }

    if (!nestedTemplate) {
      console.warn(`TemplateWing: referenced template not found: ${identifier}`);
      continue;
    }

    if (visited.has(nestedTemplate.id)) {
      console.error(`TemplateWing: circular reference detected for template: ${nestedTemplate.name}`);
      throw new Error(`Circular reference detected: ${nestedTemplate.name}`);
    }

    visited.add(nestedTemplate.id);
    const nestedContent = await resolveNestedTemplates(
      nestedTemplate.body || "",
      visited,
      templatesById,
      templatesByName
    );
    visited.delete(nestedTemplate.id);

    resolved = resolved.replace(fullMatch, nestedContent);
  }

  return resolved;
}

/**
 * Strip HTML tags and decode entities to plain text. Used when inserting a
 * template body into a compose window that is in plain-text mode.
 * @param {string} html
 * @returns {string}
 */
export function htmlToPlainText(html) {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body ? doc.body.textContent || "" : "";
}

/**
 * Insert a template into a compose tab.
 * @param {number} tabId - The compose tab ID
 * @param {object} template - Template object from storage
 */
export async function insertTemplateIntoTab(tabId, template) {
  const mode = template.insertMode || "append";
  const details = {};

  let resolvedBody = template.body;
  if (template.body && /\{\{template(id)?:/i.test(template.body)) {
    try {
      const { getTemplates } = await import("./template-store.js");
      const allTemplates = await getTemplates();
      const templatesById = new Map(allTemplates.map((t) => [t.id, t]));
      const templatesByName = new Map(
        allTemplates.map((t) => [t.name.toLowerCase(), t])
      );
      const visited = new Set([template.id]);
      resolvedBody = await resolveNestedTemplates(
        template.body,
        visited,
        templatesById,
        templatesByName
      );
    } catch (err) {
      console.error("TemplateWing: error resolving nested templates", err);
      throw err;
    }
  }

  // "cursor" mode is delivered via a compose script message rather than by
  // rewriting the whole body, so the signature and any text the user has
  // already typed stay intact (issue #33).
  let insertedAtCursor = false;
  if (resolvedBody && mode === "cursor") {
    const body = await replaceVariables(resolvedBody, tabId);
    const existing = await messenger.compose.getComposeDetails(tabId);
    const isPlainText = !!existing.isPlainText;
    console.log("TemplateWing: cursor mode -> sending insertAtCursor", { tabId, isPlainText });

    // Safety net: Thunderbird 128's declarative compose_scripts injection
    // is unreliable. background.js already hooks tabs.onCreated, but if
    // that fired before the document was ready (or was missed entirely for
    // this tab), we'd hit "Receiving end does not exist" and lose the
    // insert to the smart-insert fallback. Explicitly re-inject here; the
    // listener-swap in compose-script.js makes it idempotent.
    try {
      await messenger.tabs.executeScript(tabId, {
        file: "/modules/compose-script.js",
      });
    } catch (err) {
      console.debug("TemplateWing: pre-send inject skipped", err && err.message);
    }

    try {
      const response = await messenger.tabs.sendMessage(tabId, {
        action: "templatewing:insertAtCursor",
        html: body,
        text: htmlToPlainText(body),
        isPlainText,
      });
      console.log("TemplateWing: cursor mode <- response", response);
      if (response && response.ok) {
        insertedAtCursor = true;
      } else {
        // Script ran but refused to insert (no usable range, editor
        // rejected execCommand, DOM exception, etc). `response.error`
        // carries the specific code from compose-script.js.
        const code = (response && response.error) || "unknown";
        console.warn(
          `TemplateWing: compose-script returned ${code} — falling back to append`
        );
      }
    } catch (err) {
      // tabs.sendMessage could not reach a listener in this tab. This is
      // the structural "script not injected" case: declarative
      // compose_scripts only run in windows opened after the add-on loads,
      // so a pre-existing compose window has no listener until the
      // background-page backfill runs. Fall back to append so the existing
      // body and signature stay intact above the inserted template.
      console.warn(
        "TemplateWing: compose-script not injected in this tab — falling back to append",
        err && err.message ? err.message : err
      );
    }

    if (!insertedAtCursor) {
      // Smart fallback: when the compose-script path could not insert at
      // the caret (no listener, no usable range, Gecko quirks, etc.),
      // insert at a user-meaningful anchor rather than blindly appending.
      // Priority: before cite-prefix (reply quote), before signature,
      // else append. Keeps the template from landing after the sign-off.
      if (isPlainText) {
        details.body = smartInsertPlaintext(existing.body || "", htmlToPlainText(body));
      } else {
        details.body = smartInsertHtml(existing.body || "", body);
      }
      console.log(
        "TemplateWing: cursor fallback wrote template",
        isPlainText ? "as plaintext (smart-insert)" : "as HTML (smart-insert)"
      );
    }
  } else if (resolvedBody) {
    const body = await replaceVariables(resolvedBody, tabId);
    if (mode === "replace") {
      details.body = body;
    } else if (mode === "prepend") {
      const existing = await messenger.compose.getComposeDetails(tabId);
      details.body = body + (existing.body || "");
    } else {
      const existing = await messenger.compose.getComposeDetails(tabId);
      details.body = (existing.body || "") + body;
    }
  }

  if (template.subject) {
    details.subject = await replaceVariables(template.subject, tabId);
  }

  if (template.to && template.to.length > 0) {
    details.to = template.to;
  }
  if (template.cc && template.cc.length > 0) {
    details.cc = template.cc;
  }
  if (template.bcc && template.bcc.length > 0) {
    details.bcc = template.bcc;
  }

  await messenger.compose.setComposeDetails(tabId, details);

  // Issue #18: Per-file decode error handling -- failures collected, not fatal
  if (template.attachments && template.attachments.length > 0) {
    const attachmentErrors = [];
    for (const att of template.attachments) {
      try {
        const binary = atob(att.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const file = new File([bytes], att.name, { type: att.type });
        await messenger.compose.addAttachment(tabId, { file, name: att.name });
      } catch (err) {
        console.error(`TemplateWing: failed to attach "${att.name}"`, err);
        attachmentErrors.push(att.name);
      }
    }
    if (attachmentErrors.length > 0) {
      const err = new Error(`Could not attach: ${attachmentErrors.join(", ")}`);
      err.code = "ATTACHMENT_FAILED";
      err.failedNames = attachmentErrors;
      throw err;
    }
  }
}
