/**
 * Insert a template into a compose tab.
 * @param {number} tabId - The compose tab ID
 * @param {object} template - Template object from storage
 */
export async function insertTemplateIntoTab(tabId, template) {
  const mode = template.insertMode || "append";

  if (template.body) {
    if (mode === "replace") {
      await messenger.compose.setComposeDetails(tabId, {
        body: template.body,
      });
    } else {
      const details = await messenger.compose.getComposeDetails(tabId);
      const existingBody = details.body || "";
      await messenger.compose.setComposeDetails(tabId, {
        body: existingBody + template.body,
      });
    }
  }

  if (template.subject) {
    await messenger.compose.setComposeDetails(tabId, {
      subject: template.subject,
    });
  }

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
