import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lintTemplate, aggregateSeverity, SEVERITY } from "../modules/template-lint.js";
import { SUPPORTED_VARIABLES } from "../modules/template-insert.js";
import { ATTACHMENT_WARN_SIZE, ATTACHMENT_TOTAL_WARN_SIZE } from "../modules/validation.js";

describe("lintTemplate — unknown-variable", () => {
  it("does NOT flag any of the supported variables (zero false positives)", () => {
    const body = SUPPORTED_VARIABLES.map((v) => `{${v}}`).join(" ");
    const issues = lintTemplate({ id: "t1", name: "T", body, subject: "" }, []);
    assert.deepStrictEqual(
      issues.filter((i) => i.code === "unknown-variable"),
      []
    );
  });

  it("flags an unknown {FOO} variable as a warning", () => {
    const issues = lintTemplate({ id: "t1", name: "T", body: "{FOO} and {DATE}" }, []);
    const unknown = issues.find((i) => i.code === "unknown-variable");
    assert.ok(unknown);
    assert.strictEqual(unknown.severity, SEVERITY.warning);
    assert.strictEqual(unknown.detail.name, "FOO");
  });

  it("ignores control-flow and prompt tokens (treats them as known)", () => {
    const issues = lintTemplate(
      {
        id: "t1",
        name: "T",
        body: '{IF recipient.domain=="x"}A{ELSE}B{ENDIF} {PROMPT:Name:default} {CHOICE:T:a|b}',
      },
      []
    );
    assert.strictEqual(issues.filter((i) => i.code === "unknown-variable").length, 0);
  });

  it("ignores {{template:Name}} include syntax (not a single-curly variable)", () => {
    const issues = lintTemplate({ id: "t1", name: "T", body: "{{template:Other}}" }, [
      { id: "t1", name: "T" },
      { id: "t2", name: "Other" },
    ]);
    assert.strictEqual(issues.filter((i) => i.code === "unknown-variable").length, 0);
  });
});

describe("lintTemplate — broken-include", () => {
  it("flags a missing {{template:Name}} reference as an error", () => {
    const issues = lintTemplate({ id: "t1", name: "T", body: "{{template:Ghost}}" }, [
      { id: "t1", name: "T" },
    ]);
    const broken = issues.find((i) => i.code === "broken-include");
    assert.ok(broken);
    assert.strictEqual(broken.severity, SEVERITY.error);
    assert.strictEqual(broken.detail.value, "Ghost");
  });

  it("flags a missing {{templateid:uuid}} reference", () => {
    const issues = lintTemplate({ id: "t1", name: "T", body: "{{templateid:does-not-exist}}" }, [
      { id: "t1", name: "T" },
    ]);
    assert.ok(issues.some((i) => i.code === "broken-include"));
  });

  it("does NOT flag an include that resolves by name (case-insensitive)", () => {
    const issues = lintTemplate({ id: "t1", name: "T", body: "{{template:other}}" }, [
      { id: "t1", name: "T" },
      { id: "t2", name: "Other" },
    ]);
    assert.strictEqual(issues.filter((i) => i.code === "broken-include").length, 0);
  });
});

describe("lintTemplate — cycle", () => {
  it("flags A → B → A as a cycle error", () => {
    const templates = [
      { id: "tA", name: "A", body: "{{template:B}}" },
      { id: "tB", name: "B", body: "{{template:A}}" },
    ];
    const issues = lintTemplate(templates[0], templates);
    const cycle = issues.find((i) => i.code === "cycle");
    assert.ok(cycle);
    assert.strictEqual(cycle.severity, SEVERITY.error);
  });

  it("flags a direct self-reference as a cycle", () => {
    const tpl = { id: "tA", name: "A", body: "{{templateid:tA}}" };
    const issues = lintTemplate(tpl, [tpl]);
    assert.ok(issues.some((i) => i.code === "cycle"));
  });

  it("does NOT report a cycle when an include is broken (root cause first)", () => {
    const issues = lintTemplate({ id: "tA", name: "A", body: "{{template:Missing}}" }, [
      { id: "tA", name: "A", body: "{{template:Missing}}" },
    ]);
    assert.ok(issues.some((i) => i.code === "broken-include"));
    assert.strictEqual(issues.filter((i) => i.code === "cycle").length, 0);
  });

  it("does not flag diamond includes (A→B, A→C, B/C both →D) as a cycle", () => {
    const templates = [
      { id: "tA", name: "A", body: "{{template:B}} {{template:C}}" },
      { id: "tB", name: "B", body: "{{template:D}}" },
      { id: "tC", name: "C", body: "{{template:D}}" },
      { id: "tD", name: "D", body: "leaf" },
    ];
    const issues = lintTemplate(templates[0], templates);
    assert.strictEqual(issues.filter((i) => i.code === "cycle").length, 0);
  });
});

describe("lintTemplate — attachments", () => {
  it("flags individual attachment ≥ ATTACHMENT_WARN_SIZE", () => {
    const issues = lintTemplate(
      {
        id: "t1",
        name: "T",
        attachments: [{ name: "big.pdf", size: ATTACHMENT_WARN_SIZE }],
      },
      []
    );
    assert.ok(issues.some((i) => i.code === "oversize-attachment"));
  });

  it("flags total ≥ ATTACHMENT_TOTAL_WARN_SIZE even when each file is small", () => {
    const half = Math.ceil(ATTACHMENT_TOTAL_WARN_SIZE / 2);
    const issues = lintTemplate(
      {
        id: "t1",
        name: "T",
        attachments: [
          { name: "a.bin", size: half },
          { name: "b.bin", size: half },
        ],
      },
      []
    );
    assert.ok(issues.some((i) => i.code === "oversize-total"));
  });

  it("does NOT flag attachments under the threshold", () => {
    const issues = lintTemplate(
      { id: "t1", name: "T", attachments: [{ name: "a.bin", size: 1024 }] },
      []
    );
    assert.strictEqual(issues.filter((i) => i.code.startsWith("oversize")).length, 0);
  });
});

describe("lintTemplate — recipients", () => {
  it("flags an invalid email in the To: array", () => {
    const issues = lintTemplate({ id: "t1", name: "T", to: ["not-an-email"] }, []);
    const r = issues.find((i) => i.code === "invalid-recipient");
    assert.ok(r);
    assert.strictEqual(r.detail.field, "to");
  });

  it("does NOT flag a clean To/Cc/Bcc set", () => {
    const issues = lintTemplate(
      {
        id: "t1",
        name: "T",
        to: ["a@b.com", "Jane Doe <jane@example.com>"],
        cc: [],
        bcc: ["x@y.com"],
      },
      []
    );
    assert.strictEqual(issues.filter((i) => i.code === "invalid-recipient").length, 0);
  });
});

describe("aggregateSeverity", () => {
  it("returns null for empty", () => {
    assert.strictEqual(aggregateSeverity([]), null);
  });
  it("returns 'error' when any issue is an error", () => {
    assert.strictEqual(
      aggregateSeverity([{ severity: SEVERITY.warning }, { severity: SEVERITY.error }]),
      "error"
    );
  });
  it("returns 'warning' when only warnings present", () => {
    assert.strictEqual(aggregateSeverity([{ severity: SEVERITY.warning }]), "warning");
  });
});
