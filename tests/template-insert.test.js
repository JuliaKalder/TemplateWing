import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Test the template inclusion and variable replacement patterns from template-insert.js
// We test the regex patterns and cycle detection logic directly.

// ---- Template include regex ----
// From template-insert.js: /\{\{template(id)?:([^}]+)\}\}/gi
const includeRegex = /\{\{template(id)?:([^}]+)\}\}/gi;

describe("template include regex", () => {
  it("matches {{template:Name}} syntax", () => {
    const text = "Hello {{template:My Template}} how are you?";
    const matches = [...text.matchAll(includeRegex)];
    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0][2], "My Template");
    assert.strictEqual(matches[0][1], undefined); // no id flag
  });

  it("matches {{templateid:abc123}} syntax", () => {
    const text = "Including {{templateid:abc123}} now";
    const matches = [...text.matchAll(includeRegex)];
    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0][2], "abc123");
    assert.strictEqual(matches[0][1], "id"); // has id flag
  });

  it("matches multiple includes in same text", () => {
    const text = "{{template:First}} and {{template:Second}} and {{templateid:id123}}";
    const matches = [...text.matchAll(includeRegex)];
    assert.strictEqual(matches.length, 3);
    assert.strictEqual(matches[0][2], "First");
    assert.strictEqual(matches[1][2], "Second");
    assert.strictEqual(matches[2][2], "id123");
  });

  it("handles whitespace in template name", () => {
    const text = "{{template:  My Template  }}";
    const matches = [...text.matchAll(includeRegex)];
    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0][2], "  My Template  ");
  });

  it("returns empty array when no matches", () => {
    const text = "No template includes here";
    const matches = [...text.matchAll(includeRegex)];
    assert.strictEqual(matches.length, 0);
  });

  it("is case-insensitive for the template keyword", () => {
    const text = "{{TEMPLATE:Name}} and {{TemplateId:id123}}";
    const matches = [...text.matchAll(includeRegex)];
    assert.strictEqual(matches.length, 2);
  });
});

// ---- Variable replacement patterns ----
// From template-insert.js: .replace(/\{DATE\}/gi, ...)
// These patterns are used in replaceVariables

describe("variable replacement patterns", () => {
  const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // Helper to simulate replaceVariables without the async Thunderbird API calls
  function replaceVariablesSync(text, now = new Date()) {
    const weekday = weekdayNames[now.getDay()];
    return text
      .replace(/\{DATE\}/gi, now.toLocaleDateString())
      .replace(/\{TIME\}/gi, now.toLocaleTimeString())
      .replace(/\{DATETIME\}/gi, now.toLocaleDateString() + " " + now.toLocaleTimeString())
      .replace(/\{YEAR\}/gi, String(now.getFullYear()))
      .replace(/\{WEEKDAY\}/gi, weekday)
      .replace(/\{SENDER_NAME\}/gi, "Jane Doe")
      .replace(/\{SENDER_EMAIL\}/gi, "jane@example.com")
      .replace(/\{ACCOUNT_NAME\}/gi, "My Account")
      .replace(/\{ACCOUNT_EMAIL\}/gi, "account@example.com");
  }

  it("replaces {DATE}", () => {
    const now = new Date("2026-04-06T10:00:00");
    const result = replaceVariablesSync("Date: {DATE}", now);
    assert.ok(result.includes("6.4.2026") || result.includes("4/6/2026")); // locale-dependent
  });

  it("replaces {YEAR}", () => {
    const now = new Date("2026-04-06T10:00:00");
    const result = replaceVariablesSync("Year: {YEAR}", now);
    assert.ok(result.includes("2026"));
  });

  it("replaces {WEEKDAY}", () => {
    const now = new Date("2026-04-06T10:00:00"); // Monday
    const result = replaceVariablesSync("Day: {WEEKDAY}", now);
    assert.ok(result.includes("Monday"));
  });

  it("replaces {SENDER_NAME}", () => {
    const result = replaceVariablesSync("From: {SENDER_NAME}");
    assert.ok(result.includes("Jane Doe"));
  });

  it("replaces multiple variables", () => {
    const result = replaceVariablesSync("{DATE} {TIME} from {SENDER_EMAIL}");
    // Should not contain any {VARIABLE} placeholders
    assert.ok(!result.includes("{DATE}"));
    assert.ok(!result.includes("{TIME}"));
    assert.ok(!result.includes("{SENDER_EMAIL}"));
  });

  it("leaves text without variables unchanged", () => {
    const result = replaceVariablesSync("Plain text only");
    assert.strictEqual(result, "Plain text only");
  });

  it("is case-insensitive for variable names", () => {
    const result = replaceVariablesSync("{date} {Date} {DATE}");
    // None of these should remain
    assert.ok(!result.includes("{date}"));
    assert.ok(!result.includes("{Date}"));
    assert.ok(!result.includes("{DATE}"));
  });
});

// ---- Resolve nested templates (cycle detection) ----
// We test the cycle detection logic directly

function createMockResolve(behavior) {
  return async function resolveNestedTemplates(text, visited, templatesById, templatesByName) {
    if (!text) return text;

    const includeRegex = /\{\{template(id)?:([^}]+)\}\}/gi;
    let resolved = text;
    let match;
    const matches = [];
    while ((match = includeRegex.exec(text)) !== null) {
      matches.push(match);
    }

    for (const m of matches) {
      const fullMatch = m[0];
      const useId = m[1];
      const identifier = m[2].trim();
      let nestedTemplate = null;

      if (useId) {
        nestedTemplate = templatesById.get(identifier);
      } else {
        nestedTemplate = templatesByName.get(identifier.toLowerCase());
      }

      if (!nestedTemplate) {
        console.warn(`TemplateWing: referenced template not found: ${identifier}`);
        continue;
      }

      if (visited.has(nestedTemplate.id)) {
        throw new Error(`Circular reference detected: ${nestedTemplate.name}`);
      }

      visited.add(nestedTemplate.id);
      const nestedContent = await resolveNestedTemplates(
        nestedTemplate.body || "",
        visited,
        templatesById,
        templatesByName
      );
      visited.delete(nestedTemplate.id);

      resolved = resolved.replace(fullMatch, nestedContent);
    }

    return resolved;
  };
}

describe("resolveNestedTemplates cycle detection", () => {
  // The actual implementation starts with visited = new Set([template.id]) in insertTemplateIntoTab,
  // then calls resolveNestedTemplates(template.body, visited, ...).
  // The function itself does NOT add the initial template to visited.
  // So we pass an EMPTY visited set to match how the function is actually called.

  it("resolves simple template include", async () => {
    const templatesById = new Map([["t1", { id: "t1", name: "Template 1", body: "Hello {NAME}" }]]);
    const templatesByName = new Map([["template 1", { id: "t1", name: "Template 1", body: "Hello {NAME}" }]]);
    const resolve = createMockResolve("resolve");

    const result = await resolve("{{template:Template 1}}", new Set(), templatesById, templatesByName);
    assert.strictEqual(result, "Hello {NAME}");
  });

  it("detects direct circular reference (template includes itself)", async () => {
    // Template A includes itself directly
    const templatesById = new Map([["tA", { id: "tA", name: "A", body: "{{templateid:tA}}" }]]);
    const templatesByName = new Map([["a", { id: "tA", name: "A", body: "{{templateid:tA}}" }]]);
    const resolve = createMockResolve("resolve");

    await assert.rejects(
      async () => resolve("{{templateid:tA}}", new Set(), templatesById, templatesByName),
      /Circular reference detected/
    );
  });

  it("detects indirect circular reference A -> B -> A", async () => {
    // A includes B, B includes A
    const templatesById = new Map([
      ["tA", { id: "tA", name: "A", body: "Start {{template:B}}" }],
      ["tB", { id: "tB", name: "B", body: "{{templateid:tA}}" }],
    ]);
    const templatesByName = new Map([
      ["a", { id: "tA", name: "A", body: "Start {{template:B}}" }],
      ["b", { id: "tB", name: "B", body: "{{templateid:tA}}" }],
    ]);
    const resolve = createMockResolve("resolve");

    await assert.rejects(
      async () => resolve("{{template:A}}", new Set(), templatesById, templatesByName),
      /Circular reference detected/
    );
  });

  it("detects circular reference through three levels A -> B -> C -> A", async () => {
    const templatesById = new Map([
      ["tA", { id: "tA", name: "A", body: "{{template:B}}" }],
      ["tB", { id: "tB", name: "B", body: "{{template:C}}" }],
      ["tC", { id: "tC", name: "C", body: "{{templateid:tA}}" }],
    ]);
    const templatesByName = new Map([
      ["a", { id: "tA", name: "A", body: "{{template:B}}" }],
      ["b", { id: "tB", name: "B", body: "{{template:C}}" }],
      ["c", { id: "tC", name: "C", body: "{{templateid:tA}}" }],
    ]);
    const resolve = createMockResolve("resolve");

    await assert.rejects(
      async () => resolve("{{template:A}}", new Set(), templatesById, templatesByName),
      /Circular reference detected/
    );
  });

  it("resolves multiple levels without cycle", async () => {
    const templatesById = new Map([
      ["tA", { id: "tA", name: "A", body: "Level 1 {{template:B}}" }],
      ["tB", { id: "tB", name: "B", body: "Level 2 {{template:C}}" }],
      ["tC", { id: "tC", name: "C", body: "Level 3" }],
    ]);
    const templatesByName = new Map([
      ["a", { id: "tA", name: "A", body: "Level 1 {{template:B}}" }],
      ["b", { id: "tB", name: "B", body: "Level 2 {{template:C}}" }],
      ["c", { id: "tC", name: "C", body: "Level 3" }],
    ]);
    const resolve = createMockResolve("resolve");

    const result = await resolve("{{template:A}}", new Set(), templatesById, templatesByName);
    assert.strictEqual(result, "Level 1 Level 2 Level 3");
  });

  it("returns original text when no includes found", async () => {
    const templatesById = new Map();
    const templatesByName = new Map();
    const resolve = createMockResolve("resolve");

    const result = await resolve("Plain text without includes", new Set(), templatesById, templatesByName);
    assert.strictEqual(result, "Plain text without includes");
  });

  it("returns empty string for empty input", async () => {
    const templatesById = new Map();
    const templatesByName = new Map();
    const resolve = createMockResolve("resolve");

    const result = await resolve("", new Set(), templatesById, templatesByName);
    assert.strictEqual(result, "");
  });

  it("warns and skips missing template references (marker remains)", async () => {
    const templatesById = new Map();
    const templatesByName = new Map();
    const resolve = createMockResolve("resolve");

    // Should not throw, just warn and skip - include marker remains in text
    const result = await resolve("{{template:NonExistent}}", new Set(), templatesById, templatesByName);
    // The include marker is NOT replaced when template not found
    assert.strictEqual(result, "{{template:NonExistent}}");
  });

  it("resolves same template included multiple times", async () => {
    const templatesById = new Map([["tA", { id: "tA", name: "A", body: "[A]" }]]);
    const templatesByName = new Map([["a", { id: "tA", name: "A", body: "[A]" }]]);
    const resolve = createMockResolve("resolve");

    // First include adds A to visited, resolves [A], removes A from visited
    // Second include can add A again since it's no longer in visited
    const result = await resolve("{{template:A}} and {{template:A}}", new Set(), templatesById, templatesByName);
    assert.strictEqual(result, "[A] and [A]");
  });
});
