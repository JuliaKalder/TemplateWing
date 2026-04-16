// Runs inside the Thunderbird compose window (registered via `compose_scripts`
// in manifest.json). Its sole purpose is to insert a template at the current
// cursor position without touching the rest of the message body — preserving
// the user's signature and any text they have already typed. See GitHub
// issue #33.

(function () {
  "use strict";

  // Remember the last caret / selection range inside a contenteditable element.
  // When the user opens the popup the editor loses focus and `window.getSelection()`
  // collapses; by snapshotting the range on `selectionchange` we can restore it
  // before calling execCommand so the insert lands where the caret was.
  let lastRange = null;

  function isInsideEditable(node) {
    for (let n = node; n; n = n.parentNode) {
      if (n.nodeType === 1 && n.isContentEditable) return n;
    }
    return null;
  }

  document.addEventListener("selectionchange", () => {
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const container = range.startContainer;
    if (!container) return;
    if (!isInsideEditable(container)) return;
    lastRange = range.cloneRange();
  });

  function findEditable() {
    if (document.activeElement && document.activeElement.isContentEditable) {
      return document.activeElement;
    }
    // Fall back to any contenteditable element in the document (Thunderbird's
    // compose editor is the body of the inner <iframe> with contenteditable).
    const editable = document.querySelector("[contenteditable=true], [contenteditable='']");
    if (editable) return editable;
    if (document.body && document.body.isContentEditable) return document.body;
    return null;
  }

  function restoreSelection(editor) {
    const sel = document.getSelection();
    if (!sel) return false;

    // If the current selection is already inside the editor, keep it.
    if (sel.rangeCount > 0) {
      const current = sel.getRangeAt(0);
      if (editor.contains(current.startContainer)) return true;
    }

    if (lastRange && editor.contains(lastRange.startContainer)) {
      sel.removeAllRanges();
      sel.addRange(lastRange);
      return true;
    }

    // Last resort: collapse to the start of the editor so we at least insert
    // somewhere deterministic, rather than silently appending to the DOM.
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  }

  function insertAtCursor(message) {
    const editor = findEditable();
    if (!editor) {
      return { ok: false, error: "no-editor" };
    }

    editor.focus();
    restoreSelection(editor);

    try {
      if (message.isPlainText) {
        document.execCommand("insertText", false, message.text || "");
      } else {
        // `insertHTML` respects the current caret/selection and merges the
        // template fragment with surrounding content rather than replacing the
        // whole body.
        document.execCommand("insertHTML", false, message.html || "");
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  }

  messenger.runtime.onMessage.addListener((message) => {
    if (!message || message.action !== "templatewing:insertAtCursor") return;
    return Promise.resolve(insertAtCursor(message));
  });
})();
