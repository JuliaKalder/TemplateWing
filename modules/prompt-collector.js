/**
 * Background-side helper to ask the user for {PROMPT}/{CHOICE} values
 * before inserting a template.
 *
 * Opens a popup window (prompt-dialog/dialog.html) that reads the request
 * from storage, renders one input per token, and reports back via
 * runtime.sendMessage. We track window closure as cancellation so a user
 * who hits the OS close button still aborts cleanly.
 */

import { generateId } from "./template-store.js";

const REQUEST_STORAGE_PREFIX = "_templatewing_prompt_";

function makeRequestId() {
  return generateId();
}

/**
 * @param {Array} tokens - From extractPromptTokens().
 * @param {object} [opts]
 * @param {boolean} [opts.askRecipient] - Also ask who the message is going to.
 *   Used when the template greets the recipient but the window has none yet
 *   (see needsRecipientPrompt) — the answer cannot be recovered afterwards,
 *   so it has to be collected before the text is written.
 * @returns {Promise<{answers: Object<string,string>, recipient: string}>} - Token
 *   answers keyed by literal token text, plus the recipient (empty when not
 *   asked, or when the user left it blank to keep the fallback wording).
 * @throws {Error} - With code "PROMPT_CANCELLED" if the user dismisses the dialog.
 */
export async function collectPromptAnswers(tokens, opts = {}) {
  const askRecipient = !!opts.askRecipient;
  const list = tokens || [];
  if (list.length === 0 && !askRecipient) return { answers: {}, recipient: "" };

  const requestId = makeRequestId();
  const storageKey = REQUEST_STORAGE_PREFIX + requestId;

  await messenger.storage.local.set({
    [storageKey]: { tokens: list, askRecipient },
  });

  // Roughly size the popup window to fit the tokens — one row per token
  // plus header and action buttons. Cap at 600px so very long lists scroll
  // rather than ballooning across the screen.
  const height = Math.min(600, 160 + (list.length + (askRecipient ? 1 : 0)) * 80);
  const win = await messenger.windows.create({
    url: messenger.runtime.getURL(`prompt-dialog/dialog.html?id=${encodeURIComponent(requestId)}`),
    type: "popup",
    width: 480,
    height,
  });

  return await new Promise((resolve, reject) => {
    let settled = false;
    function cleanup() {
      messenger.runtime.onMessage.removeListener(onMessage);
      messenger.windows.onRemoved.removeListener(onWindowRemoved);
      messenger.storage.local.remove(storageKey).catch(() => {});
    }
    function onMessage(message) {
      if (!message || message.requestId !== requestId) return;
      if (message.action === "templatewing:promptResult") {
        settled = true;
        cleanup();
        resolve({
          answers: message.answers || {},
          recipient: typeof message.recipient === "string" ? message.recipient : "",
        });
      } else if (message.action === "templatewing:promptCancel") {
        settled = true;
        cleanup();
        const err = new Error("Prompt cancelled");
        err.code = "PROMPT_CANCELLED";
        reject(err);
      }
    }
    function onWindowRemoved(winId) {
      if (winId !== win.id || settled) return;
      cleanup();
      const err = new Error("Prompt cancelled");
      err.code = "PROMPT_CANCELLED";
      reject(err);
    }
    messenger.runtime.onMessage.addListener(onMessage);
    messenger.windows.onRemoved.addListener(onWindowRemoved);
  });
}

export { REQUEST_STORAGE_PREFIX };
