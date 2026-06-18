# Issue #206 — Deep Analysis: "Saving new templates in v2.5.0 does not work in every case"

**Status:** Investigation complete — root cause identified, no code changes applied.
**Issue:** https://github.com/JuliaKalder/TemplateWing/issues/206
**Reporter:** JuliaKalder
**Affected version:** v2.5.0

## 1. Bug summary

> When I create a second template which should be nested into the first one,
> the content is not stored. Also, the content of first template seems to be
> lost or at least not shown in the settings page.

Reproduction:
1. Activate XPI manually.
2. Create a template with text and placeholders (e.g. `Hello {DATE}`).
3. Create a second template with any content (e.g. `World`).
4. Try to connect both templates via nesting. The content of template 1 is
   gone in the settings screen.

## 2. Root cause (high confidence — reproduced in isolation)

**File:** `modules/template-store.js`
**Function:** `saveTemplate()`
**Lines:** 153–169 (the new-template branch)

`saveTemplate()` builds the new template object with the freshly-generated id
**before** spreading the caller-supplied `template` on top:

```js
const newTemplate = {
  id: generateId(),
  attachments: [],
  insertMode: "append",
  category: "",
  to: [],
  cc: [],
  bcc: [],
  identities: [],
  ...template,           // <-- spreads every own property of `template`
  createdAt: now,
  updatedAt: now,
};
```

`options/options.js:handleSave()` always builds its template literal with an
explicit `id` field that mirrors `editingId` (the module-level "what are we
editing" flag):

```js
let editingId = null;
...
const template = {
  id: editingId,           // <-- `null` for new templates, a UUID string for edits
  name,
  category,
  ...
};
```

For new templates, `editingId === null`, so `template.id === null` is an **own
property** of the literal. The `...template` spread therefore overwrites the
freshly-generated UUID with `null`. The created template is persisted to
`messenger.storage.local` with `id === null`.

The unit tests do not catch this because they call:

```js
await saveTemplate({ name: "Greeting", body: "Hi" });
```

There is no `id` own-property on the input object literal, so `...template`
does not overwrite the generated id. The test passes by accident.

### 2.1 Confirmed reproduction

```text
$ node _test_bug_complete.mjs
Saved T1: id = null , body = Hello {DATE}
Saved T2: id = null , body = World
...
[0] T1: id=null, body="Hello {DATE}"
[1] T2: id=null, body="World"
getTemplate(null) returns: name=T1, body=Hello {DATE}
...
Templates with null/undefined id: 3
```

Two side-effects of `id === null` are observable in the user's scenario:

1. **`openEditor(id)` routes through the new-template branch.** Look at
   `options/options.js:362-385`:

   ```js
   if (id) {                    // <-- false when id === null
     title.textContent = ...;
     const template = await getTemplate(id);
     if (template) populateEditorFields(template);
   } else {
     // new template branch — clears body, sets empty fields, etc.
     ...
   }
   ```

   When the user clicks "Edit" on T1, `openEditor(T1.id)` is called. Because
   `T1.id === null`, the `if (id)` test is false and the editor opens with
   empty fields — the user's "the content of template 1 is gone" observation.
   The user is now editing what looks like a brand-new template, but the
   underlying id is still null.

2. **Duplicate-name rule re-triggers on subsequent edits.** When the user
   later saves this "edit" of T1, `handleSave` reads `editingId === null` and
   builds another template with `id: null` plus the (now mutated) name and
   body containing `{{template:T2}}`. `saveTemplate` runs the duplicate-name
   check against all existing templates, finds none, and pushes yet another
   template with `id === null` onto the array. The list view grows by one
   empty-feeling entry each time, reinforcing the user's "content is not
   stored / not shown" impression.

### 2.2 Why only "in every case"

- The bug only triggers when the caller passes `template` with an `id`
  own-property whose value is `null` (or `undefined`).
- `options/options.js:handleSave()` does this on every "new template" save.
- `options/options.js:executeImport()` happens to avoid it because the
  destructure `const { id: _, ...rest } = t;` strips `id` before calling
  `saveTemplate(rest)`, so the spread has nothing to overwrite.
- `handleSave()` does **not** strip `id`, so every create-from-UI save is
  affected. Editing an existing template is unaffected because
  `editingId` is the real UUID and `...template` spreads a non-null id that
  just happens to equal `generateId()` in spirit (it overwrites the freshly
  generated id with the same id; the spread still happens but is harmless).
  Wait — actually in the edit branch `saveTemplate` does **not** hit this
  code path at all. The new-template branch is the only place where
  `generateId()` is called, and that's the only place where the spread can
  overwrite it.

## 3. Why the existing tests did not catch it

`tests/template-store.test.js` calls `saveTemplate({ name: "X", body: "y" })`
with no `id` field. JavaScript object spread (`...`) only copies **own
enumerable** properties, and `id` is not an own property of the literal, so
the spread leaves the generated id alone. The test passes.

The closest existing test:

```js
it("assigns an id and timestamps on create", async () => {
  const saved = await saveTemplate({ name: "Greeting", body: "Hi" });
  assert.ok(saved.id);   // <-- passes only because id is not on the input
  ...
});
```

does not model the production call shape.

## 4. Affected call sites

- `options/options.js:handleSave()` — primary trigger. Always passes
  `{ id: editingId, ... }`.
- `options/options.js:executeImport()` → `template-store.js:importTemplates()`
  — **safe today** because `executeImport` strips `id` before calling
  `saveTemplate`. But the same fragility will silently break if any future
  caller passes an `id` own-property.

No other call sites in the repo currently trigger the bug.

## 5. Proposed fix (for the implementation agent — not applied yet)

Constraint: one-issue, one-cycle, no drive-by refactors per `AGENTS.md`.

Smallest correct change is in `saveTemplate()`'s new-template branch.
The fix must guarantee the persisted id is the freshly-generated UUID
regardless of whether the input carries an `id` own-property.

Three acceptable shapes (any one is fine; pick the one the implementation
agent prefers for readability):

**Option A — re-assert the generated id after the spread:**

```js
const newId = generateId();
const newTemplate = {
  id: newId,
  attachments: [],
  insertMode: "append",
  category: "",
  to: [],
  cc: [],
  bcc: [],
  identities: [],
  ...template,
  id: newId,            // <-- override any null/undefined from the spread
  createdAt: now,
  updatedAt: now,
};
```

**Option B — strip `id` from the input before spreading:**

```js
const { id: _ignored, ...rest } = template;
const newTemplate = {
  id: generateId(),
  attachments: [],
  insertMode: "append",
  category: "",
  to: [],
  cc: [],
  bcc: [],
  identities: [],
  ...rest,
  createdAt: now,
  updatedAt: now,
};
```

**Option C — replace `...template` with explicit field copies** (verbose but
impossible to mis-spread in the future). Not recommended given the project's
"vanilla JS, no build, small diff" preference.

**Recommended:** Option B. It is the same idiom already used in
`executeImport()` (which is the one caller that gets this right), so the
pattern stays consistent across the codebase. Option A is a one-line change
but invites the same shape of mistake if anyone later reorganises the
constructor.

### 5.1 Defensive follow-ups (optional, judgement call)

These are **not required** to fix the bug, but worth considering:

1. **`handleSave()` should only set `id` when editing.** Mirror the import
   pattern: build the literal without `id` for new templates, with `id` for
   edits. This makes the call shape self-documenting and prevents future
   regressions if `saveTemplate` is ever rewritten without the guard.
2. **`openEditor(id)` should treat `null` id as "not found", not "new".**
   Today, `if (id)` discriminates between edit and new. A clearer check
   would be `if (id !== null) { ... }`, but this is only a readability
   concern — the real fix is in `saveTemplate`.
3. **Add a regression test.** A new test in
   `tests/template-store.test.js` that mimics `handleSave`'s exact call
   shape (`{ id: null, name, body, ... }`) and asserts that `saved.id`
   is a non-empty string. This locks the fix in place.

## 6. Files inspected

- `modules/template-store.js` — `saveTemplate`, `getTemplate`, `getTemplates`,
  cache logic, schema migration, listeners.
- `modules/template-insert.js` — `resolveNestedTemplates`, insert paths. Not
  the bug, but checked because the issue mentions nesting.
- `modules/validation.js` — recipient parsing. Not involved.
- `modules/ui-helpers.js` — list filtering. Not involved.
- `options/options.js` — `handleSave`, `openEditor`, `populateEditorFields`,
  `loadNestedTemplateOptions`, `insertNestedTemplate`, `renderTemplateList`,
  `duplicateTemplate`, `executeImport`, storage listener.
- `options/options.html` — markup for the editor (id references match JS).
- `options/options.css` — no body preview in list view, confirming "content
  of T1 is gone" refers to the editor view becoming empty when re-opened.
- `popup/popup.js`, `popup/popup.html` — compose-action UI; not in scope.
- `background.js`, `background.html` — context menu and command handling; not
  in scope.
- `manifest.json` — confirms options page is `options/options.html` (which
  matches the report's "settings page").
- `tests/_mock-messenger.js`, `tests/template-store.test.js`,
  `tests/template-insert.test.js` — confirms the mock supports the
  reproduction and that no existing test exercises the null-id call shape.

## 7. Git history consulted (relevant window: v2.3.2..HEAD)

- `e28cdac` — refactor: extract `populateEditorFields`. Did not introduce
  the bug; `populateEditorFields` is only called from the edit branch
  and is reached only if `id` is truthy, so it does not mask the root
  cause. (Worth noting because it was the most recent change to
  `options.js`.)
- `1fbaabd` — refactor: enforce duplicate-name uniqueness in
  `saveTemplate`. Did not introduce the bug; the duplicate check is
  upstream of the buggy spread and works correctly for new templates
  that survive the spread.
- `26faa27` — fix: enforce identity restrictions on nested template
  resolution. Not related (concerns `insertTemplateIntoTab`, not save).
- `c38c2bc` — build: include compose-utils, message-utils, ui-helpers in
  XPI. Not related.
- `a17e3a6` — chore: bump version to 2.5.0. The version in which the
  user observed the bug.

The bug is **not** a regression from any single commit. The vulnerable
spread order in `saveTemplate` predates v2.5.0; the user's report only
became possible to observe once v2.5.0 added the nested-template
dropdown / "Insert Template" button, because clicking that button is
the trigger that makes the user re-open an existing template and notice
its content has gone.

## 8. Verification done

1. Read `gh issue view 206` — confirms reproduction steps and v2.5.0 scope.
2. Read every function touched by the reproduction flow
   (`openEditor`, `populateEditorFields`, `loadNestedTemplateOptions`,
   `insertNestedTemplate`, `handleSave`, `saveTemplate`, `getTemplate`,
   `getTemplates`, `renderTemplateList`).
3. Ran `npm test` — 123 tests pass, none cover the
   `saveTemplate({ id: null, ... })` call shape, consistent with the
   theory above.
4. Ran an in-tree Node.js reproduction that calls `saveTemplate` with
   the exact shape `handleSave` uses for new templates; confirmed that
   the persisted `id` is `null` and that subsequent `openEditor(null)`
   routes through the new-template branch.
5. Wrote up this file. No source files were modified.

## 9. Hand-off

The implementation agent should:

1. Apply Option B (or A) in `modules/template-store.js` as described in
   §5.
2. Add a regression test in `tests/template-store.test.js` that calls
   `saveTemplate({ id: null, name: "x", body: "y" })` (and the
   `id: undefined` variant for completeness) and asserts
   `typeof saved.id === "string" && saved.id.length > 0`.
3. Confirm `npm test` passes (123 + the new test) and `npm run lint`
   passes.
4. Run the five review agents per `AGENTS.md`.

The implementation agent must **not** also touch `handleSave` to omit
`id: editingId`. That is a defensive follow-up (§5.1 item 1) and
should be a separate decision made after the core fix lands and the
review agents have weighed in.
