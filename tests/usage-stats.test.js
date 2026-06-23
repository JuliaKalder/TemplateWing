import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildUsageRows,
  filterUnusedSince,
  sortRows,
  topNByUsage,
  toCSV,
  csvFilename,
} from "../modules/usage-stats.js";

const NOW = new Date("2026-06-24T12:00:00Z");

describe("buildUsageRows", () => {
  it("converts a template into a row with derived fields", () => {
    const t = {
      id: "t1",
      name: "Greeting",
      category: "Sales",
      identities: ["i1"],
      usageCount: 14,
      lastUsedAt: "2026-06-10T00:00:00Z",
      createdAt: "2026-05-10T00:00:00Z",
    };
    const [row] = buildUsageRows([t], NOW);
    assert.strictEqual(row.usageCount, 14);
    assert.strictEqual(row.daysSinceLast, 14);
    assert.ok(row.avgPerWeek > 0);
    assert.strictEqual(row.category, "Sales");
  });

  it("daysSinceLast is null for never-used templates", () => {
    const [row] = buildUsageRows([{ id: "t1", name: "x" }], NOW);
    assert.strictEqual(row.daysSinceLast, null);
    assert.strictEqual(row.avgPerWeek, 0);
  });

  it("clamps avg to one full week even for templates created today", () => {
    const t = {
      id: "t1",
      name: "x",
      usageCount: 5,
      createdAt: NOW.toISOString(),
    };
    const [row] = buildUsageRows([t], NOW);
    assert.strictEqual(row.avgPerWeek, 5);
  });

  it("returns empty list for empty input", () => {
    assert.deepStrictEqual(buildUsageRows([], NOW), []);
    assert.deepStrictEqual(buildUsageRows(null, NOW), []);
  });
});

describe("filterUnusedSince", () => {
  const rows = [
    { id: "1", usageCount: 5, daysSinceLast: 10 },
    { id: "2", usageCount: 0, daysSinceLast: null },
    { id: "3", usageCount: 2, daysSinceLast: 100 },
  ];

  it("'all' returns every row", () => {
    assert.strictEqual(filterUnusedSince(rows, "all").length, 3);
  });

  it("'never' returns only never-used rows", () => {
    const out = filterUnusedSince(rows, "never");
    assert.deepStrictEqual(
      out.map((r) => r.id),
      ["2"]
    );
  });

  it("numeric threshold returns rows last used ≥ N days ago (or never)", () => {
    const out = filterUnusedSince(rows, 30);
    assert.deepStrictEqual(
      out.map((r) => r.id),
      ["2", "3"]
    );
  });
});

describe("sortRows", () => {
  const rows = [
    { id: "a", name: "Zoo", usageCount: 1, daysSinceLast: 5 },
    { id: "b", name: "Apple", usageCount: 5, daysSinceLast: null },
    { id: "c", name: "Mango", usageCount: 5, daysSinceLast: 2 },
  ];

  it("sorts strings ascending", () => {
    assert.deepStrictEqual(
      sortRows(rows, "name", "asc").map((r) => r.name),
      ["Apple", "Mango", "Zoo"]
    );
  });

  it("sorts numbers descending", () => {
    assert.deepStrictEqual(
      sortRows(rows, "usageCount", "desc").map((r) => r.id),
      ["b", "c", "a"]
    );
  });

  it("is stable on ties (preserves input order)", () => {
    const out = sortRows(rows, "usageCount", "desc").filter((r) => r.usageCount === 5);
    assert.deepStrictEqual(
      out.map((r) => r.id),
      ["b", "c"]
    );
  });

  it("puts null values at the end regardless of direction", () => {
    const out = sortRows(rows, "daysSinceLast", "asc");
    assert.strictEqual(out[out.length - 1].id, "b");
  });
});

describe("topNByUsage", () => {
  it("returns the top N most-used rows", () => {
    const rows = [
      { id: "a", usageCount: 1 },
      { id: "b", usageCount: 5 },
      { id: "c", usageCount: 3 },
    ];
    assert.deepStrictEqual(
      topNByUsage(rows, 2).map((r) => r.id),
      ["b", "c"]
    );
  });

  it("clamps N ≤ 0 to empty list", () => {
    assert.deepStrictEqual(topNByUsage([{ id: "a", usageCount: 1 }], 0), []);
  });
});

describe("toCSV", () => {
  it("uses CRLF line endings", () => {
    const out = toCSV(["a", "b"], [["1", "2"]]);
    assert.ok(out.endsWith("\r\n"));
    assert.ok(out.includes("\r\n"));
  });

  it("quotes every field and escapes embedded quotes by doubling", () => {
    const out = toCSV(["name"], [['Jane "JD" Doe']]);
    assert.ok(out.includes('"Jane ""JD"" Doe"'));
  });

  it("handles empty body", () => {
    const out = toCSV(["a", "b"], []);
    assert.strictEqual(out, '"a","b"\r\n');
  });

  it("renders numeric and null values safely", () => {
    const out = toCSV(["a", "b"], [[1, null]]);
    assert.ok(out.includes('"1",""'));
  });
});

describe("csvFilename", () => {
  it("matches the spec format templatewing-usage-YYYY-MM-DD.csv", () => {
    assert.strictEqual(
      csvFilename(new Date("2026-06-24T12:00:00")),
      "templatewing-usage-2026-06-24.csv"
    );
  });

  it("zero-pads single-digit months and days", () => {
    assert.strictEqual(
      csvFilename(new Date("2026-01-05T12:00:00")),
      "templatewing-usage-2026-01-05.csv"
    );
  });
});
