import {
  getTemplates,
  getTemplate,
  saveTemplate,
  deleteTemplate,
} from "../modules/template-store.js";

let editingId = null;
let pendingAttachments = [];

function localize() {
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const key = el.getAttribute("data-i18n");
    el.textContent = messenger.i18n.getMessage(key);
  }
  for (const el of document.querySelectorAll("[data-i18n-placeholder]")) {
    const key = el.getAttribute("data-i18n-placeholder");
    el.placeholder = messenger.i18n.getMessage(key);
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

    const info = document.createElement("div");
    info.className = "info";

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = template.name;

    const subject = document.createElement("div");
    subject.className = "subject";
    subject.textContent = template.subject || "";

    info.appendChild(name);
    info.appendChild(subject);

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
        renderTemplateList();
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

function generateAttId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
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

    const removeBtn = document.createElement("button");
    removeBtn.className = "att-remove";
    removeBtn.textContent = messenger.i18n.getMessage("optionsRemoveAttachment");
    removeBtn.addEventListener("click", () => {
      pendingAttachments = pendingAttachments.filter((a) => a.id !== att.id);
      renderAttachments();
    });

    item.appendChild(name);
    item.appendChild(size);
    item.appendChild(removeBtn);
    list.appendChild(item);
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
    const data = await readFileAsBase64(file);
    pendingAttachments.push({
      id: generateAttId(),
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      data,
    });
  }
  renderAttachments();
}

async function openEditor(id) {
  editingId = id || null;
  pendingAttachments = [];
  const title = document.getElementById("editor-title");
  const nameInput = document.getElementById("editor-name");
  const subjectInput = document.getElementById("editor-subject");
  const insertModeSelect = document.getElementById("editor-insert-mode");
  const bodyEditor = document.getElementById("editor-body");

  if (id) {
    title.textContent = messenger.i18n.getMessage("optionsEditTemplate");
    const template = await getTemplate(id);
    if (template) {
      nameInput.value = template.name;
      subjectInput.value = template.subject || "";
      insertModeSelect.value = template.insertMode || "append";
      bodyEditor.replaceChildren();
      if (template.body) {
        const parsed = new DOMParser().parseFromString(template.body, "text/html");
        bodyEditor.append(...document.adoptNode(parsed.body).childNodes);
      }
      pendingAttachments = (template.attachments || []).map((a) => ({ ...a }));
    }
  } else {
    title.textContent = messenger.i18n.getMessage("optionsNewTemplate");
    nameInput.value = "";
    subjectInput.value = "";
    insertModeSelect.value = "append";
    bodyEditor.replaceChildren();
  }

  renderAttachments();
  showView("editor");
  nameInput.focus();
}

function closeEditor() {
  editingId = null;
  pendingAttachments = [];
  document.getElementById("search-input").value = "";
  showView("list");
}

async function duplicateTemplate(id) {
  const template = await getTemplate(id);
  if (!template) return;

  editingId = null;
  pendingAttachments = (template.attachments || []).map((a) => ({ ...a }));

  const title = document.getElementById("editor-title");
  const nameInput = document.getElementById("editor-name");
  const subjectInput = document.getElementById("editor-subject");
  const insertModeSelect = document.getElementById("editor-insert-mode");
  const bodyEditor = document.getElementById("editor-body");

  title.textContent = messenger.i18n.getMessage("optionsNewTemplate");
  nameInput.value = messenger.i18n.getMessage("optionsDuplicateName", template.name);
  subjectInput.value = template.subject || "";
  insertModeSelect.value = template.insertMode || "append";

  bodyEditor.replaceChildren();
  if (template.body) {
    const parsed = new DOMParser().parseFromString(template.body, "text/html");
    bodyEditor.append(...document.adoptNode(parsed.body).childNodes);
  }

  renderAttachments();
  showView("editor");
  nameInput.focus();
  nameInput.select();
}

async function handleSave() {
  const name = document.getElementById("editor-name").value.trim();
  const subject = document.getElementById("editor-subject").value.trim();
  const body = document.getElementById("editor-body").innerHTML;
  const errorEl = document.getElementById("editor-error");
  errorEl.hidden = true;

  if (!name) {
    document.getElementById("editor-name").focus();
    return;
  }

  const insertMode = document.getElementById("editor-insert-mode").value;

  const template = {
    id: editingId || undefined,
    name,
    subject,
    body,
    insertMode,
    attachments: pendingAttachments,
  };

  try {
    await saveTemplate(template);
  } catch (err) {
    console.error("TemplateWing: save failed", err);
    errorEl.textContent = messenger.i18n.getMessage("optionsSaveError");
    errorEl.hidden = false;
    return;
  }
  closeEditor();
  await renderTemplateList();
}

function filterTemplates() {
  const query = document.getElementById("search-input").value.toLowerCase().trim();
  const cards = document.querySelectorAll("#template-list .template-card");
  for (const card of cards) {
    const matches = !query
      || card.dataset.name.includes(query)
      || card.dataset.subject.includes(query);
    card.hidden = !matches;
  }
}

document.getElementById("search-input").addEventListener("input", filterTemplates);
document.getElementById("btn-add").addEventListener("click", () => openEditor());
document.getElementById("btn-save").addEventListener("click", handleSave);
document.getElementById("btn-cancel").addEventListener("click", closeEditor);
document.getElementById("btn-back").addEventListener("click", closeEditor);

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
  });
}

document.getElementById("format-block").addEventListener("change", (e) => {
  document.execCommand("formatBlock", false, e.target.value);
  document.getElementById("editor-body").focus();
  e.target.value = "p";
});

localize();
renderTemplateList();
