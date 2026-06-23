/**
 * Recursively search a MIME part tree for the first part matching contentType.
 * @param {object} part - A MessagePart object from the Thunderbird messages API.
 * @param {string} contentType - MIME type to search for (e.g. "text/html").
 * @returns {string|null} The body string if found, otherwise null.
 */
export function findPart(part, contentType) {
  if (part.contentType === contentType && part.body) return part.body;
  if (part.parts) {
    for (const child of part.parts) {
      const found = findPart(child, contentType);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Extract the best available body from a MIME part tree.
 * Prefers HTML over plain text.
 * @param {object} part - A MessagePart object from the Thunderbird messages API.
 * @returns {{ html: boolean, body: string }|null}
 */
export function extractBody(part) {
  const html = findPart(part, "text/html");
  if (html) return { html: true, body: html };
  const plain = findPart(part, "text/plain");
  if (plain) return { html: false, body: plain };
  return null;
}

/**
 * Parse a single RFC-5322-ish recipient string into name/email/firstname.
 * Accepts:
 *   - "user@example.com"
 *   - "Jane Doe <jane@example.com>"
 *   - "\"Doe, Jane\" <jane@example.com>"
 * Falls back to local-part as the name when no display name is present.
 *
 * @param {string} raw
 * @returns {{ name: string, firstname: string, email: string, domain: string }|null}
 */
export function parseRecipient(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  let name = "";
  let email = "";

  const named = s.match(/^\s*(.+?)\s*<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/);
  if (named) {
    name = named[1]
      .trim()
      .replace(/^"(.*)"$/, "$1")
      .trim();
    email = named[2].trim();
  } else {
    const bare = s.match(/^\s*([^\s<>@]+@[^\s<>]+)\s*$/);
    if (bare) email = bare[1].trim();
    else return null;
  }

  if (!name) {
    // Local-part fallback: "first.last@..." → "first.last".
    name = email.split("@")[0] || "";
  }
  const firstname = name.split(/\s+/)[0] || "";
  const domain = email.includes("@") ? email.split("@")[1] : "";
  return { name, firstname, email, domain };
}

/**
 * Strip the leading "Re:" / "Fwd:" / "Aw:" / "Wg:" / "TR:" prefix(es) from a subject.
 * Repeated prefixes are stripped (e.g. "Re: Re: Fwd: …" → "…").
 */
export function stripReplyForwardPrefix(subject) {
  if (!subject) return "";
  let s = String(subject).trim();
  // Common reply/forward prefixes across English/German/French/Spanish/Italian/Portuguese/Dutch.
  const prefix = /^(re|aw|antw|antwort|fwd|fw|wg|tr|rv|enc|i)\s*:\s*/i;
  while (prefix.test(s)) s = s.replace(prefix, "");
  return s;
}

/**
 * Quote a plaintext body with "> " line prefix, RFC-3676-ish (no special
 * handling of existing quote levels). Trailing whitespace per line preserved.
 */
export function quotePlaintext(body) {
  if (!body) return "";
  return String(body)
    .split(/\r?\n/)
    .map((line) => (line.length > 0 ? "> " + line : ">"))
    .join("\n");
}

/**
 * Wrap an HTML body in a <blockquote type="cite"> for use as a reply quote.
 * Sanitization happens at the caller (sanitizeEmailBodyForPrefill) — this
 * helper only formats; it does not strip event handlers.
 */
export function quoteHtml(body) {
  if (!body) return "";
  return `<blockquote type="cite">${body}</blockquote>`;
}
