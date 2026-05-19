import { getTemplates, INSERT_MODES } from "./template-store.js";

export const WEEKDAY_NAMES = Object.freeze([
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
]);

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

  const citeRe =
    /<(div|blockquote)\b[^>]*\bclass\s*=\s*["'][^"']*\bmoz-cite-prefix\b[^"']*["'][^>]*>/i;
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

  // Skip past the captured \n prefix to get the real start of the delimiter.
  function matchStart(m) {
    return m.index + (m[1] ? 1 : 0);
  }

  // Match the standalone sig delimiter line.
  const sigMatch = existingBody.match(/(^|\n)-- \n/);
  const quoteMatch = existingBody.match(/(^|\n)> /);

  let idx = -1;
  if (sigMatch && quoteMatch) {
    idx = Math.min(matchStart(sigMatch), matchStart(quoteMatch));
  } else if (sigMatch) {
    idx = matchStart(sigMatch);
  } else if (quoteMatch) {
    idx = matchStart(quoteMatch);
  }

  if (idx >= 0) {
    const suffix = insertText.endsWith("\n") ? "" : "\n";
    return existingBody.slice(0, idx) + insertText + suffix + existingBody.slice(idx);
  }
  return existingBody + insertText;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Pure helper: substitute the supported variable tokens in `text`.
 * Does not touch messenger.* or Date; all values are provided by the caller.
 * @param {string} text
 * @param {object} vars - { date, time, datetime, year, weekday, senderName, senderEmail, accountName, accountEmail }
 * @param {boolean} isHtml - When true, identity-derived values are HTML-entity-encoded before substitution.
 */
export function applyVariables(text, vars, isHtml = false) {
  if (!text) return text;
  const {
    date = "",
    time = "",
    datetime = "",
    year = "",
    weekday = "",
    senderName = "",
    senderEmail = "",
    accountName = "",
    accountEmail = "",
  } = vars || {};
  const e = isHtml ? escapeHtml : (s) => String(s ?? "");
  // Use function replacers to prevent $&/$'/$` pattern injection.
  return text
    .replace(/\{DATE\}/gi, () => date)
    .replace(/\{TIME\}/gi, () => time)
    .replace(/\{DATETIME\}/gi, () => datetime)
    .replace(/\{YEAR\}/gi, () => String(year))
    .replace(/\{WEEKDAY\}/gi, () => weekday)
    .replace(/\{SENDER_NAME\}/gi, () => e(senderName))
    .replace(/\{SENDER_EMAIL\}/gi, () => e(senderEmail))
    .replace(/\{ACCOUNT_NAME\}/gi, () => e(accountName))
    .replace(/\{ACCOUNT_EMAIL\}/gi, () => e(accountEmail));
}

/**
 * Replace template variables in text.
 *
 * Supported tokens: {DATE}, {TIME}, {DATETIME}, {YEAR}, {WEEKDAY},
 * {SENDER_NAME}, {SENDER_EMAIL}, {ACCOUNT_NAME}, {ACCOUNT_EMAIL}.
 *
 * @param {string} text - Text containing placeholders
 * @param {number} tabId - The compose tab ID (used to resolve sender identity)
 * @param {boolean} isHtml - Pass true when substituting into HTML to HTML-encode identity values.
 * @returns {Promise<string>} Text with placeholders replaced
 * @see applyVariables
 */
export async function replaceVariables(text, tabId, isHtml = false) {
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
      } catch (err) {
        console.warn("TemplateWing: could not resolve account name", err);
      }
    }
  } catch (err) {
    console.warn("TemplateWing: could not resolve sender identity", err);
  }

  return applyVariables(
    text,
    {
      date: now.toLocaleDateString(),
      time: now.toLocaleTimeString(),
      datetime: now.toLocaleDateString() + " " + now.toLocaleTimeString(),
      year: now.getFullYear(),
      weekday: WEEKDAY_NAMES[now.getDay()],
      senderName,
      senderEmail,
      accountName,
      accountEmail,
    },
    isHtml
  );
}

export const TEMPLATE_INCLUDE_REGEX = /\{\{template(id)?:([^}]+)\}\}/gi;

/**
 * Resolve nested template includes in text.
 * Syntax: {{template:Template Name}} or {{templateid:abc123}}
 * @param {string} text - Text containing template includes
 * @param {Set} visited - DFS path set of template IDs for cycle detection.
 *   A new Set copy is created for each recursive branch, so the same template
 *   can appear in separate non-cyclic paths (diamond include graphs are allowed).
 * @param {Map} templatesById - Map of template ID to template object
 * @param {Map} templatesByName - Map of template name (lowercase) to template object
 * @returns {Promise<string>} Text with includes resolved
 */
export async function resolveNestedTemplates(
  text,
  visited,
  templatesById,
  templatesByName,
  memo = new Map()
) {
  if (!text) return text;

  // Use a fresh regex per call to avoid lastIndex state on the shared exported one.
  const includeRegex = new RegExp(TEMPLATE_INCLUDE_REGEX.source, TEMPLATE_INCLUDE_REGEX.flags);

  // Collect all matches from `text`, then apply replacements to `resolved`.
  // String.replace without /g replaces one occurrence per call, so each match
  // from the original text is resolved exactly once even if its literal appears
  // multiple times in the evolving `resolved` string.
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
      console.warn("TemplateWing: referenced template not found:", JSON.stringify(identifier));
      continue;
    }

    if (visited.has(nestedTemplate.id)) {
      console.error(
        "TemplateWing: circular reference detected for template:",
        JSON.stringify(nestedTemplate.name)
      );
      throw new Error(`Circular reference detected: ${nestedTemplate.name}`);
    }

    let nestedContent;
    if (memo.has(nestedTemplate.id)) {
      nestedContent = memo.get(nestedTemplate.id);
    } else {
      nestedContent = await resolveNestedTemplates(
        nestedTemplate.body || "",
        new Set([...visited, nestedTemplate.id]),
        templatesById,
        templatesByName,
        memo
      );
      memo.set(nestedTemplate.id, nestedContent);
    }

    // Use function replacer to prevent $&/$'/$` pattern injection.
    resolved = resolved.replace(fullMatch, () => nestedContent);
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
  const mode = template.insertMode || INSERT_MODES.APPEND;
  const details = {};

  // Hoist compose details fetch so we can use identityId for both nested
  // template filtering and later insert-mode operations.
  let currentIdentityId = null;
  try {
    const composeDetails = await messenger.compose.getComposeDetails(tabId);
    currentIdentityId = composeDetails.identityId || null;
  } catch (err) {
    console.warn("TemplateWing: could not fetch compose details for identity filtering", err);
  }

  let resolvedBody = template.body;
  if (template.body && new RegExp(TEMPLATE_INCLUDE_REGEX.source, "i").test(template.body)) {
    try {
      const allTemplates = await getTemplates();
      // Filter to only templates that the current identity is allowed to use.
      // A template with no identities restriction (empty or absent) is always
      // available; otherwise the current identity must be listed explicitly.
      const allowedTemplates = allTemplates.filter(
        (t) =>
          !t.identities ||
          t.identities.length === 0 ||
          (currentIdentityId && t.identities.includes(currentIdentityId))
      );
      const templatesById = new Map(allowedTemplates.map((t) => [t.id, t]));
      const templatesByName = new Map(allowedTemplates.map((t) => [(t.name || "").toLowerCase(), t]));
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
  // already typed stay intact.
  let insertedAtCursor = false;
  if (resolvedBody && mode === INSERT_MODES.CURSOR) {
    const body = await replaceVariables(resolvedBody, tabId, true);
    const existing = await messenger.compose.getComposeDetails(tabId);
    const isPlainText = !!existing.isPlainText;
    console.log("TemplateWing: cursor mode -> sending insertAtCursor", { tabId, isPlainText });

    // Safety net: even with composeScripts.register() set up at boot,
    // explicitly re-inject here so that if something upstream went wrong
    // (registration failed, tab opened before register resolved, etc.)
    // we still have a listener to talk to. Idempotent via the
    // listener-swap in compose-script.js.
    try {
      await messenger.tabs.executeScript(tabId, {
        file: "/modules/compose-script.js",
      });
      console.log("TemplateWing: pre-send inject ok", { tabId });
    } catch (err) {
      console.warn("TemplateWing: pre-send inject failed", err && err.message);
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
        console.warn(`TemplateWing: compose-script returned ${code} — falling back to append`);
      }
    } catch (err) {
      // tabs.sendMessage could not reach a listener in this tab. Possible
      // causes: composeScripts.register() has not yet resolved for this tab,
      // the background-page backfill via executeScript failed or hasn't run
      // yet, or the tab was open before the add-on loaded. Fall back to
      // append so the existing body and signature stay intact.
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
    const body = await replaceVariables(resolvedBody, tabId, true);
    if (mode === INSERT_MODES.REPLACE) {
      details.body = body;
    } else if (mode === INSERT_MODES.PREPEND) {
      const existing = await messenger.compose.getComposeDetails(tabId);
      details.body = body + (existing.body || "");
    } else if (mode === INSERT_MODES.APPEND) {
      const existing = await messenger.compose.getComposeDetails(tabId);
      details.body = (existing.body || "") + body;
    } else {
      console.warn(
        "TemplateWing: unknown insert mode:",
        JSON.stringify(mode),
        "— defaulting to append"
      );
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

  // Per-file decode error handling — failures collected, not fatal
  if (template.attachments && template.attachments.length > 0) {
    const attachmentErrors = [];
    for (const att of template.attachments) {
      try {
        const binary = atob(att.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        // Sanitize filename: strip path separators, null bytes, and control chars
        const safeName = (att.name || "attachment")
          .replace(/[/\\:\x00-\x1f]/g, "_")
          .replace(/^\.+/, "_");
        const file = new File([bytes], safeName, { type: att.type });
        await messenger.compose.addAttachment(tabId, { file, name: safeName });
      } catch (err) {
        console.error("TemplateWing: failed to attach:", JSON.stringify(att.name), err);
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
