import { REQUEST_STORAGE_PREFIX } from "../modules/prompt-collector.js";

function localize() {
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const key = el.getAttribute("data-i18n");
    el.textContent = messenger.i18n.getMessage(key);
  }
}

const params = new URLSearchParams(location.search);
const requestId = params.get("id") || "";
let answered = false;

async function loadRequest() {
  const storageKey = REQUEST_STORAGE_PREFIX + requestId;
  const result = await messenger.storage.local.get({ [storageKey]: null });
  const req = result[storageKey];
  if (!req || !Array.isArray(req.tokens)) {
    // Nothing to ask — close immediately and report cancel so caller resolves.
    sendCancelAndClose();
    return;
  }

  const form = document.getElementById("prompt-form");
  form.replaceChildren();

  for (const tok of req.tokens) {
    const field = document.createElement("div");
    field.className = "prompt-field";

    const label = document.createElement("label");
    label.textContent = tok.label || messenger.i18n.getMessage("promptDialogTitle");
    label.htmlFor = `field-${tok.literal}`;
    field.appendChild(label);

    let input;
    if (tok.kind === "choice" && Array.isArray(tok.options) && tok.options.length > 0) {
      input = document.createElement("select");
      for (const opt of tok.options) {
        const option = document.createElement("option");
        option.value = opt;
        option.textContent = opt;
        if (opt === tok.default) option.selected = true;
        input.appendChild(option);
      }
    } else {
      input = document.createElement("input");
      input.type = "text";
      input.value = tok.default || "";
    }
    input.id = `field-${tok.literal}`;
    input.dataset.literal = tok.literal;
    field.appendChild(input);
    form.appendChild(field);
  }

  const first = form.querySelector("input, select");
  if (first) first.focus();
  if (first && first.tagName === "INPUT") first.select();
}

function collectAnswers() {
  const answers = {};
  for (const el of document.querySelectorAll("#prompt-form [data-literal]")) {
    answers[el.dataset.literal] = el.value;
  }
  return answers;
}

function sendResultAndClose() {
  answered = true;
  messenger.runtime.sendMessage({
    action: "templatewing:promptResult",
    requestId,
    answers: collectAnswers(),
  });
  window.close();
}

function sendCancelAndClose() {
  answered = true;
  messenger.runtime.sendMessage({
    action: "templatewing:promptCancel",
    requestId,
  });
  window.close();
}

document.getElementById("btn-submit").addEventListener("click", (e) => {
  e.preventDefault();
  sendResultAndClose();
});
document.getElementById("btn-cancel").addEventListener("click", (e) => {
  e.preventDefault();
  sendCancelAndClose();
});
document.getElementById("prompt-form").addEventListener("submit", (e) => {
  e.preventDefault();
  sendResultAndClose();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") sendCancelAndClose();
  if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") {
    e.preventDefault();
    sendResultAndClose();
  }
});
// Failsafe: if the user closes the window via title-bar X, the
// onRemoved listener on the caller side handles it, but ensure we don't
// double-send. answered guards against late beforeunload firing after submit.
window.addEventListener("beforeunload", () => {
  if (!answered) {
    messenger.runtime.sendMessage({
      action: "templatewing:promptCancel",
      requestId,
    });
  }
});

localize();
await loadRequest();
