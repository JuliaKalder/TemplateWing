import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  migrateV0toV1,
  runMigrations,
  CURRENT_SCHEMA,
  SCHEMA_KEY,
} from "../modules/schema-migrations.js";

// ---- migrateV0toV1 ----

describe("migrateV0toV1", () => {
  it("returns templates unchanged when all v2.2 fields present", async () => {
    const templates = [
      {
        id: "1",
        name: "Test",
        category: "work",
        to: ["a@b.com"],
        cc: [],
        bcc: [],
        identities: [],
        insertMode: "append",
        attachments: [],
      },
    ];
    const result = await migrateV0toV1([...templates]);
    assert.strictEqual(result.changed, false);
    assert.deepStrictEqual(result.templates[0], templates[0]);
  });

  it("adds missing category field with empty string", async () => {
    const templates = [{ id: "1", name: "Test" }];
    const result = await migrateV0toV1([...templates]);
    assert.strictEqual(result.changed, true);
    assert.strictEqual(result.templates[0].category, "");
  });

  it("adds missing to, cc, bcc arrays", async () => {
    const templates = [{ id: "1", name: "Test" }];
    const result = await migrateV0toV1([...templates]);
    assert.strictEqual(result.changed, true);
    assert.deepStrictEqual(result.templates[0].to, []);
    assert.deepStrictEqual(result.templates[0].cc, []);
    assert.deepStrictEqual(result.templates[0].bcc, []);
  });

  it("adds missing identities array", async () => {
    const templates = [{ id: "1", name: "Test" }];
    const result = await migrateV0toV1([...templates]);
    assert.strictEqual(result.changed, true);
    assert.deepStrictEqual(result.templates[0].identities, []);
  });

  it("adds missing insertMode with default append", async () => {
    const templates = [{ id: "1", name: "Test" }];
    const result = await migrateV0toV1([...templates]);
    assert.strictEqual(result.changed, true);
    assert.strictEqual(result.templates[0].insertMode, "append");
  });

  it("adds missing attachments array", async () => {
    const templates = [{ id: "1", name: "Test" }];
    const result = await migrateV0toV1([...templates]);
    assert.strictEqual(result.changed, true);
    assert.deepStrictEqual(result.templates[0].attachments, []);
  });

  it("preserves existing category value", async () => {
    const templates = [{ id: "1", name: "Test", category: "work" }];
    const result = await migrateV0toV1([...templates]);
    // changed is true because other fields (to, cc, etc.) are still missing
    assert.strictEqual(result.changed, true);
    // category should be preserved, not overwritten
    assert.strictEqual(result.templates[0].category, "work");
  });

  it("converts string to array for to/cc/bcc fields", async () => {
    const templates = [{ id: "1", name: "Test", to: "not-an-array" }];
    const result = await migrateV0toV1([...templates]);
    assert.strictEqual(result.changed, true);
    assert.deepStrictEqual(result.templates[0].to, []);
  });

  it("converts string to array for attachments field", async () => {
    const templates = [{ id: "1", name: "Test", attachments: "not-an-array" }];
    const result = await migrateV0toV1([...templates]);
    assert.strictEqual(result.changed, true);
    assert.deepStrictEqual(result.templates[0].attachments, []);
  });

  it("processes multiple templates in array", async () => {
    const templates = [
      { id: "1", name: "Complete", category: "x", to: [], cc: [], bcc: [], identities: [], insertMode: "append", attachments: [] },
      { id: "2", name: "Incomplete" },
    ];
    const result = await migrateV0toV1([...templates]);
    assert.strictEqual(result.changed, true);
    // First template unchanged
    assert.strictEqual(result.templates[0].category, "x");
    // Second template migrated
    assert.strictEqual(result.templates[1].category, "");
  });
});

// ---- runMigrations ----

describe("runMigrations", () => {
  it("returns unchanged when version is current", async () => {
    const templates = [{ id: "1", name: "Test" }];
    const result = await runMigrations(templates, CURRENT_SCHEMA);
    assert.strictEqual(result.finalVersion, CURRENT_SCHEMA);
    assert.strictEqual(result.anyChanged, false);
  });

  it("migrates v0 templates to current schema", async () => {
    const templates = [{ id: "1", name: "Test" }];
    const result = await runMigrations(templates, 0);
    assert.strictEqual(result.finalVersion, CURRENT_SCHEMA);
    assert.strictEqual(result.anyChanged, true);
    // All v2.2 fields should be present
    assert.strictEqual(result.templates[0].category, "");
    assert.deepStrictEqual(result.templates[0].to, []);
    assert.deepStrictEqual(result.templates[0].cc, []);
    assert.deepStrictEqual(result.templates[0].bcc, []);
    assert.deepStrictEqual(result.templates[0].identities, []);
    assert.strictEqual(result.templates[0].insertMode, "append");
    assert.deepStrictEqual(result.templates[0].attachments, []);
  });

  it("no-op when already at current version", async () => {
    const templates = [{ id: "1", name: "Test", category: "work" }];
    const result = await runMigrations(templates, CURRENT_SCHEMA);
    assert.strictEqual(result.finalVersion, CURRENT_SCHEMA);
    assert.strictEqual(result.anyChanged, false);
  });
});

// ---- Constants ----

describe("schema constants", () => {
  it("CURRENT_SCHEMA is 1", () => {
    assert.strictEqual(CURRENT_SCHEMA, 1);
  });

  it("SCHEMA_KEY is schemaVersion", () => {
    assert.strictEqual(SCHEMA_KEY, "schemaVersion");
  });
});
