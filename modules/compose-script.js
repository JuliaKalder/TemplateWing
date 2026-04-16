// Runs inside the Thunderbird compose window (registered via `compose_scripts`
// in manifest.json). Its sole purpose is to insert a template at the current
// cursor position without touching the rest of the message body — preserving
// the user's signature and any text they have already typed. See GitHub
// issue #33.
//
// Important: Thunderbird's compose editor is not a plain `contenteditable`
// element; it uses `document.designMode="on"`, so we cannot rely on
// `isContentEditable`. Instead we operate on `document.body` directly and
// trust that `document.execCommand` acts on the current selection.

(function () {
  "use strict";

  // Snapshot of the last caret/selection inside the body. When the user opens
  // the toolbar popup the compose window loses focus and the selection may
  // collapse; we restore from this before execCommand so the insert lands
  // where the caret was.
  let lastRange = null;

  function rangeInBody(range) {
    return !!(
      range &&
      range.startContainer &&
      document.body &&
      document.body.contains(range.startContainer)
    );
  }

  document.addEventListener("selectionchange", () => {
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!rangeInBody(range)) return;
    lastRange = range.cloneRange();
  });

  function ensureSelectionInBody() {
    if (!document.body) return false;
    const sel = document.getSelection();
    if (!sel) return false;

    if (sel.rangeCount > 0 && rangeInBody(sel.getRangeAt(0))) {
      return true;
    }

    if (lastRange && rangeInBody(lastRange)) {
      sel.removeAllRanges();
      sel.addRange(lastRange);
      return true;
    }

    // No usable selection — collapse to the start of the body so we at least
    // land somewhere deterministic. This matches the old "prepend" behaviour
    // for users who trigger an insert without ever having placed their caret.
    const range = document.createRange();
    range.selectNodeContents(document.body);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  }

  function insertAtCursor(message) {
    if (!document.body) {
      return { ok: false, error: "no-body" };
    }

    // Try to regain focus so execCommand targets this document. In
    // designMode compose windows this is best-effort; context-menu and
    // keyboard-shortcut paths already have focus, while the popup path
    // delegates through the background page after closing.
    try { window.focus(); } catch (_) { /* ignore */ }
    try { if (document.body.focus) document.body.focus(); } catch (_) { /* ignore */ }

    if (!ensureSelectionInBody()) {
      return { ok: false, error: "no-selection" };
    }

    try {
      if (message.isPlainText) {
        document.execCommand("insertText", false, message.text || "");
      } else {
        document.execCommand("insertHTML", false, message.html || "");
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  const api = typeof messenger !== "undefined" ? messenger : browser;
  api.runtime.onMessage.addListener((message) => {
    if (!message || message.action !== "templatewing:insertAtCursor") return;
    return Promise.resolve(insertAtCursor(message));
  });
})();
