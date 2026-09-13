/**
 * Address-book lookups for the {RECIPIENT_NICKNAME} variable.
 *
 * Split out of template-insert.js for two reasons: the vCard parsing below is
 * pure and worth testing on its own, and everything here sits behind the
 * OPTIONAL `addressBooks` permission. Nothing in this module may throw — a
 * missing permission, a missing API, or a malformed card all resolve to the
 * empty string, because a template insert must never fail over a nickname.
 *
 * Why vCard parsing at all: Thunderbird stores contacts as vCards since 102,
 * and the nickname is only reliably reachable as the NICKNAME property inside
 * that card. Where a build still exposes the legacy `NickName` property we
 * take it, but we do not rely on it.
 */

/** The permission this module needs. Declared in manifest.json as optional. */
export const ADDRESS_BOOK_PERMISSION = Object.freeze({ permissions: ["addressBooks"] });

/**
 * Unfold a vCard: RFC 6350 allows any line to be continued by starting the
 * next one with a single space or tab, and Thunderbird does wrap long values.
 * Folding must be undone before anything else looks at the lines.
 */
function unfold(vcard) {
  return String(vcard ?? "").replace(/\r\n[ \t]|\n[ \t]|\r[ \t]/g, "");
}

/** Undo the vCard value escapes: \n \, \; \\ */
function unescapeValue(value) {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = value[++i];
    if (next === undefined) break;
    if (next === "n" || next === "N") out += "\n";
    else out += next;
  }
  return out;
}

/**
 * Split a value on unescaped commas. NICKNAME is a comma-separated list
 * ("Kat,Kate"); we only ever want the first entry, but splitting correctly
 * is what makes "Meier\, Kat" survive as one value.
 */
function splitValueList(value) {
  const parts = [];
  let cur = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "\\") {
      cur += ch + (value[++i] ?? "");
    } else if (ch === ",") {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts;
}

/** Split a vCard value into its structured components on unescaped ";". */
function splitStructured(value) {
  const parts = [];
  let cur = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "\\") {
      cur += ch + (value[++i] ?? "");
    } else if (ch === ";") {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts;
}

/**
 * Iterate the content lines of a vCard as { name, value } pairs, with the
 * group prefix ("item1.EMAIL") and parameters (";TYPE=work") stripped from
 * the name. The name is upper-cased; the value is left raw so callers can
 * decide whether to split it as a list first.
 */
function* vCardLines(vcard) {
  for (const rawLine of unfold(vcard).split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    // The first colon that is not inside a quoted parameter ends the name.
    let colon = -1;
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') quoted = !quoted;
      else if (ch === ":" && !quoted) {
        colon = i;
        break;
      }
    }
    if (colon < 0) continue;
    const namePart = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const withoutParams = namePart.split(";")[0];
    const dot = withoutParams.lastIndexOf(".");
    const name = (dot >= 0 ? withoutParams.slice(dot + 1) : withoutParams).trim().toUpperCase();
    if (name) yield { name, value };
  }
}

/**
 * First NICKNAME value of a vCard, or "" when the card has none.
 * @param {string} vcard
 * @returns {string}
 */
export function nicknameFromVCard(vcard) {
  if (!vcard) return "";
  for (const { name, value } of vCardLines(vcard)) {
    if (name !== "NICKNAME") continue;
    for (const part of splitValueList(value)) {
      const nickname = unescapeValue(part).trim();
      if (nickname) return nickname;
    }
  }
  return "";
}

/**
 * All EMAIL values of a vCard, lower-cased.
 * @param {string} vcard
 * @returns {string[]}
 */
export function emailsFromVCard(vcard) {
  const out = [];
  if (!vcard) return out;
  for (const { name, value } of vCardLines(vcard)) {
    if (name !== "EMAIL") continue;
    for (const part of splitValueList(value)) {
      const email = unescapeValue(part).trim().toLowerCase();
      if (email) out.push(email);
    }
  }
  return out;
}

/**
 * Does this contact carry `email`?
 *
 * quickSearch matches substrings across every field, so it happily returns a
 * contact whose *notes* mention the address. Without this check the nickname
 * of an unrelated contact could end up in the greeting — a wrong name is
 * worse than no name.
 *
 * @param {object} contact - A messenger.contacts ContactNode.
 * @param {string} email - Lower-cased address to match.
 */
export function contactHasEmail(contact, email) {
  if (!contact || !email) return false;
  const props = contact.properties || {};
  for (const key of ["PrimaryEmail", "SecondEmail"]) {
    if (
      String(props[key] ?? "")
        .trim()
        .toLowerCase() === email
    )
      return true;
  }
  return emailsFromVCard(props.vCard).includes(email);
}

/** Nickname of a ContactNode: legacy property first, then the vCard. */
export function nicknameFromContact(contact) {
  const props = (contact && contact.properties) || {};
  const legacy = String(props.NickName ?? "").trim();
  if (legacy) return legacy;
  return nicknameFromVCard(props.vCard);
}

/**
 * Display name and given name of a vCard: FN for the full name, the second
 * component of N ("family;given;…") for the given name.
 *
 * @param {string} vcard
 * @returns {{name: string, firstname: string}}
 */
export function namesFromVCard(vcard) {
  let name = "";
  let firstname = "";
  if (!vcard) return { name, firstname };
  for (const { name: prop, value } of vCardLines(vcard)) {
    if (prop === "FN" && !name) {
      name = unescapeValue(splitValueList(value)[0] || "").trim();
    } else if (prop === "N" && !firstname) {
      // family;given;additional;prefixes;suffixes — components are separated
      // by semicolons, which splitValueList does not touch.
      const given = splitStructured(value)[1] || "";
      firstname = unescapeValue(splitValueList(given)[0] || "").trim();
    }
  }
  return { name, firstname };
}

/**
 * Name fields of a ContactNode, legacy properties first, then the vCard,
 * and the display name's first word as the last resort for a given name.
 *
 * @param {object} contact - A messenger.contacts ContactNode.
 * @returns {{name: string, firstname: string}}
 */
export function namesFromContact(contact) {
  const props = (contact && contact.properties) || {};
  const fromCard = namesFromVCard(props.vCard);
  const name = String(props.DisplayName ?? "").trim() || fromCard.name;
  const firstname =
    String(props.FirstName ?? "").trim() || fromCard.firstname || name.split(/\s+/)[0] || "";
  return { name, firstname };
}

/**
 * Has the user granted the optional `addressBooks` permission?
 * Returns false rather than throwing when the permissions API is absent.
 */
export async function hasAddressBookPermission() {
  try {
    if (!globalThis.messenger?.permissions?.contains) return false;
    return !!(await messenger.permissions.contains(ADDRESS_BOOK_PERMISSION));
  } catch (err) {
    console.warn("TemplateWing: could not check address book permission", err);
    return false;
  }
}

/**
 * Run a contacts quickSearch for `email`.
 *
 * Thunderbird 128 takes a queryInfo object; older signatures took a bare
 * string. We try the documented form first and fall back once, so the add-on
 * keeps working either way instead of silently returning nothing.
 */
async function quickSearchContacts(email) {
  try {
    return await messenger.contacts.quickSearch({ searchString: email, includeRemote: false });
  } catch (err) {
    try {
      return await messenger.contacts.quickSearch(email);
    } catch (fallbackErr) {
      console.warn("TemplateWing: contacts.quickSearch failed", err, fallbackErr);
      return [];
    }
  }
}

/**
 * The address-book contact for `email`, reduced to the fields a template can
 * use: nickname, display name, given name.
 *
 * Resolves to null for every "we don't know": no address, permission not
 * granted, API missing, no matching contact. Individual fields are "" when
 * the card does not carry them. Callers do not need to distinguish those
 * cases — a template decides what an empty nickname means via
 * {IF recipient.nickname!=""}.
 *
 * When several address books hold the same address, the first match wins;
 * quickSearch returns them in address-book order, personal book first.
 *
 * @param {string} email
 * @returns {Promise<{nickname: string, name: string, firstname: string}|null>}
 */
export async function lookupContactByEmail(email) {
  const needle = String(email ?? "")
    .trim()
    .toLowerCase();
  if (!needle) return null;
  if (!globalThis.messenger?.contacts?.quickSearch) return null;
  if (!(await hasAddressBookPermission())) return null;

  const contacts = await quickSearchContacts(needle);
  if (!Array.isArray(contacts)) return null;
  for (const contact of contacts) {
    if (!contactHasEmail(contact, needle)) continue;
    const names = namesFromContact(contact);
    return {
      nickname: nicknameFromContact(contact),
      name: names.name,
      firstname: names.firstname,
    };
  }
  return null;
}
