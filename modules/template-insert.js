/**
 * Replace template variables in text.
 * @param {string} text - Text containing placeholders
 * @param {number} tabId - The compose tab ID (used to resolve sender identity)
 * @returns {Promise<string>} Text with placeholders replaced
 */
async function replaceVariables(text, tabId) {
  if (!text) return text;

  const now = new Date();
  let senderName = "";
  let senderEmail = "";

  try {
    const details = await messenger.compose.getComposeDetails(tabId);
    if (details.identityId) {
      const identity = await messenger.identities.get(details.identityId);
      if (identity) {
        senderName = identity.name || "";
        senderEmail = identity.email || "";
      }
    }
  } catch (err) {
    console.warn("TemplateWing: could not resolve sender identity", err);
  }

  return text
    .replace(/\{DATE\}/gi, now.toLocaleDateString())
    .replace(/\{TIME\}/gi, now.toLocaleTimeString())
    .replace(/\{SENDER_NAME\}/gi, senderName)
    .replace(/\{SENDER_EMAIL\}/gi, senderEmail);
}

/**
 * Resolve nested template includes in text.
 * Syntax: {{template:Template Name}} or {{templateid:abc123}}
 * @param {string} text - Text containing template includes
 * @param {Set} visited - Set of visited template IDs to detect circular references
 * @param {Map} templatesById - Map of template ID to template object
 * @param {Map} templatesByName - Map of template name (lowercase) to template object
 * @returns {Promise<string>} Text with includes resolved
 */
async function resolveNestedTemplates(text, visited, templatesById, templatesByName) {
  if (!text) return text;

  const includeRegex = /\{\{template(id)?:([^}]+)\}\}/gi;

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
  if (template.body && template.body.includes("{{template:")) {
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
      alert("Error: " + err.message);
      return;
    }
  }

  if (resolvedBody) {
    const body = await replaceVariables(resolvedBody, tabId);
    if (mode === "replace") {
      details.body = body;
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

  if (template.attachments && template.attachments.length > 0) {
    for (const att of template.attachments) {
      const binary = atob(att.data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const file = new File([bytes], att.name, { type: att.type });
      await messenger.compose.addAttachment(tabId, { file, name: att.name });
    }
  }
}
