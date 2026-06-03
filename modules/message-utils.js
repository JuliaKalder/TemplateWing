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
