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

  // The declarative `compose_scripts` injection and the boot-time backfill
  // in background.js can both target the same tab (e.g. a compose window
  // that was already open at add-on load *and* stays open across a reload).
  // Guard against double-registration of the onMessage listener, which
  // would otherwise cause insertAtCursor to resolve twice.
  //
  // We can't use a plain boolean sentinel: the compose window's `window`
  // object survives add-on reloads, so the property would stay `true` while
  // the prior extension's listener has already died with its context. On
  // reload the new script would bail out and never register — leaving the
  // tab permanently unable to receive messages. Instead, we stash the
  // currently-registered listener (and its API namespace) on the window so
  // each new load can de-register the previous one before registering its
  // own. removeListener on a dead listener is a safe no-op.
  if (window.__templateWingCompose) {
    try {
      const prev = window.__templateWingCompose;
      if (prev && prev.listener && prev.api) {
        prev.api.runtime.onMessage.removeListener(prev.listener);
      }
    } catch (_) { /* ignore — prior listener may belong to an unloaded extension */ }
  }

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

  // Gecko's designMode editor frequently collapses the Selection to
  // (body, 0) on blur/focus-loss. If we let that value overwrite a real
  // caret captured during editing, cursor-mode inserts land at the start.
  function isBodyStartCollapsed(range) {
    return !!(
      range &&
      range.collapsed &&
      document.body &&
      range.startContainer === document.body &&
      range.startOffset === 0
    );
  }

  function snapshotSelection() {
    if (!document.body) return;
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!rangeInBody(range)) return;
    // Preserve a meaningful caret against the focus-loss reset-to-start.
    if (lastRange && isBodyStartCollapsed(range) && !isBodyStartCollapsed(lastRange)) {
      return;
    }
    lastRange = range.cloneRange();
  }

  // selectionchange is the canonical event but doesn't always fire during
  // focus transitions in Gecko; mouseup/keyup/focusout cover the gaps.
  document.addEventListener("selectionchange", snapshotSelection);
  document.addEventListener("mouseup", snapshotSelection, true);
  document.addEventListener("keyup", snapshotSelection, true);
  document.addEventListener("focusout", snapshotSelection, true);

  // Seed lastRange from the editor's pre-positioned caret so that users
  // who open the popup without first clicking/typing in the body still
  // get a usable range. The snapshot guard above protects this seed from
  // being clobbered by a subsequent focus-loss reset.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", snapshotSelection);
  } else {
    snapshotSelection();
  }
  window.addEventListener("load", snapshotSelection);

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
    // Synthesize. No real caret is known (fresh compose, user clicked
    // toolbar without ever focusing the body). Insert at a user-meaningful
    // anchor so the template doesn't end up after the signature. Priority
    // mirrors the smartInsertHtml helper in template-insert.js:
    //   1. Before first .moz-cite-prefix (reply quote header)
    //   2. Before first .moz-signature
    //   3. At end of body
    const anchor = document.body.querySelector(".moz-cite-prefix, .moz-signature");
    const r = document.createRange();
    if (anchor) {
      r.setStartBefore(anchor);
    } else {
      r.selectNodeContents(document.body);
      r.collapse(false);
    }
    r.collapse(true);
    try { console.log(TAG, "getInsertRange synthesized", { hasAnchor: !!anchor }); } catch (_) {}
    return r;
  }

  function insertHtmlAtRange(range, html) {
    const frag = range.createContextualFragment(html || "");
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

    // Plaintext compose uses Gecko's designMode editor (not a <textarea>),
    // but the editor silently coerces/drops Range-API-inserted <br> nodes
    // on the setComposeDetails round-trip. execCommand("insertText") is
    // the documented, cooperating path: nsEditor honors it deterministically
    // and leaves the caret in the correct post-insertion position, so we
    // skip moveCaretAfter() for this branch. We deliberately do NOT call
    // document.body.focus() here — focus() on a designMode body collapses
    // the Selection to (body, 0), undoing the snapshot we just restored
    // above. execCommand operates on the document's current Selection
    // regardless of focus state.
    if (message.isPlainText) {
      try {
        const ok = document.execCommand("insertText", false, message.text || "");
        if (ok) {
          try { console.log(TAG, "insert ok (execCommand insertText)"); } catch (_) {}
          return { ok: true };
        }
        try { console.warn(TAG, "execCommand insertText returned false"); } catch (_) {}
        return { ok: false, error: "execCommand-failed" };
      } catch (err) {
        try { console.error(TAG, "execCommand insertText threw", err); } catch (_) {}
        return { ok: false, error: "execCommand-failed" };
      }
    }

    try {
      const lastNode = insertHtmlAtRange(range, message.html);
      moveCaretAfter(lastNode);
      try { console.log(TAG, "insert ok"); } catch (_) {}
      return { ok: true };
    } catch (err) {
      try { console.error(TAG, "insert threw", err); } catch (_) {}
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  const api = typeof messenger !== "undefined" ? messenger : browser;
  const onMessageListener = (message) => {
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
  };
  api.runtime.onMessage.addListener(onMessageListener);
  window.__templateWingCompose = { listener: onMessageListener, api };
})();
