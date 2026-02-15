import {
  getTemplates,
  getTemplate,
  saveTemplate,
  deleteTemplate,
} from "../modules/template-store.js";

let editingId = null;

function localize() {
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const key = el.getAttribute("data-i18n");
    el.textContent = messenger.i18n.getMessage(key);
  }
}

async function renderTemplateList() {
  const list = document.getElementById("template-list");
  const emptyState = document.getElementById("empty-state");
  const templates = await getTemplates();

  list.innerHTML = "";

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

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);

    card.appendChild(info);
    card.appendChild(actions);
    list.appendChild(card);
  }
}

function openEditor(id) {
  editingId = id || null;
  const overlay = document.getElementById("editor-overlay");
  const title = document.getElementById("editor-title");
  const nameInput = document.getElementById("editor-name");
  const subjectInput = document.getElementById("editor-subject");
  const bodyInput = document.getElementById("editor-body");

  if (id) {
    title.textContent = messenger.i18n.getMessage("optionsEditTemplate");
    getTemplate(id).then((template) => {
      if (template) {
        nameInput.value = template.name;
        subjectInput.value = template.subject || "";
        bodyInput.value = template.body || "";
      }
    });
  } else {
    title.textContent = messenger.i18n.getMessage("optionsNewTemplate");
    nameInput.value = "";
    subjectInput.value = "";
    bodyInput.value = "";
  }

  overlay.hidden = false;
  nameInput.focus();
}

function closeEditor() {
  document.getElementById("editor-overlay").hidden = true;
  editingId = null;
}

async function handleSave() {
  const name = document.getElementById("editor-name").value.trim();
  const subject = document.getElementById("editor-subject").value.trim();
  const body = document.getElementById("editor-body").value;

  if (!name) {
    document.getElementById("editor-name").focus();
    return;
  }

  const template = {
    id: editingId || undefined,
    name,
    subject,
    body,
  };

  await saveTemplate(template);
  closeEditor();
  renderTemplateList();
}

document.getElementById("btn-add").addEventListener("click", () => openEditor());
document.getElementById("btn-save").addEventListener("click", handleSave);
document.getElementById("btn-cancel").addEventListener("click", closeEditor);

document.getElementById("editor-overlay").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeEditor();
});

localize();
renderTemplateList();
