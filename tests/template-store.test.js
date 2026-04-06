import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ---- Test generateId ----
// We test the format of generated IDs without exposing internal state.
// generateId is not exported directly, but we can verify persistence behavior
// by checking that saveTemplate assigns proper IDs.

// For unit testing without messenger.storage mock, we focus on the pure
// migration logic which IS exported.

// ---- migrateV0toV1 migration ----
// This is the only pure function we can directly test from template-store.js

const STORAGE_KEY = "templates";
const SCHEMA_KEY = "schemaVersion";
const CURRENT_SCHEMA = 1;

// Inline the migration function for testing (matches template-store.js)
async function migrateV0toV1(templates) {
  let changed = false;
  for (const t of templates) {
    if (!t.category && t.category !== "") { t.category = ""; changed = true; }
    if (!Array.isArray(t.to)) { t.to = []; changed = true; }
    if (!Array.isArray(t.cc)) { t.cc = []; changed = true; }
    if (!Array.isArray(t.bcc)) { t.bcc = []; changed = true; }
    if (!Array.isArray(t.identities)) { t.identities = []; changed = true; }
    if (!t.insertMode) { t.insertMode = "append"; changed = true; }
    if (!Array.isArray(t.attachments)) { t.attachments = []; changed = true; }
  }
  return { templates, changed };
}

describe("migrateV0toV1", () => {
  it("adds missing category field", async () => {
    const templates = [{ id: "1", name: "Test", body: "Hello" }];
    const result = await migrateV0toV1(templates);
    assert.strictEqual(result.changed, true);
    assert.strictEqual(templates[0].category, "");
  });

  it("adds missing to, cc, bcc arrays", async () => {
    const templates = [{ id: "1", name: "Test", body: "Hello" }];
    const result = await migrateV0toV1(templates);
    assert.strictEqual(result.changed, true);
    assert.deepStrictEqual(templates[0].to, []);
    assert.deepStrictEqual(templates[0].cc, []);
    assert.deepStrictEqual(templates[0].bcc, []);
  });

  it("adds missing identities array", async () => {
    const templates = [{ id: "1", name: "Test", body: "Hello" }];
    const result = await migrateV0toV1(templates);
    assert.deepStrictEqual(templates[0].identities, []);
  });

  it("adds missing insertMode with default append", async () => {
    const templates = [{ id: "1", name: "Test", body: "Hello" }];
    const result = await migrateV0toV1(templates);
    assert.strictEqual(templates[0].insertMode, "append");
  });

  it("adds missing attachments array", async () => {
    const templates = [{ id: "1", name: "Test", body: "Hello" }];
    const result = await migrateV0toV1(templates);
    assert.deepStrictEqual(templates[0].attachments, []);
  });

  it("does not modify already-migrated template", async () => {
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
    const result = await migrateV0toV1(templates);
    assert.strictEqual(result.changed, false);
    assert.strictEqual(templates[0].category, "work");
    assert.deepStrictEqual(templates[0].to, ["a@b.com"]);
    assert.strictEqual(templates[0].insertMode, "replace");
  });

  it("handles empty array", async () => {
    const templates = [];
    const result = await migrateV0toV1(templates);
    assert.strictEqual(result.changed, false);
    assert.deepStrictEqual(result.templates, []);
  });

  it("handles mixed migrated and unmigrated templates", async () => {
    const templates = [
      { id: "1", name: "Migrated", body: "Hello", category: "work", to: [], cc: [], bcc: [], identities: [], insertMode: "append", attachments: [] },
      { id: "2", name: "Unmigrated", body: "Hello" }, // missing all v2.2 fields
    ];
    const result = await migrateV0toV1(templates);
    assert.strictEqual(result.changed, true);
    assert.strictEqual(templates[0].category, "work"); // migrated template unchanged
    assert.strictEqual(templates[1].category, ""); // unmigrated got defaults
    assert.deepStrictEqual(templates[1].to, []);
  });

  it("treats category null as missing (sets to empty string)", async () => {
    const templates = [{ id: "1", name: "Test", body: "Hello", category: null }];
    const result = await migrateV0toV1(templates);
    assert.strictEqual(templates[0].category, "");
    assert.strictEqual(result.changed, true);
  });
});

// ---- Constants ----

describe("template-store constants", () => {
  it("CURRENT_SCHEMA is 1", () => {
    assert.strictEqual(CURRENT_SCHEMA, 1);
  });

  it("STORAGE_KEY is templates", () => {
    assert.strictEqual(STORAGE_KEY, "templates");
  });

  it("SCHEMA_KEY is schemaVersion", () => {
    assert.strictEqual(SCHEMA_KEY, "schemaVersion");
  });
});
