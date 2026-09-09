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
 * Identity of a recipient entry for de-duplication.
 *
 * Thunderbird's ComposeRecipient is either a string ("Jane <jane@x>") or an
 * address-book reference ({ id, type }). Two entries are the same recipient
 * when they carry the same address, whatever display name is wrapped around
 * it — so the address decides, and an entry we cannot parse falls back to its
 * own normalised text rather than being silently dropped.
 *
 * @param {string|object} entry
 * @returns {string} Comparison key, or "" for an entry that carries nothing.
 */
export function recipientKey(entry) {
  if (entry == null) return "";
  if (typeof entry === "object") {
    // Address-book reference: id identifies the contact or mailing list.
    if (entry.id) return `${entry.type || "contact"}:${entry.id}`;
    return "";
  }
  const raw = String(entry).trim();
  if (!raw) return "";
  const parsed = parseRecipient(raw);
  return parsed ? parsed.email.toLowerCase() : raw.toLowerCase();
}

/**
 * Merge template recipients into the ones a compose window already has.
 *
 * Inserting a template adds to the message — body, attachments — so its
 * recipients must add too. Overwriting them loses the person the user picked
 * by hand, and picking a recipient first is the order in which the
 * {RECIPIENT_*} variables resolve correctly, so it has to be the order that
 * survives.
 *
 * `existing` keeps its position ahead of `incoming`: the first To: entry is
 * what the recipient variables read, and that should stay the address the
 * user chose. Duplicates are dropped by address, empty entries skipped.
 *
 * @param {Array<string|object>} existing - Recipients currently in the compose window.
 * @param {Array<string|object>} incoming - Recipients the template brings.
 * @returns {Array<string|object>} Merged list; a fresh array, inputs untouched.
 */
export function mergeRecipients(existing, incoming) {
  const out = [];
  const seen = new Set();
  for (const list of [existing, incoming]) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const key = recipientKey(entry);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(entry);
    }
  }
  return out;
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
