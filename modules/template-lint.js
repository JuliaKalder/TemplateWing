/**
 * Pure template linter. Returns an array of issue objects so the UI layer
 * can render badges, summaries, and per-issue tooltips without re-deriving
 * anything.
 *
 * No messenger.* dependency — testable from Node.
 */

import { SUPPORTED_VARIABLES, TEMPLATE_INCLUDE_REGEX } from "./template-insert.js";
import {
  validateRecipients,
  ATTACHMENT_WARN_SIZE,
  ATTACHMENT_TOTAL_WARN_SIZE,
} from "./validation.js";

/** Issue code → severity. Severity drives badge colour in the options page. */
export const SEVERITY = Object.freeze({
  error: "error",
  warning: "warning",
});

const CODE_SEVERITY = Object.freeze({
  "unknown-variable": SEVERITY.warning,
  "broken-include": SEVERITY.error,
  cycle: SEVERITY.error,
  "oversize-attachment": SEVERITY.warning,
  "oversize-total": SEVERITY.warning,
  "invalid-recipient": SEVERITY.error,
});

/**
 * Control-flow / prompt tokens we recognise inside curly braces. Stripped
 * before the unknown-variable scan so `{IF cond}…{ENDIF}`, `{PROMPT:…}`,
 * etc. don't get flagged.
 */
const CONTROL_TOKEN_RE = /\{(IF\s+[^}]+|ELSE|ENDIF|PROMPT:[^}]+|CHOICE:[^}]+)\}/gi;

/** Extract all `{NAME}` tokens from `text`, ignoring `{{template:…}}` includes. */
function extractSimpleVariableTokens(text) {
  if (!text) return [];
  // Strip nested template includes and control/prompt tokens first.
  const stripped = String(text)
    .replace(new RegExp(TEMPLATE_INCLUDE_REGEX.source, "gi"), "")
    .replace(CONTROL_TOKEN_RE, "");
  const out = new Set();
  const re = /\{([A-Z][A-Z0-9_]*)\}/g;
  let m;
  while ((m = re.exec(stripped)) !== null) out.add(m[1]);
  return [...out];
}

/** Extract all `{{template:Name}}` / `{{templateid:uuid}}` references. */
function extractIncludeRefs(text) {
  if (!text) return [];
  const re = new RegExp(TEMPLATE_INCLUDE_REGEX.source, "gi");
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ kind: m[1] ? "id" : "name", value: m[2].trim() });
  }
  return out;
}

/**
 * Walk the include graph starting from `templateId`, returning the id of the
 * first cycle hit (the id that would close the loop) or `null` if no cycle.
 * Allows diamond includes (same template via two paths is fine).
 */
function findCycle(templateId, byId, byName) {
  const visiting = new Set();

  function visit(id) {
    if (!id || !byId.has(id)) return null;
    if (visiting.has(id)) return id;
    visiting.add(id);
    const tpl = byId.get(id);
    for (const ref of extractIncludeRefs(tpl.body || "")) {
      const next = ref.kind === "id" ? byId.get(ref.value) : byName.get(ref.value.toLowerCase());
      if (!next) continue;
      const hit = visit(next.id);
      if (hit) return hit;
    }
    visiting.delete(id);
    return null;
  }

  return visit(templateId);
}

/**
 * @param {object} template - Template under test.
 * @param {Array<object>} allTemplates - Full template list for include resolution.
 * @returns {Array<{code:string,severity:string,message:string,detail?:any}>}
 */
export function lintTemplate(template, allTemplates) {
  const issues = [];
  if (!template) return issues;

  const byId = new Map((allTemplates || []).map((t) => [t.id, t]));
  const byName = new Map((allTemplates || []).map((t) => [(t.name || "").toLowerCase(), t]));

  const variableAllowSet = new Set(SUPPORTED_VARIABLES);

  // 1. Unknown variables in subject + body.
  const tokens = new Set([
    ...extractSimpleVariableTokens(template.subject || ""),
    ...extractSimpleVariableTokens(template.body || ""),
  ]);
  for (const name of tokens) {
    if (!variableAllowSet.has(name)) {
      issues.push({
        code: "unknown-variable",
        severity: CODE_SEVERITY["unknown-variable"],
        message: `Unknown variable {${name}}`,
        detail: { name },
      });
    }
  }

  // 2. Broken includes.
  for (const ref of extractIncludeRefs(template.body || "")) {
    const found = ref.kind === "id" ? byId.has(ref.value) : byName.has(ref.value.toLowerCase());
    if (!found) {
      issues.push({
        code: "broken-include",
        severity: CODE_SEVERITY["broken-include"],
        message: `Referenced template not found: ${ref.value}`,
        detail: ref,
      });
    }
  }

  // 3. Include cycle. Skip if there were broken includes — the graph walk
  // would just bottom out without finding the cycle, and the broken-include
  // issues already alert the user to the real problem.
  if (template.id && byId.has(template.id) && !issues.some((i) => i.code === "broken-include")) {
    const cycleHit = findCycle(template.id, byId, byName);
    if (cycleHit) {
      issues.push({
        code: "cycle",
        severity: CODE_SEVERITY.cycle,
        message: "Nested template cycle detected",
        detail: { startId: template.id, viaId: cycleHit },
      });
    }
  }

  // 4. Attachment size warnings — reuse validation thresholds.
  const attachments = Array.isArray(template.attachments) ? template.attachments : [];
  let total = 0;
  for (const att of attachments) {
    const size = Number(att && att.size) || 0;
    total += size;
    if (size >= ATTACHMENT_WARN_SIZE) {
      issues.push({
        code: "oversize-attachment",
        severity: CODE_SEVERITY["oversize-attachment"],
        message: `Large attachment: ${att.name || "(unnamed)"} (${size} bytes)`,
        detail: { name: att.name, size },
      });
    }
  }
  if (total >= ATTACHMENT_TOTAL_WARN_SIZE) {
    issues.push({
      code: "oversize-total",
      severity: CODE_SEVERITY["oversize-total"],
      message: `Total attachment size is large (${total} bytes)`,
      detail: { total },
    });
  }

  // 5. Recipient validation — only To: is required to look like a list.
  for (const field of ["to", "cc", "bcc"]) {
    const arr = Array.isArray(template[field]) ? template[field] : [];
    if (arr.length === 0) continue;
    const joined = arr.join(", ");
    const result = validateRecipients(joined);
    if (!result.valid) {
      issues.push({
        code: "invalid-recipient",
        severity: CODE_SEVERITY["invalid-recipient"],
        message: `Invalid recipient(s) in ${field.toUpperCase()}: ${result.invalid.join(", ")}`,
        detail: { field, invalid: result.invalid },
      });
    }
  }

  return issues;
}

/**
 * Convenience: aggregate severity of an issue list.
 * Returns `"error"` if any error present, else `"warning"` if any warning,
 * else `null` (the template is clean).
 */
export function aggregateSeverity(issues) {
  if (!issues || issues.length === 0) return null;
  if (issues.some((i) => i.severity === SEVERITY.error)) return SEVERITY.error;
  if (issues.some((i) => i.severity === SEVERITY.warning)) return SEVERITY.warning;
  return null;
}
