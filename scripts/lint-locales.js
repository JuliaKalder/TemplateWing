/**
 * Locale lint: ensure all locale files have the same set of message keys.
 * Exits with code 1 if any locale is missing keys present in en.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const localesDir = join(import.meta.dirname, "..", "_locales");
const dirs = readdirSync(localesDir);

const locales = {};
for (const dir of dirs) {
  const filePath = join(localesDir, dir, "messages.json");
  try {
    locales[dir] = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    // skip non-locale dirs
  }
}

if (!locales.en) {
  console.error("Missing _locales/en/messages.json");
  process.exit(1);
}

const referenceKeys = Object.keys(locales.en).sort();
let hasErrors = false;

for (const [locale, messages] of Object.entries(locales)) {
  if (locale === "en") continue;
  const keys = Object.keys(messages);
  const missing = referenceKeys.filter((k) => !keys.includes(k));
  const extra = keys.filter((k) => !referenceKeys.includes(k));

  if (missing.length > 0) {
    console.error(`[${locale}] Missing ${missing.length} key(s): ${missing.join(", ")}`);
    hasErrors = true;
  }
  if (extra.length > 0) {
    console.warn(`[${locale}] Extra ${extra.length} key(s): ${extra.join(", ")}`);
  }
}

if (hasErrors) {
  process.exit(1);
} else {
  console.log(`All ${dirs.length} locale(s) have consistent keys (${referenceKeys.length} keys each).`);
}
