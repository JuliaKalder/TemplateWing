export const WEEKDAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"
];

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

  if (resolvedBody) {
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
      throw new Error(
        `Could not attach: ${attachmentErrors.join(", ")}`
      );
    }
  }
}
