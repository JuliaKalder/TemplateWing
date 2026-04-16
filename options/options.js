import {
  getTemplates,
  getTemplate,
  saveTemplate,
  deleteTemplate,
  getCategories,
} from "../modules/template-store.js";
import {
  validateRecipients,
  formatFileSize,
  analyseImport,
  ATTACHMENT_WARN_SIZE,
  ATTACHMENT_TOTAL_WARN_SIZE,
} from "../modules/validation.js";

let editingId = null;
let pendingAttachments = [];
let bodyEmptyAcknowledged = false;

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
  document.getElementById("view-list").hidden = (name !== "list");
  document.getElementById("view-editor").hidden = (name !== "editor");
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
    card.dataset.name = template.name.toLowerCase();
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
      const msg = messenger.i18n.getMessage(
        "optionsConfirmDelete",
        template.name
      );
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

function generateAttId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

async function loadIdentities() {
  const select = document.getElementById("editor-identities");
  select.replaceChildren();

  try {
    const accounts = await messenger.accounts.list();
    for (const account of accounts) {
      if (account.identities) {
        for (const identity of account.identities) {
          const option = document.createElement("option");
          option.value = identity.id;
          const label = identity.name
            ? `${identity.name} (${identity.email})`
            : identity.email;
          option.textContent = label;
          option.title = identity.email;
          select.appendChild(option);
        }
      }
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

function insertNestedTemplate() {
  const select = document.getElementById("nested-template-select");
  const templateName = select.value;
  if (!templateName) return;

  const editor = document.getElementById("editor-body");
  const includeText = `{{template:${templateName}}}`;
  editor.focus();

  const sel = window.getSelection();
  if (sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(includeText));
    range.collapse(false);
  } else {
    editor.append(document.createTextNode(includeText));
  }

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

    if (att.size >= ATTACHMENT_WARN_SIZE) {
      const warn = document.createElement("span");
      warn.className = "att-warn";
      warn.textContent = messenger.i18n.getMessage("attachmentSizeWarning");
      item.appendChild(name);
      item.appendChild(size);
      item.appendChild(warn);
    } else {
      item.appendChild(name);
      item.appendChild(size);
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
      const base64 = reader.result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function addFiles(files) {
  for (const file of files) {
    try {
      const data = await readFileAsBase64(file);
      pendingAttachments.push({
        id: generateAttId(),
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        data,
      });
    } catch (err) {
      console.error("TemplateWing: could not read file", file.name, err);
      showEditorError(
        messenger.i18n.getMessage("attachmentReadError", file.name)
      );
    }
  }
  renderAttachments();
}

async function openEditor(id, prefill = null) {
  editingId = id || null;
  pendingAttachments = [];
  bodyEmptyAcknowledged = false;
  const title = document.getElementById("editor-title");
  const nameInput = document.getElementById("editor-name");
  const categoryInput = document.getElementById("editor-category");
  const identitiesSelect = document.getElementById("editor-identities");
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
      nameInput.value = template.name;
      categoryInput.value = template.category || "";
      subjectInput.value = template.subject || "";
      toInput.value = (template.to || []).join(", ");
      ccInput.value = (template.cc || []).join(", ");
      bccInput.value = (template.bcc || []).join(", ");
      insertModeSelect.value = template.insertMode || "append";
      bodyEditor.replaceChildren();
      if (template.body) {
        const parsed = new DOMParser().parseFromString(template.body, "text/html");
        bodyEditor.append(...document.adoptNode(parsed.body).childNodes);
      }
      pendingAttachments = (template.attachments || []).map((a) => ({ ...a }));
      const selectedIdentities = template.identities || [];
      for (const option of identitiesSelect.options) {
        option.selected = selectedIdentities.includes(option.value);
      }
    }
  } else {
    title.textContent = messenger.i18n.getMessage("optionsNewTemplate");
    nameInput.value = prefill ? prefill.name || "" : "";
    categoryInput.value = "";
    subjectInput.value = prefill ? prefill.subject || "" : "";
    toInput.value = "";
    ccInput.value = "";
    bccInput.value = "";
    insertModeSelect.value = "append";
    bodyEditor.replaceChildren();
    if (prefill && prefill.body) {
      const parsed = new DOMParser().parseFromString(prefill.body, "text/html");
      bodyEditor.append(...document.adoptNode(parsed.body).childNodes);
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
  document.getElementById("search-input").value = "";
  showView("list");
}

async function duplicateTemplate(id) {
  const template = await getTemplate(id);
  if (!template) return;

  editingId = null;
  pendingAttachments = (template.attachments || []).map((a) => ({ ...a }));
  bodyEmptyAcknowledged = false;

  const title = document.getElementById("editor-title");
  const nameInput = document.getElementById("editor-name");
  const categoryInput = document.getElementById("editor-category");
  const identitiesSelect = document.getElementById("editor-identities");
  const subjectInput = document.getElementById("editor-subject");
  const toInput = document.getElementById("editor-to");
  const ccInput = document.getElementById("editor-cc");
  const bccInput = document.getElementById("editor-bcc");
  const insertModeSelect = document.getElementById("editor-insert-mode");
  const bodyEditor = document.getElementById("editor-body");

  clearEditorErrors();

  await loadIdentities();
  await loadNestedTemplateOptions(null);

  title.textContent = messenger.i18n.getMessage("optionsNewTemplate");
  nameInput.value = messenger.i18n.getMessage("optionsDuplicateName", template.name);
  categoryInput.value = template.category || "";
  subjectInput.value = template.subject || "";
  toInput.value = (template.to || []).join(", ");
  ccInput.value = (template.cc || []).join(", ");
  bccInput.value = (template.bcc || []).join(", ");
  insertModeSelect.value = template.insertMode || "append";

  bodyEditor.replaceChildren();
  if (template.body) {
    const parsed = new DOMParser().parseFromString(template.body, "text/html");
    bodyEditor.append(...document.adoptNode(parsed.body).childNodes);
  }

  const selectedIdentities = template.identities || [];
  for (const option of identitiesSelect.options) {
    option.selected = selectedIdentities.includes(option.value);
  }

  await populateCategorySuggestions();
  renderAttachments();
  showView("editor");
  nameInput.focus();
  nameInput.select();
}

function parseRecipients(value) {
  return value.trim()
    ? value.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
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

async function handleSave() {
  const nameInput = document.getElementById("editor-name");
  const name = nameInput.value.trim();
  const category = document.getElementById("editor-category").value.trim();
  const subject = document.getElementById("editor-subject").value.trim();
  const toInput = document.getElementById("editor-to");
  const ccInput = document.getElementById("editor-cc");
  const bccInput = document.getElementById("editor-bcc");
  const body = document.getElementById("editor-body").innerHTML;

  clearEditorErrors();

  // Validate name
  if (!name) {
    nameInput.classList.add("field-error");
    showInlineError("editor-name", messenger.i18n.getMessage("validationNameRequired"));
    nameInput.focus();
    return;
  }

  // Check for duplicate name
  const allTemplates = await getTemplates();
  const duplicate = allTemplates.find(
    (t) => t.name.toLowerCase() === name.toLowerCase() && t.id !== editingId
  );
  if (duplicate) {
    nameInput.classList.add("field-error");
    showInlineError("editor-name", messenger.i18n.getMessage("validationDuplicateName"));
    nameInput.focus();
    return;
  }

  // Validate recipients
  const toResult = validateRecipients(toInput.value);
  const ccResult = validateRecipients(ccInput.value);
  const bccResult = validateRecipients(bccInput.value);

  const allInvalid = [
    ...toResult.invalid,
    ...ccResult.invalid,
    ...bccResult.invalid,
  ];
  if (allInvalid.length > 0) {
    if (toResult.invalid.length) {
      toInput.classList.add("field-error");
      showInlineError("editor-to", messenger.i18n.getMessage("validationInvalidRecipients", toResult.invalid.join(", ")));
    }
    if (ccResult.invalid.length) {
      ccInput.classList.add("field-error");
      showInlineError("editor-cc", messenger.i18n.getMessage("validationInvalidRecipients", ccResult.invalid.join(", ")));
    }
    if (bccResult.invalid.length) {
      bccInput.classList.add("field-error");
      showInlineError("editor-bcc", messenger.i18n.getMessage("validationInvalidRecipients", bccResult.invalid.join(", ")));
    }
    return;
  }

  const to = parseRecipients(toInput.value);
  const cc = parseRecipients(ccInput.value);
  const bcc = parseRecipients(bccInput.value);

  const insertMode = document.getElementById("editor-insert-mode").value;

  // Block save on empty body in replace mode, unless user has already confirmed.
  if (insertMode === "replace") {
    const bodyText = document.getElementById("editor-body").innerText.trim();
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
    id: editingId || undefined,
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
  const payload = {
    version: "2.2",
    exportedAt: new Date().toISOString(),
    templates,
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
  setTimeout(() => { el.hidden = true; }, 6000);
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
  totalLine.innerHTML = `<span>${messenger.i18n.getMessage("importDialogTotal", String(validTemplates.length + analysis.invalid))}</span>`;
  summaryEl.appendChild(totalLine);

  if (analysis.invalid > 0) {
    const invalidLine = document.createElement("div");
    invalidLine.className = "summary-line summary-warn";
    invalidLine.innerHTML = `<span>${messenger.i18n.getMessage("importDialogInvalid", String(analysis.invalid))}</span>`;
    summaryEl.appendChild(invalidLine);
  }

  if (analysis.duplicates.size > 0) {
    const dupLine = document.createElement("div");
    dupLine.className = "summary-line summary-warn";
    dupLine.innerHTML = `<span>${messenger.i18n.getMessage("importDialogDuplicates", String(analysis.duplicates.size))}</span>`;
    summaryEl.appendChild(dupLine);
  }

  // Reset radio to default
  dialog.querySelector('input[value="append"]').checked = true;

  localize();
  dialog.hidden = false;
}

function hideImportDialog() {
  document.getElementById("import-dialog").hidden = true;
  pendingImportData = null;
}

async function consumePrefillTemplate(prefill) {
  if (!prefill) return;
  hideImportDialog();
  await messenger.storage.local.remove("_prefillTemplate");
  await openEditor(null, prefill);
}

async function checkForPrefillTemplate() {
  const prefillResult = await messenger.storage.local.get({ _prefillTemplate: null });
  await consumePrefillTemplate(prefillResult._prefillTemplate);
}

async function executeImport() {
  if (!pendingImportData) return;

  const { analysis, validTemplates } = pendingImportData;
  const mode = document.querySelector('input[name="import-mode"]:checked').value;
  const existingTemplates = await getTemplates();
  const existingByName = new Map(
    existingTemplates.map((t) => [t.name.toLowerCase(), t])
  );

  let added = 0;
  let skipped = 0;
  let replaced = 0;

  for (const t of validTemplates) {
    const { id, createdAt, updatedAt, usageCount, lastUsedAt, ...rest } = t;
    const nameKey = t.name.trim().toLowerCase();
    const existing = existingByName.get(nameKey);

    if (existing) {
      if (mode === "skip") {
        skipped++;
        continue;
      }
      if (mode === "replace") {
        try {
          const saved = await saveTemplate({ ...rest, id: existing.id });
          existingByName.set(nameKey, saved);
          replaced++;
        } catch (err) {
          console.error("TemplateWing: import replace failed for", t.name, err);
          skipped++;
        }
        continue;
      }
    }

    // mode === "append" or no duplicate
    try {
      const saved = await saveTemplate(rest);
      existingByName.set(nameKey, saved);
      added++;
    } catch (err) {
      console.error("TemplateWing: import failed for template", t.name, err);
      skipped++;
    }
  }

  hideImportDialog();

  showImportFeedback(
    messenger.i18n.getMessage("importResultSummary", [
      String(added),
      String(skipped),
      String(replaced),
    ]),
    false
  );
  await renderTemplateList();
  await populateCategoryFilter();
}

async function handleImport(file) {
  let parsed;
  try {
    const text = await file.text();
    parsed = JSON.parse(text);
  } catch {
    showImportFeedback(messenger.i18n.getMessage("optionsImportError"), true);
    return;
  }

  if (!parsed || !Array.isArray(parsed.templates)) {
    showImportFeedback(messenger.i18n.getMessage("optionsImportError"), true);
    return;
  }

  const existingTemplates = await getTemplates();
  const analysis = analyseImport(parsed.templates, existingTemplates);

  if (analysis.valid.length === 0) {
    showImportFeedback(messenger.i18n.getMessage("optionsImportError"), true);
    return;
  }

  showImportDialog(analysis, analysis.valid);
}

function filterTemplates() {
  const query = document.getElementById("search-input").value.toLowerCase().trim();
  const selectedCategory = document.getElementById("category-filter").value.toLowerCase();
  const cards = document.querySelectorAll("#template-list .template-card");
  for (const card of cards) {
    const matchesSearch = !query
      || card.dataset.name.includes(query)
      || card.dataset.subject.includes(query);
    const matchesCategory = !selectedCategory
      || card.dataset.category === selectedCategory;
    card.style.display = (matchesSearch && matchesCategory) ? "" : "none";
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

// ---- v2.2: Toolbar active-state feedback ----

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
  if (editor && editor.contains(document.activeElement) || document.activeElement === editor) {
    updateToolbarState();
  }
});

document.getElementById("editor-body").addEventListener("keyup", updateToolbarState);

document.getElementById("editor-body").addEventListener("input", () => {
  const warning = document.getElementById("editor-body-warning");
  if (warning && !warning.hidden) warning.hidden = true;
});

// ---- v2.2: Paste sanitization mode ----

document.getElementById("editor-body").addEventListener("paste", (e) => {
  const toggle = document.getElementById("paste-plain-toggle");
  if (toggle && toggle.checked) {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  }
});

// ---- v2.2: Variable picker (click-to-insert) ----

for (const chip of document.querySelectorAll(".variable-chip[data-var]")) {
  chip.addEventListener("click", (e) => {
    e.preventDefault();
    const varText = chip.dataset.var;
    const editor = document.getElementById("editor-body");
    editor.focus();

    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(varText));
      range.collapse(false);
    } else {
      editor.append(document.createTextNode(varText));
    }
  });
}

localize();
hideImportDialog();
await renderTemplateList();
await populateCategoryFilter();

messenger.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local" || !changes._prefillTemplate || !changes._prefillTemplate.newValue) {
    return;
  }
  await consumePrefillTemplate(changes._prefillTemplate.newValue);
});

// Check for pre-fill data from "Save as Template" context menu
await checkForPrefillTemplate();
