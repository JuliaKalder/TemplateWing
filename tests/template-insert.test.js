import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { installMessengerMock, uninstallMessengerMock } from "./_mock-messenger.js";

// The module installs a storage listener at import time; install the mock first.
installMessengerMock();

const {
  TEMPLATE_INCLUDE_REGEX,
  WEEKDAY_NAMES,
  applyVariables,
  replaceVariables,
  resolveNestedTemplates,
  resolveControlFlow,
  extractPromptTokens,
  applyPromptAnswers,
  buildVariableContext,
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
    assert.deepStrictEqual(
      matches.map((m) => m[2]),
      ["First", "Second", "id123"]
    );
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
    assert.strictEqual(
      applyVariables("{date} {Date} {DATE}", fixed),
      "2026-04-06 2026-04-06 2026-04-06"
    );
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

describe("replaceVariables", () => {
  it("replaces {SENDER_NAME} and {SENDER_EMAIL} from provided vars", () => {
    const result = replaceVariables("From: {SENDER_NAME} <{SENDER_EMAIL}>", {
      senderName: "Alice",
      senderEmail: "alice@example.com",
    });
    assert.strictEqual(result, "From: Alice <alice@example.com>");
  });

  it("replaces {ACCOUNT_NAME} and {ACCOUNT_EMAIL} from provided vars", () => {
    const result = replaceVariables("{ACCOUNT_NAME} / {ACCOUNT_EMAIL}", {
      accountName: "Work",
      accountEmail: "alice.work@example.com",
    });
    assert.strictEqual(result, "Work / alice.work@example.com");
  });

  it("HTML-encodes identity values when isHtml is true", () => {
    const result = replaceVariables("{SENDER_NAME}", { senderName: "<b>Alice & Bob</b>" }, true);
    assert.strictEqual(result, "&lt;b&gt;Alice &amp; Bob&lt;/b&gt;");
  });

  it("does not HTML-encode when isHtml is false", () => {
    const result = replaceVariables("{SENDER_NAME}", { senderName: "<Alice>" }, false);
    assert.strictEqual(result, "<Alice>");
  });

  it("defaults identity vars to empty strings when vars is empty", () => {
    const result = replaceVariables("{SENDER_NAME} <{SENDER_EMAIL}>", {});
    assert.strictEqual(result, " <>");
  });

  it("replaces {DATE} with a non-empty string", () => {
    const result = replaceVariables("{DATE}", {});
    assert.ok(
      result.length > 0 && !result.includes("{DATE}"),
      `{DATE} should be replaced, got: ${result}`
    );
  });

  it("replaces {TIME} with a non-empty string", () => {
    const result = replaceVariables("{TIME}", {});
    assert.ok(
      result.length > 0 && !result.includes("{TIME}"),
      `{TIME} should be replaced, got: ${result}`
    );
  });

  it("replaces {YEAR} with a 4-digit year", () => {
    const result = replaceVariables("{YEAR}", {});
    assert.match(result, /^\d{4}$/);
  });

  it("replaces {WEEKDAY} with a day name", () => {
    const result = replaceVariables("{WEEKDAY}", {});
    assert.ok(WEEKDAY_NAMES.includes(result), `expected a weekday name, got: ${result}`);
  });

  it("returns null unchanged for null input", () => {
    assert.strictEqual(replaceVariables(null, {}), null);
  });

  it("returns undefined unchanged for undefined input", () => {
    assert.strictEqual(replaceVariables(undefined, {}), undefined);
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
    const { byId, byName } = buildMaps([{ id: "t1", name: "Template 1", body: "Hello {NAME}" }]);
    const result = await resolveNestedTemplates("{{template:Template 1}}", new Set(), byId, byName);
    assert.strictEqual(result, "Hello {NAME}");
  });

  it("detects direct self-reference", async () => {
    const { byId, byName } = buildMaps([{ id: "tA", name: "A", body: "{{templateid:tA}}" }]);
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
    const { byId, byName } = buildMaps([{ id: "tA", name: "A", body: "[A]" }]);
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
    const { byId, byName } = buildMaps([{ id: "tA", name: "A", body: "{{template:A}}" }]);
    await assert.rejects(
      resolveNestedTemplates("{{template:A}}", new Set(["tA"]), byId, byName),
      /Circular reference detected/
    );
  });
});

// ---- Recipient variables (#208) ----

describe("applyVariables — recipient tokens", () => {
  const vars = {
    recipientName: "Jane Doe",
    recipientFirstname: "Jane",
    recipientEmail: "jane@example.com",
    lastMessageSubject: "Project update",
    replyQuote: "> previous text",
  };

  it("replaces {RECIPIENT_NAME}, {RECIPIENT_FIRSTNAME}, {RECIPIENT_EMAIL}", () => {
    assert.strictEqual(
      applyVariables("To {RECIPIENT_FIRSTNAME} <{RECIPIENT_EMAIL}> ({RECIPIENT_NAME})", vars),
      "To Jane <jane@example.com> (Jane Doe)"
    );
  });

  it("replaces {LAST_MESSAGE_SUBJECT}", () => {
    assert.strictEqual(
      applyVariables("Re: {LAST_MESSAGE_SUBJECT}", vars),
      "Re: Project update"
    );
  });

  it("inserts {REPLY_QUOTE} verbatim (no escaping) so quote markup survives", () => {
    const html = applyVariables(
      "Hi —<br>{REPLY_QUOTE}",
      { replyQuote: "<blockquote>old</blockquote>" },
      true
    );
    assert.ok(html.includes("<blockquote>old</blockquote>"));
  });

  it("missing recipient values resolve to empty strings, not 'undefined'", () => {
    const result = applyVariables(
      "Hi {RECIPIENT_FIRSTNAME}, your email {RECIPIENT_EMAIL}",
      {}
    );
    assert.strictEqual(result, "Hi , your email ");
    assert.ok(!result.includes("undefined"));
  });

  it("HTML-encodes recipient name when isHtml=true", () => {
    const result = applyVariables(
      "{RECIPIENT_NAME}",
      { recipientName: "<script>alert(1)</script>" },
      true
    );
    assert.strictEqual(result, "&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

// ---- Conditional variables (#207) ----

describe("resolveControlFlow — {IF}/{ELSE}/{ENDIF}", () => {
  const ctx = {
    recipient: { name: "Jane", email: "jane@example.com", domain: "example.com", firstname: "Jane" },
    identity: { email: "me@example.com", name: "Me" },
  };

  it("renders THEN branch when condition is true", () => {
    const t = 'Hello {IF recipient.firstname=="Jane"}Jane!{ELSE}stranger{ENDIF}';
    assert.strictEqual(resolveControlFlow(t, ctx), "Hello Jane!");
  });

  it("renders ELSE branch when condition is false", () => {
    const t = 'Hi {IF recipient.firstname=="Bob"}Bob{ELSE}friend{ENDIF}';
    assert.strictEqual(resolveControlFlow(t, ctx), "Hi friend");
  });

  it("supports != operator", () => {
    const t = '{IF recipient.domain!="other.com"}match{ELSE}no{ENDIF}';
    assert.strictEqual(resolveControlFlow(t, ctx), "match");
  });

  it("omits content when condition false and no ELSE", () => {
    const t = 'A{IF recipient.email=="nope"}HIDDEN{ENDIF}B';
    assert.strictEqual(resolveControlFlow(t, ctx), "AB");
  });

  it("treats unknown variable as empty string in comparison", () => {
    const t = '{IF recipient.unknown=="x"}yes{ELSE}no{ENDIF}';
    assert.strictEqual(resolveControlFlow(t, ctx), "no");
  });

  it("handles nested {IF} blocks", () => {
    const t =
      '{IF recipient.domain=="example.com"}' +
      'outer{IF recipient.firstname=="Jane"}-inner{ENDIF}' +
      "{ELSE}other{ENDIF}";
    assert.strictEqual(resolveControlFlow(t, ctx), "outer-inner");
  });

  it("supports single quotes in expression", () => {
    const t = "{IF recipient.domain=='example.com'}ok{ENDIF}";
    assert.strictEqual(resolveControlFlow(t, ctx), "ok");
  });

  it("returns text unchanged when no IF tokens", () => {
    assert.strictEqual(resolveControlFlow("plain", ctx), "plain");
  });

  it("returns empty string unchanged", () => {
    assert.strictEqual(resolveControlFlow("", ctx), "");
  });

  it("falls back gracefully on unparseable expression", () => {
    const t = "{IF garbage}then{ELSE}else{ENDIF}";
    // Unparseable cond evaluates to false → ELSE branch
    assert.strictEqual(resolveControlFlow(t, ctx), "else");
  });

  it("leaves stray {ENDIF} literal when there is no opening {IF}", () => {
    assert.strictEqual(resolveControlFlow("hello {ENDIF}", ctx), "hello {ENDIF}");
  });

  it("emits the THEN branch when {ENDIF} is missing (graceful degrade)", () => {
    const t = '{IF recipient.firstname=="Jane"}greeting';
    assert.strictEqual(resolveControlFlow(t, ctx), "greeting");
  });
});

// ---- Prompt / Choice variables (#207) ----

describe("extractPromptTokens", () => {
  it("returns empty list when none present", () => {
    assert.deepStrictEqual(extractPromptTokens("plain text"), []);
  });

  it("extracts a {PROMPT:label} token without default", () => {
    const tokens = extractPromptTokens("Hi {PROMPT:Your name}");
    assert.strictEqual(tokens.length, 1);
    assert.strictEqual(tokens[0].kind, "prompt");
    assert.strictEqual(tokens[0].label, "Your name");
    assert.strictEqual(tokens[0].default, "");
  });

  it("extracts a {PROMPT:label:default} token with default", () => {
    const tokens = extractPromptTokens("{PROMPT:Greeting:Hello}");
    assert.strictEqual(tokens[0].default, "Hello");
  });

  it("extracts a {CHOICE:label:opt1|opt2|opt3} token", () => {
    const tokens = extractPromptTokens("{CHOICE:Tone:formal|casual|terse}");
    assert.strictEqual(tokens[0].kind, "choice");
    assert.deepStrictEqual(tokens[0].options, ["formal", "casual", "terse"]);
    assert.strictEqual(tokens[0].default, "formal");
  });

  it("deduplicates identical literal tokens", () => {
    const tokens = extractPromptTokens("{PROMPT:Name} and {PROMPT:Name} again");
    assert.strictEqual(tokens.length, 1);
  });
});

describe("applyPromptAnswers", () => {
  it("substitutes the provided answer at every occurrence", () => {
    const tokens = extractPromptTokens("Hi {PROMPT:Name}, see you {PROMPT:Name}.");
    const result = applyPromptAnswers(
      "Hi {PROMPT:Name}, see you {PROMPT:Name}.",
      tokens,
      { "{PROMPT:Name}": "Alice" }
    );
    assert.strictEqual(result, "Hi Alice, see you Alice.");
  });

  it("falls back to the parsed default when no answer is supplied", () => {
    const tokens = extractPromptTokens("{PROMPT:Greeting:Hello} world");
    const result = applyPromptAnswers("{PROMPT:Greeting:Hello} world", tokens, {});
    assert.strictEqual(result, "Hello world");
  });

  it("HTML-encodes the answer when isHtml=true", () => {
    const tokens = extractPromptTokens("{PROMPT:Name}");
    const result = applyPromptAnswers(
      "{PROMPT:Name}",
      tokens,
      { "{PROMPT:Name}": "<b>x</b>" },
      true
    );
    assert.strictEqual(result, "&lt;b&gt;x&lt;/b&gt;");
  });

  it("returns text unchanged when no tokens", () => {
    assert.strictEqual(applyPromptAnswers("plain", [], {}), "plain");
  });
});

describe("buildVariableContext", () => {
  it("exposes recipient.domain derived from recipient email", () => {
    const ctx = buildVariableContext({
      identityVars: { senderName: "Me", senderEmail: "me@x", accountName: "", accountEmail: "" },
      recipientVars: {
        recipientName: "J",
        recipientFirstname: "J",
        recipientEmail: "jane@example.com",
      },
      date: new Date(2026, 5, 24, 10, 30, 0),
    });
    assert.strictEqual(ctx.recipient.domain, "example.com");
    assert.strictEqual(ctx.identity.email, "me@x");
    assert.strictEqual(ctx.year, "2026");
  });

  it("empty recipient email yields empty domain", () => {
    const ctx = buildVariableContext({
      identityVars: { senderName: "", senderEmail: "" },
      recipientVars: { recipientEmail: "" },
    });
    assert.strictEqual(ctx.recipient.domain, "");
  });
});
