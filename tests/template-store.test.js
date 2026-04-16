import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { installMessengerMock, uninstallMessengerMock } from "./_mock-messenger.js";

installMessengerMock();

const {
  STORAGE_KEY,
  SCHEMA_KEY,
  CURRENT_SCHEMA,
  generateId,
  migrateV0toV1,
  getTemplates,
  getTemplate,
  saveTemplate,
  deleteTemplate,
  getCategories,
  trackUsage,
  _resetCacheForTests,
} = await import("../modules/template-store.js");

after(() => uninstallMessengerMock());

// ---- migrateV0toV1 (imported from the module, not inlined) ----

describe("migrateV0toV1", () => {
  it("adds missing category field as empty string", async () => {
    const templates = [{ id: "1", name: "Test", body: "Hello" }];
    const { changed } = await migrateV0toV1(templates);
    assert.strictEqual(changed, true);
    assert.strictEqual(templates[0].category, "");
  });

  it("adds missing to/cc/bcc arrays", async () => {
    const templates = [{ id: "1", name: "Test", body: "Hello" }];
    await migrateV0toV1(templates);
    assert.deepStrictEqual(templates[0].to, []);
    assert.deepStrictEqual(templates[0].cc, []);
    assert.deepStrictEqual(templates[0].bcc, []);
  });

  it("adds missing identities array", async () => {
    const templates = [{ id: "1", name: "Test", body: "Hello" }];
    await migrateV0toV1(templates);
    assert.deepStrictEqual(templates[0].identities, []);
  });

  it("defaults insertMode to append", async () => {
    const templates = [{ id: "1", name: "Test", body: "Hello" }];
    await migrateV0toV1(templates);
    assert.strictEqual(templates[0].insertMode, "append");
  });

  it("adds missing attachments array", async () => {
    const templates = [{ id: "1", name: "Test", body: "Hello" }];
    await migrateV0toV1(templates);
    assert.deepStrictEqual(templates[0].attachments, []);
  });

  it("leaves an already-migrated template alone", async () => {
    const templates = [{
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
    }];
    const { changed } = await migrateV0toV1(templates);
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
    const templates = [
      { id: "1", name: "Migrated", body: "", category: "work", to: [], cc: [], bcc: [], identities: [], insertMode: "append", attachments: [] },
      { id: "2", name: "Unmigrated", body: "" },
    ];
    const { changed } = await migrateV0toV1(templates);
    assert.strictEqual(changed, true);
    assert.strictEqual(templates[0].category, "work");
    assert.strictEqual(templates[1].category, "");
    assert.deepStrictEqual(templates[1].to, []);
  });

  it("treats category null as missing", async () => {
    const templates = [{ id: "1", name: "Test", body: "", category: null }];
    await migrateV0toV1(templates);
    assert.strictEqual(templates[0].category, "");
  });
});

// ---- Constants (real module exports, not inline copies) ----

describe("template-store constants", () => {
  it("exports CURRENT_SCHEMA = 1", () => {
    assert.strictEqual(CURRENT_SCHEMA, 1);
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

    const stamped = await messenger.storage.local.get({ [SCHEMA_KEY]: 0 });
    assert.strictEqual(stamped[SCHEMA_KEY], CURRENT_SCHEMA);
  });
});
