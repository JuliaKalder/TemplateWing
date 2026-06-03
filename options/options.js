import {
  getTemplates,
  getTemplate,
  saveTemplate,
  deleteTemplate,
  getCategories,
  generateId,
  getIdentities,
  consumePrefillTemplate,
  importTemplates,
  PREFILL_KEY,
  EXPORT_FORMAT_VERSION,
  INSERT_MODES,
} from "../modules/template-store.js";
import {
  validateRecipients,
  formatFileSize,
  analyseImport,
  ATTACHMENT_WARN_SIZE,
  ATTACHMENT_TOTAL_WARN_SIZE,
  parseRecipients,
} from "../modules/validation.js";

let editingId = null;
let pendingAttachments = [];
let bodyEmptyAcknowledged = false;
let htmlViewActive = false;

function populateEditorFields(template) {
  const nameInput = document.getElementById("editor-name");
  const categoryInput = document.getElementById("editor-category");
  const identitiesSelect = document.getElementById("editor-identities");
  const subjectInput = document.getElementById("editor-subject");
  const toInput = document.getElementById("editor-to");
  const ccInput = document.getElementById("editor-cc");
  const bccInput = document.getElementById("editor-bcc");
  const insertModeSelect = document.getElementById("editor-insert-mode");
  const bodyEditor = document.getElementById("editor-body");

  nameInput.value = template ? template.name || "" : "";
  categoryInput.value = template ? template.category || "" : "";
  subjectInput.value = template ? template.subject || "" : "";
  toInput.value = template ? (template.to || []).join(", ") : "";
  ccInput.value = template ? (template.cc || []).join(", ") : "";
  bccInput.value = template ? (template.bcc || []).join(", ") : "";
  insertModeSelect.value = template
    ? template.insertMode || INSERT_MODES.APPEND
    : INSERT_MODES.APPEND;
  bodyEditor.replaceChildren();
  if (template && template.body) {
    const safeBody = sanitizeTemplateBody(template.body);
    const parsed = new DOMParser().parseFromString(safeBody, "text/html");
    bodyEditor.append(
      ...Array.from(parsed.body.childNodes).map((n) => document.importNode(n, true))
    );
  }
  pendingAttachments = template ? (template.attachments || []).map((a) => ({ ...a })) : [];
  const selectedIdentities = template ? template.identities || [] : [];
  for (const option of identitiesSelect.options) {
    option.selected = selectedIdentities.includes(option.value);
  }
}

function localize() {
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const key = el.getAttribute("data-i18n");
    el.textContent = messenger.i18n.getMessage(key);
  }
  for (const el of document.querySelectorAll("[data-i18n-placeholder]")) {
    const key = el.getAttribute("data-i18n-placeholder");
    el.placeholder = messenger.i18n.getMessage(key);
  }
  for (const el of document.querySelectorAll("[data-i18n-title]")) {
    const key = el.getAttribute("data-i18n-title");
    el.title = messenger.i18n.getMessage(key);
  }
}

function showView(name) {
  document.getElementById("view-list").hidden = name !== "list";
  document.getElementById("view-editor").hidden = name !== "editor";
}

async function renderTemplateList() {
  const list = document.getElementById("template-list");
  const emptyState = document.getElementById("empty-state");
  const templates = await getTemplates();

  list.replaceChildren();

  if (templates.length === 0) {
    list.hidden = true;
    emptyState.hidden = false;
    return;
  }

  list.hidden = false;
  emptyState.hidden = true;

  for (const template of templates) {
    const card = document.createElement("div");
    card.className = "template-card";
    card.dataset.name = (template.name || "").toLowerCase();
    card.dataset.subject = (template.subject || "").toLowerCase();
    card.dataset.category = (template.category || "").toLowerCase();

    const info = document.createElement("div");
    info.className = "info";

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = template.name;

    if (template.category) {
      const categoryBadge = document.createElement("span");
      categoryBadge.className = "category-badge";
      categoryBadge.textContent = template.category;
      name.appendChild(categoryBadge);
    }

    const subject = document.createElement("div");
    subject.className = "subject";
    subject.textContent = template.subject || "";

    const usage = document.createElement("div");
    usage.className = "usage";
    usage.textContent = template.usageCount
      ? messenger.i18n.getMessage("optionsUsageCount", String(template.usageCount))
      : messenger.i18n.getMessage("optionsUsageNever");

    info.appendChild(name);
    info.appendChild(subject);
    info.appendChild(usage);

    const actions = document.createElement("div");
    actions.className = "actions";

    const editBtn = document.createElement("button");
    editBtn.textContent = messenger.i18n.getMessage("optionsEdit");
    editBtn.addEventListener("click", () => openEditor(template.id));

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn-delete";
    deleteBtn.textContent = messenger.i18n.getMessage("optionsDelete");
    deleteBtn.addEventListener("click", async () => {
      const msg = messenger.i18n.getMessage("optionsConfirmDelete", template.name);
      if (confirm(msg)) {
        await deleteTemplate(template.id);
        await renderTemplateList();
        await populateCategoryFilter();
      }
    });

    const dupBtn = document.createElement("button");
    dupBtn.textContent = messenger.i18n.getMessage("optionsDuplicate");
    dupBtn.addEventListener("click", () => duplicateTemplate(template.id));

    actions.appendChild(editBtn);
    actions.appendChild(dupBtn);
    actions.appendChild(deleteBtn);

    card.appendChild(info);
    card.appendChild(actions);
    list.appendChild(card);
  }
}

async function populateCategoryFilter() {
  const filter = document.getElementById("category-filter");
  const categories = await getCategories();
  const options = filter.querySelectorAll("option:not(:first-child)");
  options.forEach((opt) => opt.remove());
  for (const cat of categories) {
    const option = document.createElement("option");
    option.value = cat;
    option.textContent = cat;
    filter.appendChild(option);
  }
}

async function populateCategorySuggestions() {
  const datalist = document.getElementById("category-suggestions");
  const categories = await getCategories();
  datalist.replaceChildren();
  for (const cat of categories) {
    const option = document.createElement("option");
    option.value = cat;
    datalist.appendChild(option);
  }
}

const generateAttId = generateId;

async function loadIdentities() {
  const select = document.getElementById("editor-identities");
  select.replaceChildren();

  try {
    const identities = await getIdentities();
    for (const { id, label, email } of identities) {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = label;
      option.title = email;
      select.appendChild(option);
    }
  } catch (err) {
    console.warn("TemplateWing: could not load identities", err);
  }
}

async function loadNestedTemplateOptions(excludeId = null) {
  const select = document.getElementById("nested-template-select");
  select.replaceChildren();

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = messenger.i18n.getMessage("optionsSelectNestedTemplate");
  select.appendChild(defaultOption);

  const templates = await getTemplates();
  for (const t of templates) {
    if (t.id === excludeId) continue;
    const option = document.createElement("option");
    option.value = t.name;
    option.textContent = t.name;
    select.appendChild(option);
  }
}

function insertTextAtEditorCursor(text) {
  const editor = document.getElementById("editor-body");
  editor.focus();
  const sel = document.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    range.collapse(false);
  } else {
    editor.append(document.createTextNode(text));
  }
}

function insertNestedTemplate() {
  const select = document.getElementById("nested-template-select");
  const templateName = select.value;
  if (!templateName) return;
  insertTextAtEditorCursor(`{{template:${templateName}}}`);
  select.value = "";
}

function getTotalAttachmentSize() {
  return pendingAttachments.reduce((sum, a) => sum + (a.size || 0), 0);
}

function renderAttachments() {
  const list = document.getElementById("attachment-list");
  list.replaceChildren();

  for (const att of pendingAttachments) {
    const item = document.createElement("div");
    item.className = "attachment-item";

    const name = document.createElement("span");
    name.className = "att-name";
    name.textContent = att.name;

    const size = document.createElement("span");
    size.className = "att-size";
    size.textContent = formatFileSize(att.size);

    item.appendChild(name);
    item.appendChild(size);

    if (att.size >= ATTACHMENT_WARN_SIZE) {
      const warn = document.createElement("span");
      warn.className = "att-warn";
      warn.textContent = messenger.i18n.getMessage("attachmentSizeWarning");
      item.appendChild(warn);
    }

    const removeBtn = document.createElement("button");
    removeBtn.className = "att-remove";
    removeBtn.textContent = messenger.i18n.getMessage("optionsRemoveAttachment");
    removeBtn.addEventListener("click", () => {
      pendingAttachments = pendingAttachments.filter((a) => a.id !== att.id);
      renderAttachments();
    });

    item.appendChild(removeBtn);
    list.appendChild(item);
  }

  // Total size warning
  const existingWarn = document.querySelector(".attachment-total-warning");
  if (existingWarn) existingWarn.remove();

  const totalSize = getTotalAttachmentSize();
  if (totalSize >= ATTACHMENT_TOTAL_WARN_SIZE) {
    const warn = document.createElement("div");
    warn.className = "attachment-total-warning";
    warn.textContent = messenger.i18n.getMessage(
      "attachmentTotalWarning",
      formatFileSize(totalSize)
    );
    list.parentElement.appendChild(warn);
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result || "";
      const commaIdx = result.indexOf(",");
      if (commaIdx === -1) {
        reject(new Error("Malformed data URL"));
        return;
      }
      resolve(result.slice(commaIdx + 1));
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function addFiles(files) {
  for (const file of files) {
    try {
      const data = await readFileAsBase64(file);
      pendingAttachments = [
        ...pendingAttachments,
        {
          id: generateAttId(),
          name: file.name,
          type: file.type || "application/octet-stream",
          size: file.size,
          data,
        },
      ];
    } catch (err) {
      console.error("TemplateWing: could not read file", file.name, err);
      showEditorError(messenger.i18n.getMessage("attachmentReadError", file.name));
    }
  }
  renderAttachments();
}

async function openEditor(id, prefill = null) {
  editingId = id || null;
  pendingAttachments = [];
  bodyEmptyAcknowledged = false;
  resetHtmlView();
  const title = document.getElementById("editor-title");
  const nameInput = document.getElementById("editor-name");
  const categoryInput = document.getElementById("editor-category");
  const subjectInput = document.getElementById("editor-subject");
  const toInput = document.getElementById("editor-to");
  const ccInput = document.getElementById("editor-cc");
  const bccInput = document.getElementById("editor-bcc");
  const insertModeSelect = document.getElementById("editor-insert-mode");
  const bodyEditor = document.getElementById("editor-body");

  clearEditorErrors();

  await loadIdentities();
  await loadNestedTemplateOptions(id || null);

  if (id) {
    title.textContent = messenger.i18n.getMessage("optionsEditTemplate");
    const template = await getTemplate(id);
    if (template) {
      populateEditorFields(template);
    }
  } else {
    title.textContent = messenger.i18n.getMessage("optionsNewTemplate");
    nameInput.value = prefill ? prefill.name || "" : "";
    categoryInput.value = "";
    subjectInput.value = prefill ? prefill.subject || "" : "";
    toInput.value = "";
    ccInput.value = "";
    bccInput.value = "";
    insertModeSelect.value = INSERT_MODES.APPEND;
    bodyEditor.replaceChildren();
    if (prefill && prefill.body) {
      const safeBody = sanitizeTemplateBody(prefill.body);
      const parsed = new DOMParser().parseFromString(safeBody, "text/html");
      bodyEditor.append(
        ...Array.from(parsed.body.childNodes).map((n) => document.importNode(n, true))
      );
    }
  }

  await populateCategorySuggestions();
  renderAttachments();
  showView("editor");
  nameInput.focus();
}

function closeEditor() {
  editingId = null;
  pendingAttachments = [];
  bodyEmptyAcknowledged = false;
  resetHtmlView();
  document.getElementById("search-input").value = "";
  showView("list");
}

async function duplicateTemplate(id) {
  const template = await getTemplate(id);
  if (!template) return;

  editingId = null;
  bodyEmptyAcknowledged = false;
  resetHtmlView();
  clearEditorErrors();

  await loadIdentities();
  await loadNestedTemplateOptions(null);

  document.getElementById("editor-title").textContent =
    messenger.i18n.getMessage("optionsNewTemplate");
  populateEditorFields(template);
  const nameInput = document.getElementById("editor-name");
  nameInput.value = messenger.i18n.getMessage("optionsDuplicateName", template.name);

  await populateCategorySuggestions();
  renderAttachments();
  showView("editor");
  nameInput.focus();
  nameInput.select();
}

function showEditorError(message) {
  const errorEl = document.getElementById("editor-error");
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function showInlineError(fieldId, message) {
  const errorEl = document.getElementById(`${fieldId}-error`);
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }
}

function clearEditorErrors() {
  const errorEl = document.getElementById("editor-error");
  errorEl.hidden = true;
  errorEl.textContent = "";
  for (const el of document.querySelectorAll(".field-error")) {
    el.classList.remove("field-error");
  }
  // Clear inline errors
  for (const el of document.querySelectorAll(".inline-error")) {
    el.hidden = true;
    el.textContent = "";
  }
  // Clear body warning
  const bodyWarning = document.getElementById("editor-body-warning");
  if (bodyWarning) {
    bodyWarning.hidden = true;
    bodyWarning.textContent = "";
  }
}

function switchToHtmlView() {
  const bodyEditor = document.getElementById("editor-body");
  const htmlTextarea = document.getElementById("editor-body-html");
  const toggleBtn = document.getElementById("btn-html-toggle");
  const toolbar = document.querySelector(".editor-toolbar");

  htmlTextarea.value = bodyEditor.innerHTML;
  bodyEditor.hidden = true;
  htmlTextarea.hidden = false;
  htmlViewActive = true;
  toggleBtn.classList.add("active");

  // Disable formatting toolbar buttons while in HTML view
  for (const btn of toolbar.querySelectorAll(".toolbar-btn:not(#btn-html-toggle)")) {
    btn.disabled = true;
  }
  toolbar.querySelector(".toolbar-select")?.setAttribute("disabled", "");
  toolbar.querySelector("#paste-plain-toggle")?.setAttribute("disabled", "");
}

function switchToVisualView() {
  const bodyEditor = document.getElementById("editor-body");
  const htmlTextarea = document.getElementById("editor-body-html");
  const toggleBtn = document.getElementById("btn-html-toggle");
  const toolbar = document.querySelector(".editor-toolbar");

  const safeHtml = sanitizeTemplateBody(htmlTextarea.value);
  const parsed = new DOMParser().parseFromString(safeHtml, "text/html");
  bodyEditor.replaceChildren(
    ...Array.from(parsed.body.childNodes).map((n) => document.importNode(n, true))
  );
  htmlTextarea.hidden = true;
  bodyEditor.hidden = false;
  htmlViewActive = false;
  toggleBtn.classList.remove("active");

  // Re-enable formatting toolbar buttons
  for (const btn of toolbar.querySelectorAll(".toolbar-btn:not(#btn-html-toggle)")) {
    btn.disabled = false;
  }
  toolbar.querySelector(".toolbar-select")?.removeAttribute("disabled");
  toolbar.querySelector("#paste-plain-toggle")?.removeAttribute("disabled");
}

function resetHtmlView() {
  if (htmlViewActive) {
    switchToVisualView();
  }
  htmlViewActive = false;
  document.getElementById("editor-body").hidden = false;
  document.getElementById("editor-body-html").hidden = true;
  document.getElementById("btn-html-toggle").classList.remove("active");
}

async function handleSave() {
  const nameInput = document.getElementById("editor-name");
  const name = nameInput.value.trim();
  const category = document.getElementById("editor-category").value.trim();
  const subject = document.getElementById("editor-subject").value.trim();
  const toInput = document.getElementById("editor-to");
  const ccInput = document.getElementById("editor-cc");
  const bccInput = document.getElementById("editor-bcc");
  const body = htmlViewActive
    ? document.getElementById("editor-body-html").value
    : document.getElementById("editor-body").innerHTML;

  clearEditorErrors();

  // Validate name
  if (!name) {
    nameInput.classList.add("field-error");
    showInlineError("editor-name", messenger.i18n.getMessage("validationNameRequired"));
    nameInput.focus();
    return;
  }

  // Validate recipients
  const toResult = validateRecipients(toInput.value);
  const ccResult = validateRecipients(ccInput.value);
  const bccResult = validateRecipients(bccInput.value);

  const allInvalid = [...toResult.invalid, ...ccResult.invalid, ...bccResult.invalid];
  if (allInvalid.length > 0) {
    if (toResult.invalid.length) {
      toInput.classList.add("field-error");
      showInlineError(
        "editor-to",
        messenger.i18n.getMessage("validationInvalidRecipients", toResult.invalid.join(", "))
      );
    }
    if (ccResult.invalid.length) {
      ccInput.classList.add("field-error");
      showInlineError(
        "editor-cc",
        messenger.i18n.getMessage("validationInvalidRecipients", ccResult.invalid.join(", "))
      );
    }
    if (bccResult.invalid.length) {
      bccInput.classList.add("field-error");
      showInlineError(
        "editor-bcc",
        messenger.i18n.getMessage("validationInvalidRecipients", bccResult.invalid.join(", "))
      );
    }
    return;
  }

  const to = parseRecipients(toInput.value);
  const cc = parseRecipients(ccInput.value);
  const bcc = parseRecipients(bccInput.value);

  const insertMode = document.getElementById("editor-insert-mode").value;

  // Block save on empty body in replace mode, unless user has already confirmed.
  if (insertMode === INSERT_MODES.REPLACE) {
    const rawBody = htmlViewActive
      ? document.getElementById("editor-body-html").value
      : document.getElementById("editor-body").innerHTML;
    const bodyText = new DOMParser().parseFromString(rawBody, "text/html").body.innerText.trim();
    if (!bodyText && !bodyEmptyAcknowledged) {
      const bodyWarning = document.getElementById("editor-body-warning");
      bodyWarning.textContent = messenger.i18n.getMessage("validationBodyEmptyReplace");
      bodyWarning.hidden = false;
      bodyEmptyAcknowledged = true;
      return;
    }
  }

  const identitiesSelect = document.getElementById("editor-identities");
  const identities = Array.from(identitiesSelect.selectedOptions).map((opt) => opt.value);

  const template = {
    id: editingId,
    name,
    category,
    subject,
    to,
    cc,
    bcc,
    body,
    insertMode,
    attachments: pendingAttachments,
    identities,
  };

  try {
    await saveTemplate(template);
  } catch (err) {
    if (err.code === "DUPLICATE_NAME") {
      nameInput.classList.add("field-error");
      showInlineError("editor-name", messenger.i18n.getMessage("validationDuplicateName"));
      nameInput.focus();
      return;
    }
    console.error("TemplateWing: save failed", err);
    showEditorError(messenger.i18n.getMessage("optionsSaveError"));
    return;
  }
  closeEditor();
  await renderTemplateList();
  await populateCategoryFilter();
}

async function handleExport() {
  const templates = await getTemplates();
  const safeTemplates = templates.map(
    ({ id, usageCount, lastUsedAt, createdAt, updatedAt, ...t }) => ({
      ...t,
      attachments: (t.attachments || []).map(({ data: _data, ...rest }) => rest),
    })
  );
  const payload = {
    version: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    templates: safeTemplates,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "templatewing-templates.json";
  a.click();
  URL.revokeObjectURL(url);
}

function showImportFeedback(message, isError) {
  const el = document.getElementById("import-feedback");
  el.textContent = message;
  el.className = "import-feedback" + (isError ? " error" : "");
  el.hidden = false;
  const FEEDBACK_DISMISS_MS = 6000;
  setTimeout(() => {
    el.hidden = true;
  }, FEEDBACK_DISMISS_MS);
}

function showImportError(message) {
  showImportFeedback(message, true);
}

function showImportSuccess(message) {
  showImportFeedback(message, false);
}

// ---- Import guardrails ----

let pendingImportData = null;

function showImportDialog(analysis, validTemplates) {
  const dialog = document.getElementById("import-dialog");
  const summaryEl = document.getElementById("import-summary");

  pendingImportData = { analysis, validTemplates };

  // Build summary
  summaryEl.replaceChildren();

  const totalLine = document.createElement("div");
  totalLine.className = "summary-line";
  const totalSpan = document.createElement("span");
  totalSpan.textContent = messenger.i18n.getMessage(
    "importDialogTotal",
    String(validTemplates.length + analysis.invalid)
  );
  totalLine.appendChild(totalSpan);
  summaryEl.appendChild(totalLine);

  if (analysis.invalid > 0) {
    const invalidLine = document.createElement("div");
    invalidLine.className = "summary-line summary-warn";
    const invalidSpan = document.createElement("span");
    invalidSpan.textContent = messenger.i18n.getMessage(
      "importDialogInvalid",
      String(analysis.invalid)
    );
    invalidLine.appendChild(invalidSpan);
    summaryEl.appendChild(invalidLine);
  }

  if (analysis.duplicates.size > 0) {
    const dupLine = document.createElement("div");
    dupLine.className = "summary-line summary-warn";
    const dupSpan = document.createElement("span");
    dupSpan.textContent = messenger.i18n.getMessage(
      "importDialogDuplicates",
      String(analysis.duplicates.size)
    );
    dupLine.appendChild(dupSpan);
    summaryEl.appendChild(dupLine);
  }

  // Reset radio to default
  dialog.querySelector('input[value="append"]').checked = true;

  dialog.hidden = false;
}

function hideImportDialog() {
  document.getElementById("import-dialog").hidden = true;
  pendingImportData = null;
}

async function applyPrefillTemplate(prefill) {
  if (!prefill) return;
  hideImportDialog();
  await openEditor(null, prefill);
}

async function checkForPrefillTemplate() {
  const prefill = await consumePrefillTemplate();
  await applyPrefillTemplate(prefill);
}

function sanitizeTemplateBody(html) {
  if (!html) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const el of doc.body.querySelectorAll("*")) {
    for (const attr of [...el.attributes]) {
      if (attr.name.toLowerCase().startsWith("on")) el.removeAttribute(attr.name);
    }
    if (["SCRIPT", "OBJECT", "EMBED", "IFRAME"].includes(el.tagName)) el.remove();
  }
  return doc.body.innerHTML;
}

async function executeImport() {
  if (!pendingImportData) return;

  const { validTemplates } = pendingImportData;
  const checkedRadio = document.querySelector('input[name="import-mode"]:checked');
  const mode = checkedRadio ? checkedRadio.value : INSERT_MODES.APPEND;

  // Strip internal tracking fields and sanitize bodies before handing off to the store.
  const sanitized = validTemplates.map((t) => {
    const { id: _, createdAt: _1, updatedAt: _2, usageCount: _3, lastUsedAt: _4, ...rest } = t;
    rest.body = sanitizeTemplateBody(rest.body);
    return rest;
  });

  const { added, skipped, replaced } = await importTemplates(sanitized, mode);

  hideImportDialog();

  showImportSuccess(
    messenger.i18n.getMessage("importResultSummary", [
      String(added),
      String(skipped),
      String(replaced),
    ])
  );
  await renderTemplateList();
  await populateCategoryFilter();
}

const IMPORT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

async function handleImport(file) {
  if (file.size > IMPORT_MAX_FILE_SIZE) {
    showImportError(messenger.i18n.getMessage("optionsImportError"));
    return;
  }
  let parsed;
  try {
    const text = await file.text();
    parsed = JSON.parse(text);
  } catch {
    showImportError(messenger.i18n.getMessage("optionsImportError"));
    return;
  }

  if (!parsed || !Array.isArray(parsed.templates)) {
    showImportError(messenger.i18n.getMessage("optionsImportError"));
    return;
  }

  const existingTemplates = await getTemplates();
  const analysis = analyseImport(parsed.templates, existingTemplates);

  if (analysis.valid.length === 0) {
    showImportError(messenger.i18n.getMessage("optionsImportError"));
    return;
  }

  showImportDialog(analysis, analysis.valid);
}

function filterTemplates() {
  const query = document.getElementById("search-input").value.toLowerCase().trim();
  const selectedCategory = document.getElementById("category-filter").value.toLowerCase();
  const cards = document.querySelectorAll("#template-list .template-card");
  for (const card of cards) {
    const matchesSearch =
      !query || card.dataset.name.includes(query) || card.dataset.subject.includes(query);
    const matchesCategory = !selectedCategory || card.dataset.category === selectedCategory;
    card.hidden = !(matchesSearch && matchesCategory);
  }
}

document.getElementById("search-input").addEventListener("input", filterTemplates);
document.getElementById("category-filter").addEventListener("change", filterTemplates);
document.getElementById("btn-add").addEventListener("click", () => openEditor());
document.getElementById("btn-save").addEventListener("click", handleSave);
document.getElementById("btn-cancel").addEventListener("click", closeEditor);
document.getElementById("btn-back").addEventListener("click", closeEditor);
document.getElementById("btn-insert-nested").addEventListener("click", insertNestedTemplate);

document.getElementById("btn-export").addEventListener("click", handleExport);

document.getElementById("btn-import").addEventListener("click", () => {
  document.getElementById("import-file-input").click();
});

document.getElementById("import-file-input").addEventListener("change", (e) => {
  if (e.target.files.length > 0) {
    handleImport(e.target.files[0]);
    e.target.value = "";
  }
});

document.getElementById("import-confirm").addEventListener("click", executeImport);
document.getElementById("import-cancel").addEventListener("click", hideImportDialog);

document.getElementById("btn-add-files").addEventListener("click", () => {
  document.getElementById("file-input").click();
});

document.getElementById("file-input").addEventListener("change", (e) => {
  if (e.target.files.length > 0) {
    addFiles(e.target.files);
    e.target.value = "";
  }
});

// HTML source toggle
document.getElementById("btn-html-toggle").addEventListener("click", () => {
  if (htmlViewActive) {
    switchToVisualView();
  } else {
    switchToHtmlView();
  }
});

// Rich text toolbar
for (const btn of document.querySelectorAll(".toolbar-btn[data-cmd]")) {
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    document.execCommand(btn.dataset.cmd, false, null);
    document.getElementById("editor-body").focus();
    updateToolbarState();
  });
}

document.getElementById("format-block").addEventListener("change", (e) => {
  document.execCommand("formatBlock", false, e.target.value);
  document.getElementById("editor-body").focus();
  e.target.value = "p";
});

// ---- Toolbar active-state feedback ----

function updateToolbarState() {
  const cmds = ["bold", "italic", "underline"];
  for (const cmd of cmds) {
    const btn = document.querySelector(`.toolbar-btn[data-cmd="${cmd}"]`);
    if (btn) {
      btn.classList.toggle("active", document.queryCommandState(cmd));
    }
  }
}

document.addEventListener("selectionchange", () => {
  const editor = document.getElementById("editor-body");
  if ((editor && editor.contains(document.activeElement)) || document.activeElement === editor) {
    updateToolbarState();
  }
});

document.getElementById("editor-body").addEventListener("keyup", updateToolbarState);

document.getElementById("editor-body").addEventListener("input", () => {
  const warning = document.getElementById("editor-body-warning");
  if (warning && !warning.hidden) warning.hidden = true;
});

// ---- Paste sanitization mode ----

document.getElementById("editor-body").addEventListener("paste", (e) => {
  const toggle = document.getElementById("paste-plain-toggle");
  if (toggle && toggle.checked) {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  }
});

// ---- Variable picker (click-to-insert) ----

for (const chip of document.querySelectorAll(".variable-chip[data-var]")) {
  chip.addEventListener("click", (e) => {
    e.preventDefault();
    insertTextAtEditorCursor(chip.dataset.var);
  });
}

localize();
hideImportDialog();
await renderTemplateList();
await populateCategoryFilter();

messenger.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;

  if (changes[PREFILL_KEY] && changes[PREFILL_KEY].newValue) {
    await applyPrefillTemplate(changes[PREFILL_KEY].newValue);
    return;
  }

  // Re-render the list when templates change from another surface (background
  // trackUsage, popup insertion, etc.), but only when the list view is visible
  // so we don't clobber in-progress edits.
  if (changes.templates && !document.getElementById("view-list").hidden) {
    await renderTemplateList();
    await populateCategoryFilter();
  }
});

// Check for pre-fill data from "Save as Template" context menu
await checkForPrefillTemplate();
