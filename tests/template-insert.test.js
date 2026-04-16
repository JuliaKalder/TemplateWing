import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { installMessengerMock, uninstallMessengerMock } from "./_mock-messenger.js";

// The module installs a storage listener at import time; install the mock first.
installMessengerMock();

const {
  TEMPLATE_INCLUDE_REGEX,
  WEEKDAY_NAMES,
  applyVariables,
  resolveNestedTemplates,
} = await import("../modules/template-insert.js");

after(() => uninstallMessengerMock());

// ---- Template include regex ----

describe("TEMPLATE_INCLUDE_REGEX", () => {
  function matchAll(text) {
    const r = new RegExp(TEMPLATE_INCLUDE_REGEX.source, TEMPLATE_INCLUDE_REGEX.flags);
    return [...text.matchAll(r)];
  }

  it("matches {{template:Name}} syntax", () => {
    const matches = matchAll("Hello {{template:My Template}} how are you?");
    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0][2], "My Template");
    assert.strictEqual(matches[0][1], undefined);
  });

  it("matches {{templateid:abc123}} syntax", () => {
    const matches = matchAll("Including {{templateid:abc123}} now");
    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0][2], "abc123");
    assert.strictEqual(matches[0][1], "id");
  });

  it("matches multiple includes in same text", () => {
    const matches = matchAll("{{template:First}} and {{template:Second}} and {{templateid:id123}}");
    assert.strictEqual(matches.length, 3);
    assert.deepStrictEqual(matches.map((m) => m[2]), ["First", "Second", "id123"]);
  });

  it("is case-insensitive for the template keyword", () => {
    const matches = matchAll("{{TEMPLATE:Name}} and {{TemplateId:id123}}");
    assert.strictEqual(matches.length, 2);
  });

  it("returns no matches for plain text", () => {
    assert.strictEqual(matchAll("No template includes here").length, 0);
  });
});

// ---- Variable replacement ----

describe("applyVariables", () => {
  const fixed = {
    date: "2026-04-06",
    time: "10:30:00",
    datetime: "2026-04-06 10:30:00",
    year: 2026,
    weekday: "Monday",
    senderName: "Jane Doe",
    senderEmail: "jane@example.com",
    accountName: "Work",
    accountEmail: "jane.work@example.com",
  };

  it("replaces {DATE}", () => {
    assert.strictEqual(applyVariables("Date: {DATE}", fixed), "Date: 2026-04-06");
  });

  it("replaces {YEAR} numerically", () => {
    assert.strictEqual(applyVariables("Year: {YEAR}", fixed), "Year: 2026");
  });

  it("replaces {WEEKDAY}", () => {
    assert.strictEqual(applyVariables("Day: {WEEKDAY}", fixed), "Day: Monday");
  });

  it("replaces {SENDER_NAME} and {SENDER_EMAIL}", () => {
    assert.strictEqual(
      applyVariables("From: {SENDER_NAME} <{SENDER_EMAIL}>", fixed),
      "From: Jane Doe <jane@example.com>"
    );
  });

  it("replaces {ACCOUNT_NAME} and {ACCOUNT_EMAIL}", () => {
    assert.strictEqual(
      applyVariables("Acct: {ACCOUNT_NAME} / {ACCOUNT_EMAIL}", fixed),
      "Acct: Work / jane.work@example.com"
    );
  });

  it("is case-insensitive", () => {
    assert.strictEqual(applyVariables("{date} {Date} {DATE}", fixed), "2026-04-06 2026-04-06 2026-04-06");
  });

  it("leaves text without variables unchanged", () => {
    assert.strictEqual(applyVariables("Plain text only", fixed), "Plain text only");
  });

  it("replaces multiple variables in one pass", () => {
    const result = applyVariables("{DATE} {TIME} from {SENDER_EMAIL}", fixed);
    assert.strictEqual(result, "2026-04-06 10:30:00 from jane@example.com");
  });

  it("returns empty string unchanged", () => {
    assert.strictEqual(applyVariables("", fixed), "");
  });

  it("handles null/undefined input", () => {
    assert.strictEqual(applyVariables(null, fixed), null);
    assert.strictEqual(applyVariables(undefined, fixed), undefined);
  });
});

describe("WEEKDAY_NAMES", () => {
  it("has seven English weekday names starting with Sunday", () => {
    assert.strictEqual(WEEKDAY_NAMES.length, 7);
    assert.strictEqual(WEEKDAY_NAMES[0], "Sunday");
    assert.strictEqual(WEEKDAY_NAMES[6], "Saturday");
  });
});

// ---- Nested template resolution + cycle detection ----

describe("resolveNestedTemplates", () => {
  function buildMaps(templates) {
    const byId = new Map(templates.map((t) => [t.id, t]));
    const byName = new Map(templates.map((t) => [t.name.toLowerCase(), t]));
    return { byId, byName };
  }

  it("resolves a simple template include", async () => {
    const { byId, byName } = buildMaps([
      { id: "t1", name: "Template 1", body: "Hello {NAME}" },
    ]);
    const result = await resolveNestedTemplates("{{template:Template 1}}", new Set(), byId, byName);
    assert.strictEqual(result, "Hello {NAME}");
  });

  it("detects direct self-reference", async () => {
    const { byId, byName } = buildMaps([
      { id: "tA", name: "A", body: "{{templateid:tA}}" },
    ]);
    await assert.rejects(
      resolveNestedTemplates("{{templateid:tA}}", new Set(), byId, byName),
      /Circular reference detected/
    );
  });

  it("detects indirect cycle A -> B -> A", async () => {
    const { byId, byName } = buildMaps([
      { id: "tA", name: "A", body: "Start {{template:B}}" },
      { id: "tB", name: "B", body: "{{templateid:tA}}" },
    ]);
    await assert.rejects(
      resolveNestedTemplates("{{template:A}}", new Set(), byId, byName),
      /Circular reference detected/
    );
  });

  it("detects three-level cycle A -> B -> C -> A", async () => {
    const { byId, byName } = buildMaps([
      { id: "tA", name: "A", body: "{{template:B}}" },
      { id: "tB", name: "B", body: "{{template:C}}" },
      { id: "tC", name: "C", body: "{{templateid:tA}}" },
    ]);
    await assert.rejects(
      resolveNestedTemplates("{{template:A}}", new Set(), byId, byName),
      /Circular reference detected/
    );
  });

  it("resolves multiple levels without cycle", async () => {
    const { byId, byName } = buildMaps([
      { id: "tA", name: "A", body: "Level 1 {{template:B}}" },
      { id: "tB", name: "B", body: "Level 2 {{template:C}}" },
      { id: "tC", name: "C", body: "Level 3" },
    ]);
    const result = await resolveNestedTemplates("{{template:A}}", new Set(), byId, byName);
    assert.strictEqual(result, "Level 1 Level 2 Level 3");
  });

  it("leaves include marker in place when template is missing", async () => {
    const result = await resolveNestedTemplates(
      "{{template:NonExistent}}",
      new Set(),
      new Map(),
      new Map()
    );
    assert.strictEqual(result, "{{template:NonExistent}}");
  });

  it("returns the text unchanged when it has no includes", async () => {
    const result = await resolveNestedTemplates("Plain", new Set(), new Map(), new Map());
    assert.strictEqual(result, "Plain");
  });

  it("returns empty string for empty input", async () => {
    const result = await resolveNestedTemplates("", new Set(), new Map(), new Map());
    assert.strictEqual(result, "");
  });

  it("resolves the same template multiple times in one string", async () => {
    const { byId, byName } = buildMaps([
      { id: "tA", name: "A", body: "[A]" },
    ]);
    const result = await resolveNestedTemplates(
      "{{template:A}} and {{template:A}}",
      new Set(),
      byId,
      byName
    );
    assert.strictEqual(result, "[A] and [A]");
  });

  it("respects an externally-supplied visited set (caller seeds top-level id)", async () => {
    // The production insertTemplateIntoTab passes `new Set([template.id])` so that a
    // template including itself by name or id is detected as a cycle at the outermost level.
    const { byId, byName } = buildMaps([
      { id: "tA", name: "A", body: "{{template:A}}" },
    ]);
    await assert.rejects(
      resolveNestedTemplates("{{template:A}}", new Set(["tA"]), byId, byName),
      /Circular reference detected/
    );
  });
});
