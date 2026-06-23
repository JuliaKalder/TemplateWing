import {
  getTemplates,
  getTemplate,
  saveTemplate,
  deleteTemplate,
  getCategories,
  generateId,
  getIdentities,
  consumePrefillTemplate,
  exportTemplates,
  importTemplates,
  getDefaults,
  setDefault,
  setPinned,
  PREFILL_KEY,
  SETTINGS_KEY,
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
import { filterTemplateList, setFilterOptions } from "../modules/ui-helpers.js";
import { lintTemplate, aggregateSeverity, SEVERITY } from "../modules/template-lint.js";
import {
  buildUsageRows,
  filterUnusedSince,
  sortRows,
  topNByUsage,
  toCSV,
  csvFilename,
} from "../modules/usage-stats.js";

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
  document.getElementById("view-usage").hidden = name !== "usage";
  for (const btn of document.querySelectorAll(".tab-btn")) {
    const target = btn.dataset.tab;
    const isActive =
      (target === "usage" && name === "usage") ||
      (target === "list" && (name === "list" || name === "editor"));
    btn.classList.toggle("active", isActive);
  }
}

// ---- Usage dashboard ----

let usageSortKey = "usageCount";
let usageSortDir = "desc";

function renderUsageChart(rows) {
  const container = document.getElementById("usage-chart");
  container.replaceChildren();
  const top = topNByUsage(rows, 10).filter((r) => r.usageCount > 0);
  if (top.length === 0) return;
  const max = top[0].usageCount;
  const W = 600;
  const ROW_H = 22;
  const LABEL_W = 160;
  const PAD = 8;
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${top.length * ROW_H + PAD * 2}`);
  svg.setAttribute("class", "usage-chart-svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", messenger.i18n.getMessage("usageChartLabel"));
  for (let i = 0; i < top.length; i++) {
    const row = top[i];
    const y = PAD + i * ROW_H;
    const barW = ((W - LABEL_W - PAD) * row.usageCount) / max;

    const label = document.createElementNS(svgNS, "text");
    label.setAttribute("x", PAD);
    label.setAttribute("y", y + ROW_H / 2 + 4);
    label.setAttribute("class", "usage-chart-label");
    label.textContent = row.name.length > 22 ? row.name.slice(0, 22) + "…" : row.name;
    svg.appendChild(label);

    const bar = document.createElementNS(svgNS, "rect");
    bar.setAttribute("x", LABEL_W);
    bar.setAttribute("y", y + 3);
    bar.setAttribute("width", String(Math.max(2, barW)));
    bar.setAttribute("height", String(ROW_H - 8));
    bar.setAttribute("class", "usage-chart-bar");
    bar.setAttribute("rx", "2");
    svg.appendChild(bar);

    const count = document.createElementNS(svgNS, "text");
    count.setAttribute("x", LABEL_W + Math.max(2, barW) + 4);
    count.setAttribute("y", y + ROW_H / 2 + 4);
    count.setAttribute("class", "usage-chart-count");
    count.textContent = String(row.usageCount);
    svg.appendChild(count);
  }
  container.appendChild(svg);
}

function formatDate(iso) {
  if (!iso) return messenger.i18n.getMessage("optionsUsageNever");
  return new Date(iso).toLocaleDateString();
}

function renderUsageTable(rows) {
  const tbody = document.querySelector("#usage-table tbody");
  tbody.replaceChildren();
  const emptyEl = document.getElementById("usage-empty");
  if (rows.length === 0) {
    emptyEl.hidden = false;
    document.getElementById("usage-table-wrapper").hidden = true;
    return;
  }
  emptyEl.hidden = true;
  document.getElementById("usage-table-wrapper").hidden = false;
  for (const row of rows) {
    const tr = document.createElement("tr");
    function td(value) {
      const cell = document.createElement("td");
      cell.textContent = value;
      return cell;
    }
    tr.appendChild(td(row.name));
    tr.appendChild(td(row.category));
    tr.appendChild(td(row.identities.length === 0 ? "—" : String(row.identities.length)));
    tr.appendChild(td(row.usageCount));
    tr.appendChild(td(formatDate(row.lastUsedAt)));
    tr.appendChild(td(row.avgPerWeek > 0 ? row.avgPerWeek.toFixed(2) : "0"));
    tbody.appendChild(tr);
  }
  // Header active-sort indicator.
  for (const th of document.querySelectorAll("#usage-table th[data-sort-key]")) {
    th.classList.toggle("sort-active", th.dataset.sortKey === usageSortKey);
    th.classList.toggle(
      "sort-desc",
      th.dataset.sortKey === usageSortKey && usageSortDir === "desc"
    );
  }
}

async function renderUsageView() {
  const templates = await getTemplates();
  const filter = document.getElementById("usage-filter").value;
  const filterMode = filter === "all" || filter === "never" ? filter : Number(filter);
  const rows = filterUnusedSince(buildUsageRows(templates), filterMode);
  const sorted = sortRows(rows, usageSortKey, usageSortDir);
  renderUsageChart(rows);
  renderUsageTable(sorted);
}

async function handleExportUsage() {
  const templates = await getTemplates();
  const rows = buildUsageRows(templates);
  const headers = [
    "name",
    "category",
    "identities",
    "usageCount",
    "lastUsedAt",
    "daysSinceLast",
    "avgPerWeek",
  ];
  const data = rows.map((r) => [
    r.name,
    r.category,
    r.identities.join("|"),
    r.usageCount,
    r.lastUsedAt || "",
    r.daysSinceLast == null ? "" : r.daysSinceLast,
    r.avgPerWeek.toFixed(4),
  ]);
  const csv = toCSV(headers, data);
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = csvFilename();
  a.click();
  URL.revokeObjectURL(url);
}

function makeLintBadge(issues) {
  const sev = aggregateSeverity(issues);
  if (!sev) return null;
  const badge = document.createElement("span");
  badge.className = `lint-badge lint-${sev}`;
  badge.textContent = sev === SEVERITY.error ? "!" : "?";
  const label = messenger.i18n.getMessage(
    sev === SEVERITY.error ? "lintBadgeErrors" : "lintBadgeWarnings",
    String(issues.length)
  );
  badge.title = label + "\n— " + issues.map((i) => i.message).join("\n— ");
  badge.setAttribute("aria-label", label);
  badge.tabIndex = 0;
  return badge;
}

async function renderTemplateList() {
  const list = document.getElementById("template-list");
  const emptyState = document.getElementById("empty-state");
  const templates = await getTemplates();

  list.replaceChildren();

  // Aggregate lint summary across all templates so the user has a single
  // "everything fine vs N templates need attention" signal at the top.
  const summaryEl = document.getElementById("lint-summary");
  if (summaryEl) {
    let templatesWithIssues = 0;
    let errors = 0;
    let warnings = 0;
    for (const t of templates) {
      const issues = lintTemplate(t, templates);
      if (issues.length > 0) {
        templatesWithIssues++;
        for (const i of issues) {
          if (i.severity === SEVERITY.error) errors++;
          else warnings++;
        }
      }
    }
    if (templatesWithIssues === 0) {
      summaryEl.textContent = messenger.i18n.getMessage("lintSummaryClean");
      summaryEl.className = "lint-summary lint-clean";
    } else {
      summaryEl.textContent = messenger.i18n.getMessage("lintSummaryDirty", [
        String(templatesWithIssues),
        String(errors),
        String(warnings),
      ]);
      summaryEl.className = "lint-summary lint-dirty";
    }
    summaryEl.hidden = false;
  }

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

    const lintBadge = makeLintBadge(lintTemplate(template, templates));
    if (lintBadge) name.appendChild(lintBadge);

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

    const pinBtn = document.createElement("button");
    pinBtn.className = "pin-btn" + (template.pinned ? " pinned" : "");
    pinBtn.textContent = template.pinned ? "★" : "☆";
    pinBtn.title = messenger.i18n.getMessage(
      template.pinned ? "popupUnpinTemplate" : "popupPinTemplate"
    );
    pinBtn.setAttribute(
      "aria-label",
      messenger.i18n.getMessage(template.pinned ? "popupUnpinTemplate" : "popupPinTemplate")
    );
    pinBtn.addEventListener("click", async () => {
      await setPinned(template.id, !template.pinned);
      await renderTemplateList();
    });
    actions.appendChild(pinBtn);

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
  setFilterOptions("category-filter", await getCategories());
}

async function renderDefaultsSection() {
  const list = document.getElementById("defaults-list");
  list.replaceChildren();

  const [identities, templates, defaults] = await Promise.all([
    getIdentities(),
    getTemplates(),
    getDefaults(),
  ]);

  if (identities.length === 0) {
    const empty = document.createElement("div");
    empty.className = "defaults-empty";
    empty.textContent = messenger.i18n.getMessage("optionsDefaultsNoIdentities");
    list.appendChild(empty);
    return;
  }

  for (const identity of identities) {
    const row = document.createElement("div");
    row.className = "defaults-row";

    const label = document.createElement("label");
    label.className = "defaults-label";
    label.textContent = identity.label;
    label.htmlFor = `default-${identity.id}`;

    const select = document.createElement("select");
    select.id = `default-${identity.id}`;
    select.className = "defaults-select";

    const noneOption = document.createElement("option");
    noneOption.value = "";
    noneOption.textContent = messenger.i18n.getMessage("optionsDefaultsNone");
    select.appendChild(noneOption);

    for (const t of templates) {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.name;
      if (defaults[identity.id] === t.id) opt.selected = true;
      select.appendChild(opt);
    }

    select.addEventListener("change", async () => {
      await setDefault(identity.id, select.value || null);
    });

    row.appendChild(label);
    row.appendChild(select);
    list.appendChild(row);
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
  await renderDefaultsSection();
}

async function handleExport() {
  const json = await exportTemplates();
  const blob = new Blob([json], { type: "application/json" });
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

function showImportDialog(analysis, validTemplates, existingTemplates) {
  const dialog = document.getElementById("import-dialog");
  const summaryEl = document.getElementById("import-summary");
  const tbody = document.querySelector("#import-preview-table tbody");

  pendingImportData = { analysis, validTemplates, existingTemplates };

  // Build summary
  summaryEl.replaceChildren();
  const totalLine = document.createElement("div");
  totalLine.className = "summary-line";
  totalLine.textContent = messenger.i18n.getMessage(
    "importDialogTotal",
    String(validTemplates.length + analysis.invalid)
  );
  summaryEl.appendChild(totalLine);
  if (analysis.invalid > 0) {
    const invalidLine = document.createElement("div");
    invalidLine.className = "summary-line summary-warn";
    invalidLine.textContent = messenger.i18n.getMessage(
      "importDialogInvalid",
      String(analysis.invalid)
    );
    summaryEl.appendChild(invalidLine);
  }
  if (analysis.duplicates.size > 0) {
    const dupLine = document.createElement("div");
    dupLine.className = "summary-line summary-warn";
    dupLine.textContent = messenger.i18n.getMessage(
      "importDialogDuplicates",
      String(analysis.duplicates.size)
    );
    summaryEl.appendChild(dupLine);
  }

  // Build per-row preview table.
  tbody.replaceChildren();
  const existingNames = new Set(existingTemplates.map((t) => (t.name || "").toLowerCase()));

  validTemplates.forEach((t, index) => {
    const tr = document.createElement("tr");
    tr.dataset.index = String(index);

    const isDup = existingNames.has((t.name || "").toLowerCase());
    const status = isDup ? "duplicate" : "new";

    const nameCell = document.createElement("td");
    nameCell.className = "import-col-name";
    const nameSpan = document.createElement("strong");
    nameSpan.textContent = t.name;
    nameCell.appendChild(nameSpan);
    if (t.category) {
      const cat = document.createElement("span");
      cat.className = "import-row-cat";
      cat.textContent = t.category;
      nameCell.appendChild(cat);
    }
    // Inline validation hint: invalid recipients / oversize attachment.
    const inlineIssues = describeRowIssues(t);
    if (inlineIssues.length > 0) {
      const warn = document.createElement("div");
      warn.className = "import-row-warn";
      warn.textContent = inlineIssues.join(" · ");
      nameCell.appendChild(warn);
    }
    tr.appendChild(nameCell);

    const statusCell = document.createElement("td");
    const statusBadge = document.createElement("span");
    statusBadge.className = `import-status status-${status}`;
    statusBadge.textContent = messenger.i18n.getMessage(
      isDup ? "importStatusDuplicate" : "importStatusNew"
    );
    statusCell.appendChild(statusBadge);
    tr.appendChild(statusCell);

    const actionCell = document.createElement("td");
    const select = document.createElement("select");
    select.className = "import-action-select";
    select.dataset.rowIndex = String(index);
    const opts = isDup
      ? [
          ["skip", "importActionSkip"],
          ["append", "importActionAddCopy"],
          ["replace", "importActionReplace"],
          ["rename", "importActionRename"],
        ]
      : [
          ["append", "importActionAdd"],
          ["skip", "importActionSkip"],
        ];
    for (const [value, key] of opts) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = messenger.i18n.getMessage(key);
      select.appendChild(opt);
    }
    select.value = isDup ? "skip" : "append";
    actionCell.appendChild(select);

    const renameInput = document.createElement("input");
    renameInput.type = "text";
    renameInput.className = "import-rename-input";
    renameInput.placeholder = messenger.i18n.getMessage("importRenamePlaceholder");
    renameInput.value = t.name + " (imported)";
    renameInput.hidden = true;
    actionCell.appendChild(renameInput);

    select.addEventListener("change", () => {
      renameInput.hidden = select.value !== "rename";
    });
    tr.appendChild(actionCell);

    tbody.appendChild(tr);
  });

  dialog.hidden = false;
}

function describeRowIssues(template) {
  const issues = [];
  const toResult = validateRecipients((template.to || []).join(", "));
  if (!toResult.valid) {
    issues.push(
      messenger.i18n.getMessage("validationInvalidRecipients", toResult.invalid.join(", "))
    );
  }
  const totalSize = (template.attachments || []).reduce((sum, a) => sum + (Number(a.size) || 0), 0);
  if (totalSize >= ATTACHMENT_TOTAL_WARN_SIZE) {
    issues.push(messenger.i18n.getMessage("attachmentTotalWarning", formatFileSize(totalSize)));
  }
  return issues;
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

  // Strip internal tracking fields and sanitize bodies before handing off to the store.
  const sanitized = validTemplates.map((t) => {
    const { id: _, createdAt: _1, updatedAt: _2, usageCount: _3, lastUsedAt: _4, ...rest } = t;
    rest.body = sanitizeTemplateBody(rest.body);
    return rest;
  });

  // Collect per-row decisions from the preview table.
  const perRow = {};
  for (const select of document.querySelectorAll(".import-action-select")) {
    const index = Number(select.dataset.rowIndex);
    const action = select.value;
    if (action === "rename") {
      const renameInput = select.parentElement.querySelector(".import-rename-input");
      perRow[index] = { action, rename: (renameInput.value || "").trim() };
    } else {
      perRow[index] = { action };
    }
  }

  const { added, skipped, replaced } = await importTemplates(sanitized, { perRow });

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
  await renderDefaultsSection();
}

function applyBulkAction(action) {
  for (const select of document.querySelectorAll(".import-action-select")) {
    // Skip rows that don't offer this action (e.g. NEW rows have no "replace").
    if (![...select.options].some((o) => o.value === action)) continue;
    select.value = action;
    select.dispatchEvent(new Event("change"));
  }
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

  showImportDialog(analysis, analysis.valid, existingTemplates);
}

function filterTemplates() {
  filterTemplateList("#template-list .template-card");
}

// Tab navigation
for (const btn of document.querySelectorAll(".tab-btn")) {
  btn.addEventListener("click", async () => {
    const target = btn.dataset.tab;
    if (target === "usage") {
      showView("usage");
      await renderUsageView();
    } else {
      showView("list");
    }
  });
}

document.getElementById("usage-filter").addEventListener("change", renderUsageView);
document.getElementById("btn-export-usage").addEventListener("click", handleExportUsage);

for (const th of document.querySelectorAll("#usage-table th[data-sort-key]")) {
  th.addEventListener("click", () => {
    const key = th.dataset.sortKey;
    if (usageSortKey === key) {
      usageSortDir = usageSortDir === "asc" ? "desc" : "asc";
    } else {
      usageSortKey = key;
      usageSortDir = key === "name" || key === "category" ? "asc" : "desc";
    }
    renderUsageView();
  });
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

for (const btn of document.querySelectorAll(".btn-bulk")) {
  btn.addEventListener("click", () => applyBulkAction(btn.dataset.bulk));
}

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
await renderDefaultsSection();

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
    await renderDefaultsSection();
  }
  if (changes[SETTINGS_KEY] && !document.getElementById("view-list").hidden) {
    await renderDefaultsSection();
  }
});

// Check for pre-fill data from "Save as Template" context menu
await checkForPrefillTemplate();
