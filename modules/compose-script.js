// Runs inside the Thunderbird compose editor (registered via
// `compose_scripts` in manifest.json). Inserts a template body at the
// user's caret position without touching the rest of the message body —
// preserving the signature and any text already typed. See GitHub
// issue #33.
//
// Thunderbird-specific notes:
//  - The compose editor sets `document.designMode = "on"` on the iframe
//    document rather than using element-level `contenteditable`, so
//    walking the DOM for `isContentEditable` is unreliable. We operate
//    on `document.body` directly.
//  - `document.execCommand("insertHTML"|"insertText")` exists in Gecko's
//    nsEditor but can silently no-op in compose contexts (the editor's
//    internal selection state diverges from the DOM Selection API). We
//    use the Range API (`deleteContents` + `insertNode`) instead, which
//    is deterministic.
//  - When the toolbar popup opens, the editor loses focus and the live
//    Selection may collapse. We snapshot the user's range on every
//    meaningful event so we can restore it before insert.

(function () {
  "use strict";

  const TAG = "TemplateWing[compose]";
  try {
    console.log(TAG, "loaded", {
      url: location.href,
      designMode: document.designMode,
      readyState: document.readyState,
    });
  } catch (_) { /* console may be unavailable */ }

  let lastRange = null;

  function rangeInBody(range) {
    return !!(
      range &&
      range.startContainer &&
      range.endContainer &&
      document.body &&
      document.body.contains(range.startContainer) &&
      document.body.contains(range.endContainer)
    );
  }

  function snapshotSelection() {
    if (!document.body) return;
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!rangeInBody(range)) return;
    lastRange = range.cloneRange();
  }

  // selectionchange is the canonical event but doesn't always fire during
  // focus transitions in Gecko; mouseup/keyup/focusout cover the gaps.
  // We intentionally do NOT snapshot at load/DOMContentLoaded: the editor's
  // pre-positioned caret is at body,0, and seeding lastRange with that
  // value would cause cursor-mode inserts to land at the start whenever
  // the user opens the popup without first clicking into the body.
  document.addEventListener("selectionchange", snapshotSelection);
  document.addEventListener("mouseup", snapshotSelection, true);
  document.addEventListener("keyup", snapshotSelection, true);
  document.addEventListener("focusout", snapshotSelection, true);

  function getInsertRange() {
    if (!document.body) return null;
    // Prefer the snapshot over the live selection: opening the popup
    // causes focus to leave the compose window, and the live Selection
    // often collapses to body,0 on the return trip. The snapshot captured
    // on real user activity is the authoritative caret.
    if (lastRange && rangeInBody(lastRange)) {
      return lastRange.cloneRange();
    }
    const sel = document.getSelection();
    if (sel && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0);
      if (rangeInBody(r)) return r.cloneRange();
    }
    return null;
  }

  function insertHtmlAtRange(range, html) {
    const frag = range.createContextualFragment(html || "");
    const lastNode = frag.lastChild;
    range.deleteContents();
    range.insertNode(frag);
    return lastNode;
  }

  function insertTextAtRange(range, text) {
    const lines = (text || "").split(/\r?\n/);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) frag.appendChild(document.createElement("br"));
      if (lines[i]) frag.appendChild(document.createTextNode(lines[i]));
    }
    const lastNode = frag.lastChild;
    range.deleteContents();
    range.insertNode(frag);
    return lastNode;
  }

  function moveCaretAfter(node) {
    if (!node) return;
    const sel = document.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    lastRange = range.cloneRange();
  }

  function insertAtCursor(message) {
    try {
      console.log(TAG, "insertAtCursor request", {
        isPlainText: !!message.isPlainText,
        hasHtml: !!message.html,
        hasText: !!message.text,
        hasLastRange: !!lastRange,
        liveRangeCount: (document.getSelection() || {}).rangeCount,
      });
    } catch (_) { /* ignore */ }

    if (!document.body) return { ok: false, error: "no-body" };

    const range = getInsertRange();
    if (!range) {
      try { console.warn(TAG, "no usable range — caller will fall back"); } catch (_) {}
      return { ok: false, error: "no-range" };
    }

    // Restore the snapshot into the live Selection before inserting. We
    // avoid focusing the body beforehand because focus() on a designMode
    // body collapses the selection to body,0.
    try {
      const sel = document.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch (_) { /* ignore */ }

    try {
      const lastNode = message.isPlainText
        ? insertTextAtRange(range, message.text)
        : insertHtmlAtRange(range, message.html);
      moveCaretAfter(lastNode);
      try { console.log(TAG, "insert ok"); } catch (_) {}
      return { ok: true };
    } catch (err) {
      try { console.error(TAG, "insert threw", err); } catch (_) {}
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  const api = typeof messenger !== "undefined" ? messenger : browser;
  api.runtime.onMessage.addListener((message) => {
    if (!message || !message.action) return;

    if (message.action === "templatewing:insertAtCursor") {
      return Promise.resolve(insertAtCursor(message));
    }

    // Diagnostic: lets the background page verify the script is alive in a
    // given compose tab and inspect its current state.
    if (message.action === "templatewing:ping") {
      return Promise.resolve({
        ok: true,
        designMode: document.designMode,
        hasBody: !!document.body,
        hasLastRange: !!lastRange,
        readyState: document.readyState,
      });
    }
  });
})();
