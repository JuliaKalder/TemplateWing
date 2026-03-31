/**
 * Variable resolution for email templates.
 * All template variable substitution is centralized here.
 */

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

  const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const weekday = weekdayNames[now.getDay()];

  return text
    .replace(/\{DATE\}/gi, now.toLocaleDateString())
    .replace(/\{TIME\}/gi, now.toLocaleTimeString())
    .replace(/\{DATETIME\}/gi, now.toLocaleDateString() + " " + now.toLocaleTimeString())
    .replace(/\{YEAR\}/gi, String(now.getFullYear()))
    .replace(/\{WEEKDAY\}/gi, weekday)
    .replace(/\{SENDER_NAME\}/gi, senderName)
    .replace(/\{SENDER_EMAIL\}/gi, senderEmail)
    .replace(/\{ACCOUNT_NAME\}/gi, accountName)
    .replace(/\{ACCOUNT_EMAIL\}/gi, accountEmail);
}

/**
 * Supported variables for reference.
 * @returns {Array<{name: string, description: string}>}
 */
export function getSupportedVariables() {
  return [
    { name: "{DATE}", description: "Current date" },
    { name: "{TIME}", description: "Current time" },
    { name: "{DATETIME}", description: "Current date and time" },
    { name: "{YEAR}", description: "Current year" },
    { name: "{WEEKDAY}", description: "Day of the week" },
    { name: "{SENDER_NAME}", description: "Your name" },
    { name: "{SENDER_EMAIL}", description: "Your email" },
    { name: "{ACCOUNT_NAME}", description: "Account name" },
    { name: "{ACCOUNT_EMAIL}", description: "Account email address" },
  ];
}
