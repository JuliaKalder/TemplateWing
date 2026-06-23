import { getTemplates, INSERT_MODES } from "./template-store.js";
import {
  parseRecipient,
  stripReplyForwardPrefix,
  quotePlaintext,
  quoteHtml,
  extractBody,
} from "./message-utils.js";

/**
 * The full set of single-curly `{NAME}` variables the resolver recognises.
 * Exported so the linter (`modules/template-lint.js`) can flag unknown tokens
 * — adding a new variable in this module is intentionally the place that
 * also expands the allow-list (single source of truth). Listed in the order
 * they're documented in the README.
 */
export const SUPPORTED_VARIABLES = Object.freeze([
  "DATE",
  "TIME",
  "DATETIME",
  "YEAR",
  "WEEKDAY",
  "SENDER_NAME",
  "SENDER_EMAIL",
  "ACCOUNT_NAME",
  "ACCOUNT_EMAIL",
  "RECIPIENT_NAME",
  "RECIPIENT_FIRSTNAME",
  "RECIPIENT_EMAIL",
  "REPLY_QUOTE",
  "LAST_MESSAGE_SUBJECT",
]);

export const WEEKDAY_NAMES = Object.freeze([
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
]);

/**
 * Insert `insertHtml` into `existingBody` at the most user-meaningful
 * position for a cursor-mode template when the real caret is unknown.
 * Priority:
 *   1. Before the Thunderbird reply/forward cite-prefix (`moz-cite-prefix`)
 *      — that's where the user types their reply, above the quoted message.
 *   2. Before the signature block (`moz-signature`) — so the template
 *      lands above the sign-off rather than after it.
 *   3. At the end of the body — as a last resort.
 * Uses regex rather than DOMParser to avoid any parse-serialize round-trip
 * that could reformat the user's in-flight HTML.
 */
export function smartInsertHtml(existingBody, insertHtml) {
  if (!existingBody) return insertHtml || "";
  if (!insertHtml) return existingBody;

  const citeRe =
    /<(div|blockquote)\b[^>]*\bclass\s*=\s*["'][^"']*\bmoz-cite-prefix\b[^"']*["'][^>]*>/i;
  const sigRe = /<(div|pre)\b[^>]*\bclass\s*=\s*["'][^"']*\bmoz-signature\b[^"']*["'][^>]*>/i;

  const cite = existingBody.match(citeRe);
  const sig = existingBody.match(sigRe);

  let idx = -1;
  if (cite && sig) idx = Math.min(cite.index, sig.index);
  else if (cite) idx = cite.index;
  else if (sig) idx = sig.index;

  if (idx >= 0) {
    return existingBody.slice(0, idx) + insertHtml + existingBody.slice(idx);
  }
  return existingBody + insertHtml;
}

/**
 * Plaintext equivalent. The standard signature delimiter is a line
 * consisting of exactly "-- " (dash dash space). Reply quotes in plaintext
 * usually start with lines prefixed "> ".
 */
export function smartInsertPlaintext(existingBody, insertText) {
  if (!existingBody) return insertText || "";
  if (!insertText) return existingBody;

  // Skip past the captured \n prefix to get the real start of the delimiter.
  function matchStart(m) {
    return m.index + (m[1] ? 1 : 0);
  }

  // Match the standalone sig delimiter line.
  const sigMatch = existingBody.match(/(^|\n)-- \n/);
  const quoteMatch = existingBody.match(/(^|\n)> /);

  let idx = -1;
  if (sigMatch && quoteMatch) {
    idx = Math.min(matchStart(sigMatch), matchStart(quoteMatch));
  } else if (sigMatch) {
    idx = matchStart(sigMatch);
  } else if (quoteMatch) {
    idx = matchStart(quoteMatch);
  }

  if (idx >= 0) {
    const suffix = insertText.endsWith("\n") ? "" : "\n";
    return existingBody.slice(0, idx) + insertText + suffix + existingBody.slice(idx);
  }
  return existingBody + insertText;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Pure helper: substitute the supported variable tokens in `text`.
 * Does not touch messenger.* or Date; all values are provided by the caller.
 * @param {string} text
 * @param {object} vars - { date, time, datetime, year, weekday, senderName, senderEmail, accountName, accountEmail }
 * @param {boolean} isHtml - When true, identity-derived values are HTML-entity-encoded before substitution.
 */
export function applyVariables(text, vars, isHtml = false) {
  if (!text) return text;
  const {
    date = "",
    time = "",
    datetime = "",
    year = "",
    weekday = "",
    senderName = "",
    senderEmail = "",
    accountName = "",
    accountEmail = "",
    recipientName = "",
    recipientFirstname = "",
    recipientEmail = "",
    replyQuote = "",
    lastMessageSubject = "",
  } = vars || {};
  const e = isHtml ? escapeHtml : (s) => String(s ?? "");
  // {REPLY_QUOTE} carries pre-formatted markup (HTML or plaintext lines).
  // Inserting it raw is intentional: HTML quotes must keep their <blockquote>
  // wrapper, and plaintext quotes their "> " prefix. Sanitization happens
  // upstream when the source message body is fetched.
  const quote = (s) => String(s ?? "");
  // Use function replacers to prevent $&/$'/$` pattern injection.
  return text
    .replace(/\{DATE\}/gi, () => date)
    .replace(/\{TIME\}/gi, () => time)
    .replace(/\{DATETIME\}/gi, () => datetime)
    .replace(/\{YEAR\}/gi, () => String(year))
    .replace(/\{WEEKDAY\}/gi, () => weekday)
    .replace(/\{SENDER_NAME\}/gi, () => e(senderName))
    .replace(/\{SENDER_EMAIL\}/gi, () => e(senderEmail))
    .replace(/\{ACCOUNT_NAME\}/gi, () => e(accountName))
    .replace(/\{ACCOUNT_EMAIL\}/gi, () => e(accountEmail))
    .replace(/\{RECIPIENT_NAME\}/gi, () => e(recipientName))
    .replace(/\{RECIPIENT_FIRSTNAME\}/gi, () => e(recipientFirstname))
    .replace(/\{RECIPIENT_EMAIL\}/gi, () => e(recipientEmail))
    .replace(/\{REPLY_QUOTE\}/gi, () => quote(replyQuote))
    .replace(/\{LAST_MESSAGE_SUBJECT\}/gi, () => e(lastMessageSubject));
}

/**
 * Resolve the sender identity variables for a compose tab by calling the
 * three Thunderbird messenger APIs that require live tab/account context.
 * Separating this from `replaceVariables` keeps the substitution logic pure
 * and independently testable.
 * @param {number} tabId
 * @returns {Promise<{senderName: string, senderEmail: string, accountName: string, accountEmail: string}>}
 */
export async function resolveIdentityVars(tabId) {
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
      } catch (err) {
        console.warn("TemplateWing: could not resolve account name", err);
      }
    }
  } catch (err) {
    console.warn("TemplateWing: could not resolve sender identity", err);
  }

  return { senderName, senderEmail, accountName, accountEmail };
}

/**
 * Resolve the recipient/reply context for a compose tab.
 *
 * Reads the first To: recipient (display name + email) and, if the compose
 * window is a reply/forward (`relatedMessageId` present), pulls the source
 * message body for {REPLY_QUOTE} and a cleaned subject for
 * {LAST_MESSAGE_SUBJECT}. Every value defaults to "" rather than "undefined"
 * so missing data degrades gracefully.
 *
 * @param {number} tabId
 * @param {boolean} isHtml - true when the active compose mode is HTML; controls REPLY_QUOTE wrapping.
 * @returns {Promise<{recipientName,recipientFirstname,recipientEmail,replyQuote,lastMessageSubject}>}
 */
export async function resolveRecipientVars(tabId, isHtml = false) {
  let recipientName = "";
  let recipientFirstname = "";
  let recipientEmail = "";
  let replyQuote = "";
  let lastMessageSubject = "";

  let details;
  try {
    details = await messenger.compose.getComposeDetails(tabId);
  } catch (err) {
    console.warn("TemplateWing: could not fetch compose details for recipient vars", err);
    return {
      recipientName,
      recipientFirstname,
      recipientEmail,
      replyQuote,
      lastMessageSubject,
    };
  }

  const firstTo = Array.isArray(details.to) ? details.to[0] : null;
  if (firstTo) {
    const parsed = parseRecipient(firstTo);
    if (parsed) {
      recipientName = parsed.name;
      recipientFirstname = parsed.firstname;
      recipientEmail = parsed.email;
    }
  }

  if (details.relatedMessageId != null && messenger.messages && messenger.messages.getFull) {
    try {
      const related = await messenger.messages.get(details.relatedMessageId);
      if (related && related.subject) {
        lastMessageSubject = stripReplyForwardPrefix(related.subject);
      }
    } catch (err) {
      console.warn("TemplateWing: could not get related message header", err);
    }
    try {
      const full = await messenger.messages.getFull(details.relatedMessageId);
      const extracted = extractBody(full);
      if (extracted) {
        replyQuote = isHtml ? quoteHtml(extracted.body) : quotePlaintext(extracted.body);
      }
    } catch (err) {
      console.warn("TemplateWing: could not get related message body", err);
    }
  }

  return {
    recipientName,
    recipientFirstname,
    recipientEmail,
    replyQuote,
    lastMessageSubject,
  };
}

// ---- Conditional variables ({IF} / {ELSE} / {ENDIF}) ----

/**
 * Look up a dot-path on the context object.
 * Returns "" if any segment is missing — explicitly NOT undefined, so that
 * comparisons in {IF} treat unknown variables as the empty string. That
 * mirrors how stage-1 variable substitution leaves missing values blank.
 */
function getByPath(ctx, path) {
  const parts = path.split(".");
  let cur = ctx;
  for (const p of parts) {
    if (cur == null) return "";
    cur = cur[p];
  }
  return cur == null ? "" : cur;
}

/**
 * Parse one {IF} expression. Supports `lhs == "rhs"` and `lhs != "rhs"`,
 * with single OR double quotes around rhs. lhs is a dot-path.
 * Returns a function (ctx) => boolean. Unknown operators yield `() => false`.
 */
function compileCondition(expr) {
  const m = String(expr)
    .trim()
    .match(/^([a-zA-Z0-9_.]+)\s*(==|!=)\s*(?:"([^"]*)"|'([^']*)'|([^"'\s]+))$/);
  if (!m) {
    console.warn("TemplateWing: unparseable {IF} expression:", expr);
    return () => false;
  }
  const path = m[1];
  const op = m[2];
  const rhs = m[3] != null ? m[3] : m[4] != null ? m[4] : m[5];
  return (ctx) => {
    const lhs = String(getByPath(ctx, path) ?? "");
    return op === "==" ? lhs === rhs : lhs !== rhs;
  };
}

/**
 * Resolve {IF cond}…{ELSE}…{ENDIF} blocks in `text` against `ctx`.
 * Supports nesting via a manual stack walk — no regex recursion.
 *
 * Grammar (case-insensitive):
 *   IF       := "{IF " <cond> "}"
 *   ELSE     := "{ELSE}"
 *   ENDIF    := "{ENDIF}"
 *
 * Unmatched ENDIF is left in place; unmatched IF (no closing ENDIF) emits
 * a warning and falls through unchanged so the user can see something
 * survived rather than getting silently truncated.
 */
export function resolveControlFlow(text, ctx) {
  if (!text || !/\{(IF\b|ELSE|ENDIF)/i.test(text)) return text || "";

  const tokenRe = /\{(IF)\s+([^}]+)\}|\{(ELSE)\}|\{(ENDIF)\}/gi;
  const tokens = [];
  let lastIndex = 0;
  let m;
  while ((m = tokenRe.exec(text)) !== null) {
    if (m.index > lastIndex) tokens.push({ type: "text", value: text.slice(lastIndex, m.index) });
    if (m[1]) tokens.push({ type: "if", cond: compileCondition(m[2]) });
    else if (m[3]) tokens.push({ type: "else" });
    else if (m[4]) tokens.push({ type: "endif" });
    lastIndex = tokenRe.lastIndex;
  }
  if (lastIndex < text.length) tokens.push({ type: "text", value: text.slice(lastIndex) });

  // Recursive-descent over the token stream.
  let i = 0;
  function renderUntil(stopTypes) {
    let out = "";
    while (i < tokens.length) {
      const tok = tokens[i];
      if (stopTypes.includes(tok.type)) return out;
      if (tok.type === "text") {
        out += tok.value;
        i++;
      } else if (tok.type === "if") {
        const cond = tok.cond(ctx);
        i++; // consume {IF}
        const thenPart = renderUntil(["else", "endif"]);
        let elsePart = "";
        if (tokens[i] && tokens[i].type === "else") {
          i++; // consume {ELSE}
          elsePart = renderUntil(["endif"]);
        }
        if (tokens[i] && tokens[i].type === "endif") {
          i++; // consume {ENDIF}
        } else {
          console.warn("TemplateWing: {IF} block missing matching {ENDIF}");
        }
        out += cond ? thenPart : elsePart;
      } else {
        // Stray {ELSE} or {ENDIF} at top level — leave literal.
        out += tok.type === "else" ? "{ELSE}" : "{ENDIF}";
        i++;
      }
    }
    return out;
  }
  return renderUntil([]);
}

// ---- Prompt variables ({PROMPT} / {CHOICE}) ----

/**
 * Scan text for {PROMPT:label[:default]} and {CHOICE:label:o1|o2|...} tokens.
 * Returns an ordered list of unique tokens (deduplicated by literal text
 * so the same {PROMPT} can appear N times in body+subject but only asks
 * the user once).
 */
export function extractPromptTokens(text) {
  const out = [];
  const seen = new Set();
  if (!text) return out;
  const re = /\{(PROMPT|CHOICE):([^}]+)\}/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const literal = m[0];
    if (seen.has(literal)) continue;
    seen.add(literal);
    const kind = m[1].toUpperCase();
    const args = m[2].split(":");
    if (kind === "PROMPT") {
      out.push({
        literal,
        kind: "prompt",
        label: (args[0] || "").trim(),
        default: args.length > 1 ? args.slice(1).join(":") : "",
      });
    } else {
      // CHOICE:label:opt1|opt2|opt3
      const label = (args[0] || "").trim();
      const optionsRaw = args.slice(1).join(":");
      const options = optionsRaw
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);
      out.push({
        literal,
        kind: "choice",
        label,
        options,
        default: options[0] || "",
      });
    }
  }
  return out;
}

/**
 * Apply user-supplied answers to {PROMPT}/{CHOICE} tokens in `text`.
 * `answers` maps literal token text to the chosen string. Tokens without
 * an answer entry are replaced with the parsed `default` (or empty).
 */
export function applyPromptAnswers(text, tokens, answers, isHtml = false) {
  if (!text || tokens.length === 0) return text;
  const e = isHtml ? escapeHtml : (s) => String(s ?? "");
  let out = text;
  for (const tok of tokens) {
    const value = Object.prototype.hasOwnProperty.call(answers, tok.literal)
      ? answers[tok.literal]
      : tok.default || "";
    // Function replacer prevents $&/$'/$` injection from user-typed answers.
    out = out.split(tok.literal).join(e(value));
  }
  return out;
}

/**
 * Replace template variables in text.
 *
 * Supported tokens: {DATE}, {TIME}, {DATETIME}, {YEAR}, {WEEKDAY},
 * {SENDER_NAME}, {SENDER_EMAIL}, {ACCOUNT_NAME}, {ACCOUNT_EMAIL},
 * {RECIPIENT_NAME}, {RECIPIENT_FIRSTNAME}, {RECIPIENT_EMAIL},
 * {REPLY_QUOTE}, {LAST_MESSAGE_SUBJECT}.
 *
 * @param {string} text - Text containing placeholders
 * @param {object} vars - Pre-resolved identity vars: { senderName, senderEmail, accountName, accountEmail }.
 *   Obtain via {@link resolveIdentityVars} before calling this function.
 * @param {boolean} isHtml - Pass true when substituting into HTML to HTML-encode identity values.
 * @returns {string} Text with placeholders replaced
 * @see applyVariables
 * @see resolveIdentityVars
 */
export function replaceVariables(text, vars, isHtml = false) {
  if (!text) return text;
  const now = new Date();
  return applyVariables(
    text,
    {
      date: now.toLocaleDateString(),
      time: now.toLocaleTimeString(),
      datetime: now.toLocaleDateString() + " " + now.toLocaleTimeString(),
      year: now.getFullYear(),
      weekday: WEEKDAY_NAMES[now.getDay()],
      senderName: "",
      senderEmail: "",
      accountName: "",
      accountEmail: "",
      ...vars,
    },
    isHtml
  );
}

export const TEMPLATE_INCLUDE_REGEX = /\{\{template(id)?:([^}]+)\}\}/gi;

/**
 * Resolve nested template includes in text.
 * Syntax: {{template:Template Name}} or {{templateid:abc123}}
 * @param {string} text - Text containing template includes
 * @param {Set} visited - DFS path set of template IDs for cycle detection.
 *   A new Set copy is created for each recursive branch, so the same template
 *   can appear in separate non-cyclic paths (diamond include graphs are allowed).
 * @param {Map} templatesById - Map of template ID to template object
 * @param {Map} templatesByName - Map of template name (lowercase) to template object
 * @returns {Promise<string>} Text with includes resolved
 */
export async function resolveNestedTemplates(
  text,
  visited,
  templatesById,
  templatesByName,
  memo = new Map()
) {
  if (!text) return text;

  // Use a fresh regex per call to avoid lastIndex state on the shared exported one.
  const includeRegex = new RegExp(TEMPLATE_INCLUDE_REGEX.source, TEMPLATE_INCLUDE_REGEX.flags);

  // Collect all matches from `text`, then apply replacements to `resolved`.
  // String.replace without /g replaces one occurrence per call, so each match
  // from the original text is resolved exactly once even if its literal appears
  // multiple times in the evolving `resolved` string.
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
      console.warn("TemplateWing: referenced template not found:", JSON.stringify(identifier));
      continue;
    }

    if (visited.has(nestedTemplate.id)) {
      console.error(
        "TemplateWing: circular reference detected for template:",
        JSON.stringify(nestedTemplate.name)
      );
      throw new Error(`Circular reference detected: ${nestedTemplate.name}`);
    }

    let nestedContent;
    if (memo.has(nestedTemplate.id)) {
      nestedContent = memo.get(nestedTemplate.id);
    } else {
      nestedContent = await resolveNestedTemplates(
        nestedTemplate.body || "",
        new Set([...visited, nestedTemplate.id]),
        templatesById,
        templatesByName,
        memo
      );
      memo.set(nestedTemplate.id, nestedContent);
    }

    // Use function replacer to prevent $&/$'/$` pattern injection.
    resolved = resolved.replace(fullMatch, () => nestedContent);
  }

  return resolved;
}

/**
 * Strip HTML tags and decode entities to plain text. Used when inserting a
 * template body into a compose window that is in plain-text mode.
 * @param {string} html
 * @returns {string}
 */
export function htmlToPlainText(html) {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body ? doc.body.textContent || "" : "";
}

/**
 * Try to insert `body` at the cursor position in the given compose tab.
 *
 * Attempts to (re-)inject compose-script.js via executeScript so that a
 * listener is always present, then sends the insertAtCursor message.
 *
 * @param {number} tabId - The compose tab ID
 * @param {string} body - The resolved, variable-replaced HTML body to insert
 * @param {object} existingDetails - Result of messenger.compose.getComposeDetails(tabId)
 * @returns {Promise<string|null>} Resolves to `null` when the cursor insert
 *   succeeded, or to the fallback body string (via smartInsertPlaintext /
 *   smartInsertHtml) when it did not.
 */
async function tryCursorInsert(tabId, body, existingDetails) {
  const isPlainText = !!existingDetails.isPlainText;
  console.log("TemplateWing: cursor mode -> sending insertAtCursor", { tabId, isPlainText });

  // Safety net: even with composeScripts.register() set up at boot,
  // explicitly re-inject here so that if something upstream went wrong
  // (registration failed, tab opened before register resolved, etc.)
  // we still have a listener to talk to. Idempotent via the
  // listener-swap in compose-script.js.
  try {
    await messenger.tabs.executeScript(tabId, {
      file: "/modules/compose-script.js",
    });
    console.log("TemplateWing: pre-send inject ok", { tabId });
  } catch (err) {
    console.warn("TemplateWing: pre-send inject failed", err && err.message);
  }

  try {
    const response = await messenger.tabs.sendMessage(tabId, {
      action: "templatewing:insertAtCursor",
      html: body,
      text: htmlToPlainText(body),
      isPlainText,
    });
    console.log("TemplateWing: cursor mode <- response", response);
    if (response && response.ok) {
      return null;
    }
    // Script ran but refused to insert (no usable range, editor
    // rejected execCommand, DOM exception, etc). `response.error`
    // carries the specific code from compose-script.js.
    const code = (response && response.error) || "unknown";
    console.warn(`TemplateWing: compose-script returned ${code} — falling back to append`);
  } catch (err) {
    // tabs.sendMessage could not reach a listener in this tab. Possible
    // causes: composeScripts.register() has not yet resolved for this tab,
    // the background-page backfill via executeScript failed or hasn't run
    // yet, or the tab was open before the add-on loaded. Fall back to
    // append so the existing body and signature stay intact.
    console.warn(
      "TemplateWing: compose-script not injected in this tab — falling back to append",
      err && err.message ? err.message : err
    );
  }

  // Smart fallback: when the compose-script path could not insert at
  // the caret (no listener, no usable range, Gecko quirks, etc.),
  // insert at a user-meaningful anchor rather than blindly appending.
  // Priority: before cite-prefix (reply quote), before signature,
  // else append. Keeps the template from landing after the sign-off.
  const fallbackBody = isPlainText
    ? smartInsertPlaintext(existingDetails.body || "", htmlToPlainText(body))
    : smartInsertHtml(existingDetails.body || "", body);
  console.log(
    "TemplateWing: cursor fallback wrote template",
    isPlainText ? "as plaintext (smart-insert)" : "as HTML (smart-insert)"
  );
  return fallbackBody;
}

/**
 * Build the variable context used for {IF} expressions and template
 * substitution. Kept as a separate object so resolveControlFlow can read
 * dot-paths like `recipient.email` or `identity.email`.
 */
export function buildVariableContext({ identityVars, recipientVars, date }) {
  const now = date || new Date();
  return {
    identity: {
      name: identityVars.senderName || "",
      email: identityVars.senderEmail || "",
    },
    account: {
      name: identityVars.accountName || "",
      email: identityVars.accountEmail || "",
    },
    recipient: {
      name: recipientVars.recipientName || "",
      firstname: recipientVars.recipientFirstname || "",
      email: recipientVars.recipientEmail || "",
      domain: (recipientVars.recipientEmail || "").split("@")[1] || "",
    },
    date: now.toLocaleDateString(),
    time: now.toLocaleTimeString(),
    year: String(now.getFullYear()),
    weekday: WEEKDAY_NAMES[now.getDay()],
  };
}

/**
 * Insert a template into a compose tab.
 * @param {number} tabId - The compose tab ID
 * @param {object} template - Template object from storage
 * @param {object} [opts]
 * @param {Object<string,string>} [opts.promptAnswers] - Map of literal token text → user answer.
 *   When omitted, prompt tokens fall back to their declared defaults. Callers
 *   that have UI access should call {@link extractPromptTokens} first, ask
 *   the user, and pass the answers in.
 */
export async function insertTemplateIntoTab(tabId, template, opts = {}) {
  const promptAnswers = opts.promptAnswers || {};
  const mode = template.insertMode || INSERT_MODES.APPEND;
  const details = {};

  // Hoist compose details fetch so we can use identityId for both nested
  // template filtering and later insert-mode operations.
  let currentIdentityId = null;
  let isPlainText = false;
  try {
    const composeDetails = await messenger.compose.getComposeDetails(tabId);
    currentIdentityId = composeDetails.identityId || null;
    isPlainText = !!composeDetails.isPlainText;
  } catch (err) {
    console.warn("TemplateWing: could not fetch compose details for identity filtering", err);
  }

  let resolvedBody = template.body;
  if (template.body && new RegExp(TEMPLATE_INCLUDE_REGEX.source, "i").test(template.body)) {
    try {
      const allTemplates = await getTemplates();
      // Filter to only templates that the current identity is allowed to use.
      // A template with no identities restriction (empty or absent) is always
      // available; otherwise the current identity must be listed explicitly.
      const allowedTemplates = allTemplates.filter(
        (t) =>
          !t.identities ||
          t.identities.length === 0 ||
          (currentIdentityId && t.identities.includes(currentIdentityId))
      );
      const templatesById = new Map(allowedTemplates.map((t) => [t.id, t]));
      const templatesByName = new Map(
        allowedTemplates.map((t) => [(t.name || "").toLowerCase(), t])
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

  // Resolve identity + recipient/reply context. Both run regardless of
  // whether the template references them — the cost is one storage read
  // and (for replies) one messages.getFull call, and the buildVariableContext
  // helper still needs them for {IF} expressions.
  const identityVars = await resolveIdentityVars(tabId);
  const recipientVars = await resolveRecipientVars(tabId, !isPlainText);
  const ctx = buildVariableContext({ identityVars, recipientVars });

  // Pipeline: nested → vars → control flow → prompts. The current order
  // expands nested includes first so subsequent passes see the full body.
  function pipeline(text, isHtml) {
    let s = replaceVariables(text, { ...identityVars, ...recipientVars }, isHtml);
    s = resolveControlFlow(s, ctx);
    const tokens = extractPromptTokens(s);
    if (tokens.length > 0) s = applyPromptAnswers(s, tokens, promptAnswers, isHtml);
    return s;
  }

  // "cursor" mode is delivered via a compose script message rather than by
  // rewriting the whole body, so the signature and any text the user has
  // already typed stay intact.
  if (resolvedBody && mode === INSERT_MODES.CURSOR) {
    const body = pipeline(resolvedBody, true);
    const existing = await messenger.compose.getComposeDetails(tabId);
    const fallbackBody = await tryCursorInsert(tabId, body, existing);
    if (fallbackBody !== null) details.body = fallbackBody;
  } else if (resolvedBody) {
    const body = pipeline(resolvedBody, true);
    if (mode === INSERT_MODES.REPLACE) {
      details.body = body;
    } else if (mode === INSERT_MODES.PREPEND) {
      const existing = await messenger.compose.getComposeDetails(tabId);
      details.body = body + (existing.body || "");
    } else if (mode === INSERT_MODES.APPEND) {
      const existing = await messenger.compose.getComposeDetails(tabId);
      details.body = (existing.body || "") + body;
    } else {
      console.warn(
        "TemplateWing: unknown insert mode:",
        JSON.stringify(mode),
        "— defaulting to append"
      );
      const existing = await messenger.compose.getComposeDetails(tabId);
      details.body = (existing.body || "") + body;
    }
  }

  if (template.subject) {
    details.subject = pipeline(template.subject, false);
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
    await decodeAndAttach(tabId, template.attachments);
  }
}

/**
 * Decode base64-encoded attachments and add them to a compose tab.
 * Failures are collected per-file; a single error is thrown at the end
 * listing all filenames that could not be attached.
 * @param {number} tabId - The compose tab ID
 * @param {Array<{name: string, data: string, type: string}>} attachments
 */
export async function decodeAndAttach(tabId, attachments) {
  const attachmentErrors = [];
  for (const att of attachments) {
    try {
      const binary = atob(att.data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      // Sanitize filename: strip path separators, null bytes, and control chars
      const safeName = (att.name || "attachment")
        .replace(/[/\\:\x00-\x1f]/g, "_")
        .replace(/^\.+/, "_");
      const file = new File([bytes], safeName, { type: att.type });
      await messenger.compose.addAttachment(tabId, { file, name: safeName });
    } catch (err) {
      console.error("TemplateWing: failed to attach:", JSON.stringify(att.name), err);
      attachmentErrors.push(att.name);
    }
  }
  if (attachmentErrors.length > 0) {
    const err = new Error(`Could not attach: ${attachmentErrors.join(", ")}`);
    err.code = "ATTACHMENT_FAILED";
    err.failedNames = attachmentErrors;
    throw err;
  }
}
