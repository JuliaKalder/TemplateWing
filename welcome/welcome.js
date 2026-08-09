// Welcome tab shown once after installation.
//
// The page is also openable as a plain file in a browser for design review, so
// every messenger.* touch is guarded: outside Thunderbird the HTML's English
// fallback text stays in place and links behave like ordinary anchors.

const hasMessenger = typeof messenger !== "undefined" && !!messenger.runtime;

function localize() {
  if (!hasMessenger || !messenger.i18n) return;

  // The tab label is the first thing the user sees, and <title> carries no
  // data-i18n hook, so it would otherwise stay English even in a locale whose
  // page body is fully translated.
  const headline = messenger.i18n.getMessage("welcomeHeadline");
  if (headline) document.title = headline;
  if (messenger.i18n.getUILanguage) {
    document.documentElement.lang = messenger.i18n.getUILanguage();
  }

  for (const el of document.querySelectorAll("[data-i18n]")) {
    const text = messenger.i18n.getMessage(el.getAttribute("data-i18n"));
    // Missing key returns "" — keep the English fallback rather than blanking
    // the section, which is what a half-translated locale would otherwise do.
    if (text) el.textContent = text;
  }
  for (const el of document.querySelectorAll("[data-i18n-title]")) {
    const text = messenger.i18n.getMessage(el.getAttribute("data-i18n-title"));
    if (text) el.title = text;
  }
}

function showVersion() {
  const badge = document.getElementById("version-badge");
  if (!badge || !hasMessenger || !messenger.runtime.getManifest) return;
  badge.textContent = `v${messenger.runtime.getManifest().version}`;
}

/**
 * Thunderbird does not follow http(s) links inside extension pages, so route
 * them through the OS default browser. Falls back to normal anchor behaviour
 * when the API is unavailable (browser preview).
 */
function wireExternalLinks() {
  if (!hasMessenger || !messenger.windows || !messenger.windows.openDefaultBrowser) return;
  for (const link of document.querySelectorAll('a[href^="https://"]')) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      messenger.windows.openDefaultBrowser(link.href).catch((err) => {
        console.error("TemplateWing: could not open link in default browser", err);
      });
    });
  }
}

function wireCreateButton() {
  const btn = document.getElementById("btn-create");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    if (!hasMessenger || !messenger.runtime.openOptionsPage) return;
    try {
      await messenger.runtime.openOptionsPage();
    } catch (err) {
      console.error("TemplateWing: could not open options page", err);
    }
  });
}

localize();
showVersion();
wireExternalLinks();
wireCreateButton();
