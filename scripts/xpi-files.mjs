/**
 * The single source of truth for which files ship inside the XPI.
 *
 * Kept in its own module so both builders can read it without side effects:
 * scripts/build-xpi.mjs packages exactly this list, and
 * scripts/build-source-zip.mjs packages this list plus the build/test files a
 * reviewer needs. Before that split, the source zip carried its own hand-kept
 * copy and silently fell eight files behind.
 *
 * Anything not listed here is excluded from the XPI: tests, scripts,
 * lockfiles, screenshots, docs.
 */
export const XPI_FILES = [
  "manifest.json",
  "background.html",
  "background.js",
  "LICENSE",
  "modules/template-store.js",
  "modules/template-insert.js",
  "modules/template-lint.js",
  "modules/validation.js",
  "modules/compose-script.js",
  "modules/compose-utils.js",
  "modules/message-utils.js",
  "modules/ui-helpers.js",
  "modules/prompt-collector.js",
  "modules/usage-stats.js",
  "popup/popup.html",
  "popup/popup.css",
  "popup/popup.js",
  "options/options.html",
  "options/options.css",
  "options/options.js",
  "prompt-dialog/dialog.html",
  "prompt-dialog/dialog.css",
  "prompt-dialog/dialog.js",
  "welcome/welcome.html",
  "welcome/welcome.css",
  "welcome/welcome.js",
  // The welcome page renders the logo as SVG, so it ships in the XPI too.
  "images/icon.svg",
  "images/icon-16.png",
  "images/icon-32.png",
  "images/icon-64.png",
  "images/icon-128.png",
  "_locales/en/messages.json",
  "_locales/de/messages.json",
  "_locales/fr/messages.json",
  "_locales/es/messages.json",
  "_locales/it/messages.json",
  "_locales/nl/messages.json",
  "_locales/pt/messages.json",
];
