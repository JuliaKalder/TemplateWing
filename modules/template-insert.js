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
 * Insert a template into a compose tab.
 * @param {number} tabId - The compose tab ID
 * @param {object} template - Template object from storage
 */
export async function insertTemplateIntoTab(tabId, template) {
  const mode = template.insertMode || "append";
  const details = {};

  if (template.body) {
    const body = await replaceVariables(template.body, tabId);
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
