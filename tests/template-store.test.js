import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { installMessengerMock, uninstallMessengerMock } from "./_mock-messenger.js";

installMessengerMock();

const {
  STORAGE_KEY,
  SCHEMA_KEY,
  SETTINGS_KEY,
  CURRENT_SCHEMA,
  generateId,
  migrateV0toV1,
  migrateV1toV2,
  getTemplates,
  getTemplate,
  saveTemplate,
  deleteTemplate,
  getCategories,
  trackUsage,
  setPinned,
  getPopupSortedTemplates,
  getDefaults,
  setDefault,
  importTemplates,
  _resetCacheForTests,
} = await import("../modules/template-store.js");

after(() => uninstallMessengerMock());

// ---- migrateV0toV1 (imported from the module, not inlined) ----

describe("migrateV0toV1", () => {
  it("adds missing category field as empty string", async () => {
    const input = [{ id: "1", name: "Test", body: "Hello" }];
    const { templates, changed } = await migrateV0toV1(input);
    assert.strictEqual(changed, true);
    assert.strictEqual(templates[0].category, "");
  });

  it("adds missing to/cc/bcc arrays", async () => {
    const input = [{ id: "1", name: "Test", body: "Hello" }];
    const { templates } = await migrateV0toV1(input);
    assert.deepStrictEqual(templates[0].to, []);
    assert.deepStrictEqual(templates[0].cc, []);
    assert.deepStrictEqual(templates[0].bcc, []);
  });

  it("adds missing identities array", async () => {
    const input = [{ id: "1", name: "Test", body: "Hello" }];
    const { templates } = await migrateV0toV1(input);
    assert.deepStrictEqual(templates[0].identities, []);
  });

  it("defaults insertMode to append", async () => {
    const input = [{ id: "1", name: "Test", body: "Hello" }];
    const { templates } = await migrateV0toV1(input);
    assert.strictEqual(templates[0].insertMode, "append");
  });

  it("adds missing attachments array", async () => {
    const input = [{ id: "1", name: "Test", body: "Hello" }];
    const { templates } = await migrateV0toV1(input);
    assert.deepStrictEqual(templates[0].attachments, []);
  });

  it("leaves an already-migrated template alone", async () => {
    const input = [
      {
        id: "1",
        name: "Test",
        body: "Hello",
        category: "work",
        to: ["a@b.com"],
        cc: [],
        bcc: [],
        identities: [],
        insertMode: "replace",
        attachments: [{ name: "file.txt", type: "text/plain", data: "aGVsbG8=" }],
      },
    ];
    const { templates, changed } = await migrateV0toV1(input);
    assert.strictEqual(changed, false);
    assert.strictEqual(templates[0].category, "work");
    assert.strictEqual(templates[0].insertMode, "replace");
  });

  it("returns unchanged for an empty array", async () => {
    const { templates, changed } = await migrateV0toV1([]);
    assert.strictEqual(changed, false);
    assert.deepStrictEqual(templates, []);
  });

  it("handles mixed migrated and unmigrated templates", async () => {
    const input = [
      {
        id: "1",
        name: "Migrated",
        body: "",
        category: "work",
        to: [],
        cc: [],
        bcc: [],
        identities: [],
        insertMode: "append",
        attachments: [],
      },
      { id: "2", name: "Unmigrated", body: "" },
    ];
    const { templates, changed } = await migrateV0toV1(input);
    assert.strictEqual(changed, true);
    assert.strictEqual(templates[0].category, "work");
    assert.strictEqual(templates[1].category, "");
    assert.deepStrictEqual(templates[1].to, []);
  });

  it("treats category null as missing", async () => {
    const input = [{ id: "1", name: "Test", body: "", category: null }];
    const { templates } = await migrateV0toV1(input);
    assert.strictEqual(templates[0].category, "");
  });
});

// ---- Constants (real module exports, not inline copies) ----

describe("template-store constants", () => {
  it("exports CURRENT_SCHEMA = 2", () => {
    assert.strictEqual(CURRENT_SCHEMA, 2);
  });
  it("exports STORAGE_KEY = templates", () => {
    assert.strictEqual(STORAGE_KEY, "templates");
  });
  it("exports SCHEMA_KEY = schemaVersion", () => {
    assert.strictEqual(SCHEMA_KEY, "schemaVersion");
  });
});

// ---- generateId ----

describe("generateId", () => {
  it("produces non-empty strings", () => {
    const id = generateId();
    assert.strictEqual(typeof id, "string");
    assert.ok(id.length > 0);
  });

  it("produces different ids on consecutive calls", () => {
    const ids = new Set();
    for (let i = 0; i < 50; i++) ids.add(generateId());
    assert.strictEqual(ids.size, 50);
  });
});

// ---- Public API against in-memory storage ----

describe("saveTemplate / getTemplate / deleteTemplate", () => {
  beforeEach(() => {
    // Fresh mock store and flushed module cache per test.
    installMessengerMock();
    _resetCacheForTests();
  });

  it("assigns an id and timestamps on create", async () => {
    const saved = await saveTemplate({ name: "Greeting", body: "Hi" });
    assert.ok(saved.id);
    assert.ok(saved.createdAt);
    assert.ok(saved.updatedAt);
  });

  it("assigns a non-empty string id when caller passes id: null (UI save shape)", async () => {
    const saved = await saveTemplate({
      id: null,
      name: "NewShape",
      body: "x",
      category: "",
      to: [],
      cc: [],
      bcc: [],
      identities: [],
      insertMode: "append",
      attachments: [],
    });
    assert.strictEqual(typeof saved.id, "string");
    assert.ok(saved.id.length > 0, `id should be non-empty, got: ${JSON.stringify(saved.id)}`);
  });

  it("assigns a non-empty string id when caller passes id: undefined", async () => {
    const saved = await saveTemplate({
      id: undefined,
      name: "UndefIdShape",
      body: "x",
    });
    assert.strictEqual(typeof saved.id, "string");
    assert.ok(saved.id.length > 0, `id should be non-empty, got: ${JSON.stringify(saved.id)}`);
  });

  it("generates a fresh id for every falsy-id variant in the new-template branch", async () => {
    // Regression: issue #206 — falsy own-property id must not overwrite generated id.
    const falsyIds = [null, undefined, "", 0, false];
    for (const falsyId of falsyIds) {
      const saved = await saveTemplate({
        id: falsyId,
        name: `Falsy_${typeof falsyId}_${String(falsyId)}`,
        body: "x",
      });
      assert.strictEqual(
        typeof saved.id,
        "string",
        `id should be a string for input id=${JSON.stringify(falsyId)}, got ${JSON.stringify(saved.id)}`
      );
      assert.ok(
        saved.id.length > 0,
        `id should be non-empty for input id=${JSON.stringify(falsyId)}, got ${JSON.stringify(saved.id)}`
      );
    }
  });

  it("fills defaults for attachments, insertMode, category, and recipient arrays", async () => {
    const saved = await saveTemplate({ name: "With defaults", body: "" });
    assert.deepStrictEqual(saved.attachments, []);
    assert.strictEqual(saved.insertMode, "append");
    assert.strictEqual(saved.category, "");
    assert.deepStrictEqual(saved.to, []);
    assert.deepStrictEqual(saved.cc, []);
    assert.deepStrictEqual(saved.bcc, []);
    assert.deepStrictEqual(saved.identities, []);
  });

  it("retrieves a saved template by id", async () => {
    const saved = await saveTemplate({ name: "Findme", body: "x" });
    const fetched = await getTemplate(saved.id);
    assert.strictEqual(fetched.name, "Findme");
  });

  it("updates an existing template without losing unspecified fields", async () => {
    const saved = await saveTemplate({ name: "A", body: "first", category: "cat1" });
    await saveTemplate({ id: saved.id, name: "A", body: "second" });
    const fetched = await getTemplate(saved.id);
    assert.strictEqual(fetched.body, "second");
    assert.strictEqual(fetched.category, "cat1", "category should survive partial update");
  });

  it("returns null for getTemplate with unknown id", async () => {
    const fetched = await getTemplate("does-not-exist");
    assert.strictEqual(fetched, null);
  });

  it("deleteTemplate removes a template", async () => {
    const saved = await saveTemplate({ name: "Gone", body: "" });
    await deleteTemplate(saved.id);
    assert.strictEqual(await getTemplate(saved.id), null);
    const all = await getTemplates();
    assert.strictEqual(all.length, 0);
  });

  it("getCategories returns distinct, sorted, non-empty values", async () => {
    await saveTemplate({ name: "a", body: "", category: "Zed" });
    await saveTemplate({ name: "b", body: "", category: "Alpha" });
    await saveTemplate({ name: "c", body: "", category: "Alpha" });
    await saveTemplate({ name: "d", body: "", category: "" });
    const cats = await getCategories();
    assert.deepStrictEqual(cats, ["Alpha", "Zed"]);
  });

  it("trackUsage increments usageCount and sets lastUsedAt", async () => {
    const saved = await saveTemplate({ name: "T", body: "" });
    await trackUsage(saved.id);
    await trackUsage(saved.id);
    const fetched = await getTemplate(saved.id);
    assert.strictEqual(fetched.usageCount, 2);
    assert.ok(fetched.lastUsedAt);
  });

  it("trackUsage on an unknown id is a no-op", async () => {
    await assert.doesNotReject(trackUsage("nope"));
  });

  it("rejects a new template whose name duplicates an existing one (case-insensitive)", async () => {
    await saveTemplate({ name: "Hello World", body: "" });
    await assert.rejects(
      () => saveTemplate({ name: "hello world", body: "different" }),
      (err) => {
        assert.strictEqual(err.code, "DUPLICATE_NAME");
        return true;
      }
    );
  });

  it("rejects updating a template to a name used by a different template", async () => {
    const a = await saveTemplate({ name: "Alpha", body: "" });
    await saveTemplate({ name: "Beta", body: "" });
    await assert.rejects(
      () => saveTemplate({ id: a.id, name: "Beta", body: "updated" }),
      (err) => {
        assert.strictEqual(err.code, "DUPLICATE_NAME");
        return true;
      }
    );
  });

  it("allows updating a template to keep its own name", async () => {
    const saved = await saveTemplate({ name: "Gamma", body: "" });
    await assert.doesNotReject(() =>
      saveTemplate({ id: saved.id, name: "Gamma", body: "updated" })
    );
  });

  it("name uniqueness check is case-insensitive", async () => {
    await saveTemplate({ name: "CaseSensitive", body: "" });
    await assert.rejects(
      () => saveTemplate({ name: "CASESENSITIVE", body: "" }),
      (err) => {
        assert.strictEqual(err.code, "DUPLICATE_NAME");
        return true;
      }
    );
  });
});

// ---- migrateV1toV2 ----

describe("migrateV1toV2", () => {
  it("adds pinned:false to templates missing the field", async () => {
    const input = [{ id: "1", name: "Test" }];
    const { templates, changed } = await migrateV1toV2(input);
    assert.strictEqual(changed, true);
    assert.strictEqual(templates[0].pinned, false);
  });

  it("leaves a template that already has pinned:true alone", async () => {
    const input = [{ id: "1", name: "Test", pinned: true }];
    const { templates, changed } = await migrateV1toV2(input);
    assert.strictEqual(changed, false);
    assert.strictEqual(templates[0].pinned, true);
  });

  it("returns unchanged for an empty array", async () => {
    const { templates, changed } = await migrateV1toV2([]);
    assert.strictEqual(changed, false);
    assert.deepStrictEqual(templates, []);
  });
});

// ---- Pinning ----

describe("setPinned + getPopupSortedTemplates", () => {
  beforeEach(() => {
    installMessengerMock();
    _resetCacheForTests();
  });

  it("setPinned flips the flag on the stored template", async () => {
    const saved = await saveTemplate({ name: "Pinme", body: "" });
    assert.strictEqual(saved.pinned, false);
    await setPinned(saved.id, true);
    const refetched = await getTemplate(saved.id);
    assert.strictEqual(refetched.pinned, true);
  });

  it("setPinned with an unknown id is a no-op", async () => {
    await assert.doesNotReject(setPinned("does-not-exist", true));
  });

  it("getPopupSortedTemplates puts pinned templates first (alpha)", () => {
    const list = [
      { id: "1", name: "Zoo", pinned: false, lastUsedAt: "2026-06-20" },
      { id: "2", name: "Bear", pinned: true },
      { id: "3", name: "Apple", pinned: true },
      { id: "4", name: "Cat", pinned: false, lastUsedAt: "2026-06-21" },
    ];
    const sorted = getPopupSortedTemplates(list);
    assert.deepStrictEqual(
      sorted.map((t) => t.name),
      ["Apple", "Bear", "Cat", "Zoo"]
    );
  });

  it("unpinned slot keeps recency sort (newest first, untouched last)", () => {
    const list = [
      { id: "1", name: "Old", pinned: false, lastUsedAt: "2026-01-01" },
      { id: "2", name: "Never", pinned: false },
      { id: "3", name: "New", pinned: false, lastUsedAt: "2026-06-20" },
    ];
    const sorted = getPopupSortedTemplates(list);
    assert.deepStrictEqual(
      sorted.map((t) => t.name),
      ["New", "Old", "Never"]
    );
  });
});

// ---- Per-identity defaults ----

describe("getDefaults / setDefault", () => {
  beforeEach(() => {
    installMessengerMock();
    _resetCacheForTests();
  });

  it("returns an empty object when no settings exist", async () => {
    assert.deepStrictEqual(await getDefaults(), {});
  });

  it("setDefault writes a mapping that getDefaults reads back", async () => {
    await setDefault("identity-1", "tpl-A");
    assert.deepStrictEqual(await getDefaults(), { "identity-1": "tpl-A" });
  });

  it("setDefault with empty templateId clears that identity's default", async () => {
    await setDefault("identity-1", "tpl-A");
    await setDefault("identity-1", null);
    assert.deepStrictEqual(await getDefaults(), {});
  });

  it("deleting a template clears any default that pointed at it", async () => {
    const saved = await saveTemplate({ name: "DefaultTpl", body: "" });
    await setDefault("identity-1", saved.id);
    await setDefault("identity-2", "other-tpl");
    await deleteTemplate(saved.id);
    const defaults = await getDefaults();
    assert.strictEqual(defaults["identity-1"], undefined);
    assert.strictEqual(defaults["identity-2"], "other-tpl");
  });

  it("setDefault ignores empty identityId", async () => {
    await setDefault("", "tpl-A");
    assert.deepStrictEqual(await getDefaults(), {});
  });
});

// ---- Schema migration runs via the store when version is stale ----

describe("getTemplates triggers migration on stale schema", () => {
  beforeEach(() => {
    installMessengerMock();
    _resetCacheForTests();
  });

  it("promotes v0 templates to v1 and stamps the schema version", async () => {
    // Seed storage with pre-migration data (no schemaVersion key).
    await messenger.storage.local.set({
      [STORAGE_KEY]: [
        { id: "legacy", name: "Legacy", body: "Hi" }, // missing all v1 fields
      ],
    });
    _resetCacheForTests();

    const templates = await getTemplates();
    assert.strictEqual(templates.length, 1);
    assert.strictEqual(templates[0].insertMode, "append");
    assert.deepStrictEqual(templates[0].to, []);
    assert.strictEqual(templates[0].category, "");
    assert.strictEqual(templates[0].pinned, false);

    const stamped = await messenger.storage.local.get({ [SCHEMA_KEY]: 0 });
    assert.strictEqual(stamped[SCHEMA_KEY], CURRENT_SCHEMA);
  });

  it("promotes v1 templates to v2 by stamping pinned:false", async () => {
    await messenger.storage.local.set({
      [SCHEMA_KEY]: 1,
      [STORAGE_KEY]: [
        {
          id: "v1-tpl",
          name: "From v1",
          body: "Hi",
          category: "",
          to: [],
          cc: [],
          bcc: [],
          identities: [],
          insertMode: "append",
          attachments: [],
        },
      ],
    });
    _resetCacheForTests();

    const templates = await getTemplates();
    assert.strictEqual(templates[0].pinned, false);

    const stamped = await messenger.storage.local.get({ [SCHEMA_KEY]: 0 });
    assert.strictEqual(stamped[SCHEMA_KEY], CURRENT_SCHEMA);
  });
});

// Suppress unused-import lint for SETTINGS_KEY (it's re-exported for parity).
void SETTINGS_KEY;

// ---- importTemplates: legacy global mode + per-row decisions ----

describe("importTemplates — legacy global mode (backwards-compat)", () => {
  beforeEach(() => {
    installMessengerMock();
    _resetCacheForTests();
  });

  it("'append' renames the imported copy when a name collides", async () => {
    await saveTemplate({ name: "Hello", body: "old" });
    const result = await importTemplates([{ name: "Hello", body: "new" }], "append");
    assert.strictEqual(result.added, 1);
    assert.strictEqual(result.skipped, 0);
    const all = await getTemplates();
    const names = all.map((t) => t.name).sort();
    assert.deepStrictEqual(names, ["Hello", "Hello (imported)"]);
  });

  it("'skip' leaves the existing template untouched when names collide", async () => {
    await saveTemplate({ name: "Hello", body: "original" });
    const result = await importTemplates([{ name: "Hello", body: "incoming" }], "skip");
    assert.strictEqual(result.skipped, 1);
    const all = await getTemplates();
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0].body, "original");
  });

  it("'replace' overwrites the existing template on name collision", async () => {
    await saveTemplate({ name: "Hello", body: "old" });
    const result = await importTemplates([{ name: "Hello", body: "new" }], "replace");
    assert.strictEqual(result.replaced, 1);
    const [tpl] = await getTemplates();
    assert.strictEqual(tpl.body, "new");
  });
});

describe("importTemplates — per-row decisions", () => {
  beforeEach(() => {
    installMessengerMock();
    _resetCacheForTests();
  });

  it("respects per-row 'skip' / 'replace' choices", async () => {
    await saveTemplate({ name: "A", body: "orig-A" });
    await saveTemplate({ name: "B", body: "orig-B" });
    const result = await importTemplates(
      [
        { name: "A", body: "new-A" },
        { name: "B", body: "new-B" },
      ],
      {
        perRow: {
          0: { action: "skip" },
          1: { action: "replace" },
        },
      }
    );
    assert.strictEqual(result.skipped, 1);
    assert.strictEqual(result.replaced, 1);
    const all = await getTemplates();
    const byName = Object.fromEntries(all.map((t) => [t.name, t.body]));
    assert.strictEqual(byName["A"], "orig-A");
    assert.strictEqual(byName["B"], "new-B");
  });

  it("supports 'rename' action with a per-row new name", async () => {
    await saveTemplate({ name: "Greeting", body: "" });
    const result = await importTemplates([{ name: "Greeting", body: "fresh" }], {
      perRow: {
        0: { action: "rename", rename: "Greeting from import" },
      },
    });
    assert.strictEqual(result.added, 1);
    const all = await getTemplates();
    const names = all.map((t) => t.name).sort();
    assert.deepStrictEqual(names, ["Greeting", "Greeting from import"]);
  });

  it("falls back to default action when no per-row entry", async () => {
    await saveTemplate({ name: "A", body: "orig" });
    const result = await importTemplates(
      [
        { name: "A", body: "new" },
        { name: "C", body: "fresh" },
      ],
      { default: "skip" }
    );
    assert.strictEqual(result.skipped, 1);
    assert.strictEqual(result.added, 1);
  });

  it("dedupeName escalates the counter when 'imported' is already taken", async () => {
    await saveTemplate({ name: "A", body: "x" });
    await saveTemplate({ name: "A (imported)", body: "x" });
    const result = await importTemplates([{ name: "A", body: "new" }], "append");
    assert.strictEqual(result.added, 1);
    const all = await getTemplates();
    assert.ok(all.some((t) => t.name === "A (imported 2)"));
  });

  it("handles a non-collision row with default 'append'", async () => {
    const result = await importTemplates([{ name: "Brand new", body: "x" }], {});
    assert.strictEqual(result.added, 1);
  });
});
