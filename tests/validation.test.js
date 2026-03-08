import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isValidRecipient,
  validateRecipients,
  formatFileSize,
  analyseImport,
  ATTACHMENT_WARN_SIZE,
  ATTACHMENT_TOTAL_WARN_SIZE,
} from "../modules/validation.js";

// ---- isValidRecipient ----

describe("isValidRecipient", () => {
  it("accepts a bare email address", () => {
    assert.ok(isValidRecipient("user@example.com"));
  });

  it("accepts display-name format", () => {
    assert.ok(isValidRecipient("Jane Doe <jane@example.com>"));
  });

  it("accepts display-name with extra spaces", () => {
    assert.ok(isValidRecipient("Jane Doe < jane@example.com >"));
  });

  it("rejects empty string", () => {
    assert.ok(!isValidRecipient(""));
  });

  it("rejects null and undefined", () => {
    assert.ok(!isValidRecipient(null));
    assert.ok(!isValidRecipient(undefined));
  });

  it("rejects plain text without @", () => {
    assert.ok(!isValidRecipient("not-an-email"));
  });

  it("rejects email without domain part", () => {
    assert.ok(!isValidRecipient("user@"));
  });

  it("rejects email without TLD", () => {
    assert.ok(!isValidRecipient("user@host"));
  });
});

// ---- validateRecipients ----

describe("validateRecipients", () => {
  it("returns valid for empty input", () => {
    const result = validateRecipients("");
    assert.ok(result.valid);
    assert.deepStrictEqual(result.invalid, []);
  });

  it("returns valid for null input", () => {
    const result = validateRecipients(null);
    assert.ok(result.valid);
  });

  it("validates a single good address", () => {
    const result = validateRecipients("a@b.com");
    assert.ok(result.valid);
  });

  it("validates multiple good addresses", () => {
    const result = validateRecipients("a@b.com, Jane <c@d.org>");
    assert.ok(result.valid);
    assert.deepStrictEqual(result.invalid, []);
  });

  it("reports invalid addresses", () => {
    const result = validateRecipients("good@example.com, bad-addr, another-bad");
    assert.ok(!result.valid);
    assert.deepStrictEqual(result.invalid, ["bad-addr", "another-bad"]);
  });

  it("ignores trailing commas", () => {
    const result = validateRecipients("a@b.com, ");
    assert.ok(result.valid);
  });
});

// ---- formatFileSize ----

describe("formatFileSize", () => {
  it("formats bytes", () => {
    assert.strictEqual(formatFileSize(500), "500 B");
  });

  it("formats kilobytes", () => {
    assert.strictEqual(formatFileSize(2048), "2.0 KB");
  });

  it("formats megabytes", () => {
    assert.strictEqual(formatFileSize(5 * 1024 * 1024), "5.0 MB");
  });

  it("formats fractional megabytes", () => {
    assert.strictEqual(formatFileSize(1.5 * 1024 * 1024), "1.5 MB");
  });
});

// ---- analyseImport ----

describe("analyseImport", () => {
  const existing = [
    { id: "1", name: "Welcome" },
    { id: "2", name: "Follow-up" },
  ];

  it("identifies all templates as valid when no duplicates", () => {
    const imported = [{ name: "New Template" }];
    const result = analyseImport(imported, existing);
    assert.strictEqual(result.valid.length, 1);
    assert.strictEqual(result.invalid, 0);
    assert.strictEqual(result.duplicates.size, 0);
  });

  it("detects duplicates case-insensitively", () => {
    const imported = [{ name: "welcome" }];
    const result = analyseImport(imported, existing);
    assert.strictEqual(result.valid.length, 1);
    assert.strictEqual(result.duplicates.size, 1);
  });

  it("detects duplicates inside the same import payload", () => {
    const imported = [{ name: "Welcome" }, { name: "welcome" }, { name: "Fresh" }];
    const result = analyseImport(imported, []);
    assert.strictEqual(result.valid.length, 3);
    assert.strictEqual(result.duplicates.size, 1);
    assert.ok(result.duplicates.has("welcome"));
  });

  it("counts invalid entries (missing name)", () => {
    const imported = [{ name: "" }, { notAName: true }, { name: "Valid" }];
    const result = analyseImport(imported, existing);
    assert.strictEqual(result.valid.length, 1);
    assert.strictEqual(result.invalid, 2);
  });

  it("handles null entries", () => {
    const imported = [null, { name: "Good" }];
    const result = analyseImport(imported, existing);
    assert.strictEqual(result.valid.length, 1);
    assert.strictEqual(result.invalid, 1);
  });

  it("handles empty import array", () => {
    const result = analyseImport([], existing);
    assert.strictEqual(result.valid.length, 0);
    assert.strictEqual(result.invalid, 0);
    assert.strictEqual(result.duplicates.size, 0);
  });
});

// ---- Constants ----

describe("constants", () => {
  it("ATTACHMENT_WARN_SIZE is 5 MB", () => {
    assert.strictEqual(ATTACHMENT_WARN_SIZE, 5 * 1024 * 1024);
  });

  it("ATTACHMENT_TOTAL_WARN_SIZE is 10 MB", () => {
    assert.strictEqual(ATTACHMENT_TOTAL_WARN_SIZE, 10 * 1024 * 1024);
  });
});
