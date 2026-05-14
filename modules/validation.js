/**
 * Pure validation helpers — no messenger.* dependency, fully testable.
 */

/**
 * Check whether a string looks like a valid email recipient.
 * Accepts bare addresses (user@example.com) and
 * display-name format (Jane Doe <jane@example.com>).
 */
export function isValidRecipient(value) {
  if (!value || typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  const bareEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const namedEmail = /^.+<\s*([^\s@]+@[^\s@]+\.[^\s@]+)\s*>$/;
  return bareEmail.test(trimmed) || namedEmail.test(trimmed);
}

/**
 * Validate a comma-separated recipient string.
 * Returns { valid: boolean, invalid: string[] }.
 * Empty input is considered valid (recipients are optional).
 */
export function validateRecipients(value) {
  if (!value || !value.trim()) return { valid: true, invalid: [] };
  const recipients = value.split(",").map((s) => s.trim()).filter(Boolean);
  const invalid = recipients.filter((r) => !isValidRecipient(r));
  return { valid: invalid.length === 0, invalid };
}

/**
 * Format bytes as a human-readable file-size string.
 */
export function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

// Issue #18: v2.1 -- per-file and total attachment size warnings
/** Per-file attachment size warning threshold (5 MB). */
export const ATTACHMENT_WARN_SIZE = 5 * 1024 * 1024;

/** Total attachment size warning threshold (10 MB). */
export const ATTACHMENT_TOTAL_WARN_SIZE = 10 * 1024 * 1024;

/**
 * Analyse an import payload against existing templates.
 * Returns { valid: object[], invalid: number, duplicates: Map<string, object> }
 * where duplicates maps lowercase-name to the most recent import entry that collides
 * with either an existing template or another imported template.
 */
export function analyseImport(importedTemplates, existingTemplates) {
  // Tracks all names seen so far: pre-seeded with existing template names
  // for storage-level dedup, then extended with each processed import for
  // intra-import dedup (so two imported templates with the same name both
  // land in `duplicates`).
  const allSeenNames = new Map(
    existingTemplates.map((t) => [t.name.toLowerCase(), t])
  );

  const valid = []; // Structurally valid templates — includes duplicates.
  let invalid = 0;
  const duplicates = new Map();

  for (const t of importedTemplates) {
    if (!t || typeof t.name !== "string" || !t.name.trim()) {
      invalid++;
      continue;
    }
    const key = t.name.trim().toLowerCase();
    if (allSeenNames.has(key)) {
      duplicates.set(key, t);
    }
    allSeenNames.set(key, t);
    valid.push(t); // Always included; callers must consult `duplicates` for merge logic.
  }

  return { valid, invalid, duplicates };
}
