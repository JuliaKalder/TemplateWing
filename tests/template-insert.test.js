import { describe, it, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  installMessengerMock,
  uninstallMessengerMock,
  installDomParserMock,
  uninstallDomParserMock,
} from "./_mock-messenger.js";

// The module installs a storage listener at import time; install the mock first.
installMessengerMock();
installDomParserMock();

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
  applyTemplateRecipientFallback,
  insertTemplateIntoTab,
  joinPlainText,
  usesNicknameVariable,
  resolveContactVars,
  usesRecipientVariables,
  needsRecipientPrompt,
} = await import("../modules/template-insert.js");
const { saveTemplate } = await import("../modules/template-store.js");

after(() => {
  uninstallMessengerMock();
  uninstallDomParserMock();
});

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
    assert.strictEqual(applyVariables("Re: {LAST_MESSAGE_SUBJECT}", vars), "Re: Project update");
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
    const result = applyVariables("Hi {RECIPIENT_FIRSTNAME}, your email {RECIPIENT_EMAIL}", {});
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
    recipient: {
      name: "Jane",
      email: "jane@example.com",
      domain: "example.com",
      firstname: "Jane",
    },
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
    const result = applyPromptAnswers("Hi {PROMPT:Name}, see you {PROMPT:Name}.", tokens, {
      "{PROMPT:Name}": "Alice",
    });
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

describe("applyTemplateRecipientFallback", () => {
  const empty = { recipientName: "", recipientFirstname: "", recipientEmail: "" };

  it("fills recipient from template.to[0] when compose has no recipient", () => {
    const result = applyTemplateRecipientFallback(empty, ["Jane Doe <jane@test.com>"]);
    assert.strictEqual(result.recipientEmail, "jane@test.com");
    assert.strictEqual(result.recipientName, "Jane Doe");
    assert.strictEqual(result.recipientFirstname, "Jane");
  });

  it("keeps existing recipient when compose already has one (reply case)", () => {
    const existing = {
      recipientName: "Original",
      recipientFirstname: "Original",
      recipientEmail: "orig@other.com",
    };
    const result = applyTemplateRecipientFallback(existing, ["jane@test.com"]);
    assert.strictEqual(result.recipientEmail, "orig@other.com");
  });

  it("no-op when template.to is empty or missing", () => {
    assert.deepStrictEqual(applyTemplateRecipientFallback(empty, []), empty);
    assert.deepStrictEqual(applyTemplateRecipientFallback(empty, undefined), empty);
  });

  it("no-op when template.to[0] is unparseable", () => {
    assert.deepStrictEqual(applyTemplateRecipientFallback(empty, ["not an email"]), empty);
  });
});

// ---- Insert modes end-to-end (issue #221) ----

describe("insertTemplateIntoTab insert modes", () => {
  // Thunderbird rebuilds the compose document from this string: anything
  // before <body> becomes head content and is invisible to the user.
  const COMPOSE_DOC =
    '<html><head><meta http-equiv="content-type" content="text/html; charset=UTF-8"></head>' +
    '<body><p><br></p><div class="moz-signature">-- <br>Alice</div></body></html>';

  function setup(insertMode) {
    messenger.compose._details = { 1: { identityId: null, isPlainText: false, body: COMPOSE_DOC } };
    return {
      id: "t1",
      name: "Test",
      body: "THIS IS A TEMPLATE BODY TEST",
      insertMode,
      attachments: [],
    };
  }

  it("prepend puts the body inside <body>, above existing content", async () => {
    await insertTemplateIntoTab(1, setup("prepend"));
    const body = messenger.compose._details[1].body;
    const tmplIdx = body.indexOf("THIS IS A TEMPLATE BODY TEST");
    assert.ok(tmplIdx !== -1, "template body was inserted");
    assert.ok(tmplIdx > body.indexOf("<body>"), "not stranded in the document head");
    assert.ok(tmplIdx < body.indexOf("moz-signature"), "above the signature");
    assert.ok(tmplIdx < body.indexOf("</body>"));
  });

  it("append puts the body inside <body>, below existing content", async () => {
    await insertTemplateIntoTab(1, setup("append"));
    const body = messenger.compose._details[1].body;
    const tmplIdx = body.indexOf("THIS IS A TEMPLATE BODY TEST");
    assert.ok(tmplIdx > body.indexOf("moz-signature"));
    assert.ok(tmplIdx < body.indexOf("</body>"), "not after the closing tags");
  });

  it("replace overwrites the whole body", async () => {
    await insertTemplateIntoTab(1, setup("replace"));
    assert.strictEqual(messenger.compose._details[1].body, "THIS IS A TEMPLATE BODY TEST");
  });

  it("an unknown mode falls back to append inside <body>", async () => {
    await insertTemplateIntoTab(1, setup("bogus-mode"));
    const body = messenger.compose._details[1].body;
    assert.ok(body.indexOf("THIS IS A TEMPLATE BODY TEST") < body.indexOf("</body>"));
  });
});

// ---- Plain-text compose windows ----

// Thunderbird silently discards `body` on a plain-text composer, so every
// insert mode has to deliver the template as `plainTextBody`.
describe("insertTemplateIntoTab in plain-text compose", () => {
  function setup(insertMode, existingText) {
    messenger.compose._details = {
      1: {
        identityId: null,
        isPlainText: true,
        // What TB reports for a plain-text composer: an HTML rendering in
        // `body`, the actual editor text in `plainTextBody`.
        body: "<html><body><pre>" + existingText + "</pre></body></html>",
        plainTextBody: existingText,
      },
    };
    return {
      id: "t1",
      name: "Test",
      body: "<p>Hello there</p>",
      insertMode,
      attachments: [],
    };
  }

  it("never sets body, which Thunderbird would drop", async () => {
    await insertTemplateIntoTab(1, setup("prepend", "-- \nAlice"));
    const written = messenger.compose._details[1];
    assert.ok(!Object.hasOwn(written, "body") || !written.body.includes("Hello there"));
    assert.ok(written.plainTextBody.includes("Hello there"), "template went to plainTextBody");
  });

  it("prepend puts the template above the existing text", async () => {
    await insertTemplateIntoTab(1, setup("prepend", "-- \nAlice"));
    assert.strictEqual(messenger.compose._details[1].plainTextBody, "Hello there\n-- \nAlice");
  });

  it("append puts the template below the existing text", async () => {
    await insertTemplateIntoTab(1, setup("append", "-- \nAlice"));
    assert.strictEqual(messenger.compose._details[1].plainTextBody, "-- \nAlice\nHello there");
  });

  it("replace overwrites the text", async () => {
    await insertTemplateIntoTab(1, setup("replace", "-- \nAlice"));
    assert.strictEqual(messenger.compose._details[1].plainTextBody, "Hello there");
  });

  it("strips the template's HTML markup", async () => {
    await insertTemplateIntoTab(1, setup("replace", ""));
    assert.ok(!messenger.compose._details[1].plainTextBody.includes("<p>"));
  });

  it("an unknown mode falls back to append", async () => {
    await insertTemplateIntoTab(1, setup("bogus-mode", "existing"));
    assert.strictEqual(messenger.compose._details[1].plainTextBody, "existing\nHello there");
  });
});

describe("joinPlainText", () => {
  it("inserts exactly one newline between the blocks", () => {
    assert.strictEqual(joinPlainText("a", "b"), "a\nb");
  });

  it("does not add a second newline when one is already there", () => {
    assert.strictEqual(joinPlainText("a\n", "b"), "a\nb");
  });

  it("returns the other side when one is empty", () => {
    assert.strictEqual(joinPlainText("", "b"), "b");
    assert.strictEqual(joinPlainText("a", ""), "a");
    assert.strictEqual(joinPlainText("", ""), "");
  });
});

// ---- Recipient nickname (#227) ----

describe("applyVariables — {RECIPIENT_NICKNAME}", () => {
  it("substitutes the nickname", () => {
    assert.strictEqual(
      applyVariables("Hi {RECIPIENT_NICKNAME},", { recipientNickname: "Kat" }),
      "Hi Kat,"
    );
  });

  it("resolves to empty string when there is no nickname", () => {
    assert.strictEqual(applyVariables("Hi {RECIPIENT_NICKNAME},", {}), "Hi ,");
  });

  it("does not collide with {RECIPIENT_NAME}", () => {
    const out = applyVariables("{RECIPIENT_NAME} / {RECIPIENT_NICKNAME}", {
      recipientName: "Katharina Meier",
      recipientNickname: "Kat",
    });
    assert.strictEqual(out, "Katharina Meier / Kat");
  });

  it("HTML-encodes the nickname in HTML mode", () => {
    assert.strictEqual(
      applyVariables("Hi {RECIPIENT_NICKNAME}", { recipientNickname: '<b>"K"</b>' }, true),
      "Hi &lt;b&gt;&quot;K&quot;&lt;/b&gt;"
    );
  });

  it("is case-insensitive like the other tokens", () => {
    assert.strictEqual(applyVariables("{recipient_nickname}", { recipientNickname: "Kat" }), "Kat");
  });
});

describe("usesNicknameVariable", () => {
  it("detects the token", () => {
    assert.strictEqual(usesNicknameVariable("Hi {RECIPIENT_NICKNAME},"), true);
  });

  it("detects a conditional on recipient.nickname", () => {
    assert.strictEqual(usesNicknameVariable('{IF recipient.nickname!=""}Hi{ENDIF}'), true);
  });

  it("scans every argument, skipping empty ones", () => {
    assert.strictEqual(usesNicknameVariable(undefined, "", "{RECIPIENT_NICKNAME}"), true);
  });

  it("returns false for a template that does not ask for it", () => {
    assert.strictEqual(usesNicknameVariable("Hi {RECIPIENT_FIRSTNAME},", "Subject"), false);
  });
});

describe("resolveContactVars", () => {
  const base = {
    recipientName: "Kat",
    recipientFirstname: "Kat",
    recipientEmail: "kat@x.test",
    recipientHasDisplayName: true,
  };

  it("looks the nickname up when the template needs it", async () => {
    messenger.permissions._granted = true;
    messenger.contacts._contacts = [
      { properties: { PrimaryEmail: "kat@x.test", NickName: "Kat" } },
    ];
    const out = await resolveContactVars(base, { nickname: true });
    assert.strictEqual(out.recipientNickname, "Kat");
  });

  it("skips the lookup entirely when nothing is needed", async () => {
    const saved = messenger.contacts.quickSearch;
    messenger.contacts.quickSearch = async () => {
      throw new Error("must not be called");
    };
    const out = await resolveContactVars(base, {});
    assert.strictEqual(out.recipientNickname, undefined);
    messenger.contacts.quickSearch = saved;
  });

  it("skips the lookup when there is no recipient address", async () => {
    const saved = messenger.contacts.quickSearch;
    messenger.contacts.quickSearch = async () => {
      throw new Error("must not be called");
    };
    const out = await resolveContactVars({ recipientEmail: "" }, { nickname: true });
    assert.strictEqual(out.recipientNickname, undefined);
    messenger.contacts.quickSearch = saved;
  });

  it("yields an empty nickname instead of throwing when the lookup fails", async () => {
    const saved = messenger.contacts.quickSearch;
    messenger.contacts.quickSearch = async () => {
      throw new Error("address book on fire");
    };
    const out = await resolveContactVars(base, { nickname: true });
    assert.strictEqual(out.recipientNickname, "");
    messenger.contacts.quickSearch = saved;
  });

  it("replaces a name that was read out of the address", async () => {
    messenger.permissions._granted = true;
    messenger.contacts._contacts = [
      {
        properties: {
          PrimaryEmail: "julia.kalder@ikmail.com",
          DisplayName: "Julia Kalder",
          FirstName: "Julia",
        },
      },
    ];
    const guessed = {
      recipientName: "Julia Kalder",
      recipientFirstname: "Julia",
      recipientEmail: "julia.kalder@ikmail.com",
      recipientHasDisplayName: false,
    };
    const out = await resolveContactVars(guessed, { names: true });
    assert.strictEqual(out.recipientFirstname, "Julia");
    assert.strictEqual(out.recipientName, "Julia Kalder");
  });

  it("never overwrites a display name that came with the recipient", async () => {
    messenger.permissions._granted = true;
    messenger.contacts._contacts = [
      { properties: { PrimaryEmail: "kat@x.test", DisplayName: "Card Name", FirstName: "Card" } },
    ];
    const out = await resolveContactVars(base, { names: true });
    assert.strictEqual(out.recipientName, "Kat");
    assert.strictEqual(out.recipientFirstname, "Kat");
  });
});

describe("buildVariableContext — recipient.nickname", () => {
  it("exposes the nickname for {IF} conditions", () => {
    const ctx = buildVariableContext({
      identityVars: {},
      recipientVars: { recipientEmail: "kat@x.test", recipientNickname: "Kat" },
    });
    assert.strictEqual(ctx.recipient.nickname, "Kat");
  });

  it("defaults to empty string, so the ELSE branch wins", () => {
    const ctx = buildVariableContext({ identityVars: {}, recipientVars: {} });
    assert.strictEqual(ctx.recipient.nickname, "");
    const out = resolveControlFlow(
      '{IF recipient.nickname!=""}Hi nick{ELSE}Dear formal{ENDIF}',
      ctx
    );
    assert.strictEqual(out, "Dear formal");
  });

  it("takes the IF branch once a nickname is present", () => {
    const ctx = buildVariableContext({
      identityVars: {},
      recipientVars: { recipientNickname: "Kat" },
    });
    const out = resolveControlFlow(
      '{IF recipient.nickname!=""}Hi nick{ELSE}Dear formal{ENDIF}',
      ctx
    );
    assert.strictEqual(out, "Hi nick");
  });
});

describe("insertTemplateIntoTab — nickname end to end", () => {
  beforeEach(() => {
    messenger.permissions._granted = true;
    messenger.contacts._contacts = [
      {
        properties: {
          PrimaryEmail: "kat@example.com",
          vCard: "BEGIN:VCARD\r\nEMAIL:kat@example.com\r\nNICKNAME:Kat\r\nEND:VCARD",
        },
      },
    ];
    messenger.compose._details = {
      1: {
        identityId: null,
        isPlainText: false,
        body: "<html><head></head><body></body></html>",
        to: ["Katharina Meier-Lohse <kat@example.com>"],
      },
    };
  });

  it("inserts the address-book nickname of the first To: recipient", async () => {
    await insertTemplateIntoTab(1, {
      id: "t-nick",
      name: "Nick",
      body: "Hi {RECIPIENT_NICKNAME},",
      insertMode: "replace",
      attachments: [],
    });
    assert.strictEqual(messenger.compose._details[1].body, "Hi Kat,");
  });

  it("falls back to the template recipient on a compose window with no To:", async () => {
    messenger.compose._details[1].to = [];
    await insertTemplateIntoTab(1, {
      id: "t-nick",
      name: "Nick",
      body: "Hi {RECIPIENT_NICKNAME},",
      to: ["kat@example.com"],
      insertMode: "replace",
      attachments: [],
    });
    assert.strictEqual(messenger.compose._details[1].body, "Hi Kat,");
  });

  it("leaves the nickname blank when the permission is missing", async () => {
    messenger.permissions._granted = false;
    await insertTemplateIntoTab(1, {
      id: "t-nick",
      name: "Nick",
      body: '{IF recipient.nickname!=""}Hi {RECIPIENT_NICKNAME}{ELSE}Dear {RECIPIENT_FIRSTNAME}{ENDIF}',
      insertMode: "replace",
      attachments: [],
    });
    assert.strictEqual(messenger.compose._details[1].body, "Dear Katharina");
  });

  it("resolves the nickname inside a nested template", async () => {
    await saveTemplate({
      id: "t-inner",
      name: "Greeting",
      body: "Hi {RECIPIENT_NICKNAME},",
      attachments: [],
    });
    await insertTemplateIntoTab(1, {
      id: "t-outer",
      name: "Outer",
      body: "{{template:Greeting}} how are you?",
      insertMode: "replace",
      attachments: [],
    });
    assert.strictEqual(messenger.compose._details[1].body, "Hi Kat, how are you?");
  });
});

// ---- Recipient handling on insert (#229) ----

describe("usesRecipientVariables", () => {
  it("detects any {RECIPIENT_*} token", () => {
    assert.strictEqual(usesRecipientVariables("Hallo {RECIPIENT_FIRSTNAME}"), true);
    assert.strictEqual(usesRecipientVariables("{RECIPIENT_EMAIL}"), true);
    assert.strictEqual(usesRecipientVariables("{RECIPIENT_NICKNAME}"), true);
  });

  it("detects a recipient dot-path in a condition", () => {
    assert.strictEqual(usesRecipientVariables('{IF recipient.domain=="x.test"}a{ENDIF}'), true);
  });

  it("ignores templates that do not address the recipient", () => {
    assert.strictEqual(usesRecipientVariables("Hallo {SENDER_NAME}", "{DATE}"), false);
  });
});

describe("needsRecipientPrompt", () => {
  const greeting = { body: "Hallo {RECIPIENT_FIRSTNAME}," };

  it("asks when the template greets and nothing supplies an address", () => {
    assert.strictEqual(needsRecipientPrompt(greeting, []), true);
  });

  it("stays quiet when the window already has a recipient", () => {
    assert.strictEqual(needsRecipientPrompt(greeting, ["kat@example.com"]), false);
  });

  it("stays quiet when the template names its own recipients", () => {
    // The template author picked those addresses; a dialog would second-guess them.
    assert.strictEqual(needsRecipientPrompt({ ...greeting, to: ["team@x.test"] }, []), false);
  });

  it("stays quiet for a template that never mentions the recipient", () => {
    assert.strictEqual(needsRecipientPrompt({ body: "Hallo {SENDER_NAME}" }, []), false);
  });

  it("treats blank recipient entries as no recipient", () => {
    assert.strictEqual(needsRecipientPrompt(greeting, ["", "   "]), true);
  });

  it("counts an address-book reference as a recipient", () => {
    assert.strictEqual(needsRecipientPrompt(greeting, [{ id: "c1", type: "contact" }]), false);
  });

  it("handles a missing template", () => {
    assert.strictEqual(needsRecipientPrompt(null, []), false);
  });
});

describe("insertTemplateIntoTab — recipients are merged, not replaced", () => {
  function setup(existing) {
    messenger.compose._details = {
      1: {
        identityId: null,
        isPlainText: false,
        body: "<html><head></head><body></body></html>",
        ...existing,
      },
    };
  }

  it("keeps the recipient the user picked before inserting", async () => {
    setup({ to: ["Katharina <kat@example.com>"] });
    await insertTemplateIntoTab(1, {
      id: "t1",
      name: "Team",
      body: "Text",
      to: ["team@example.org"],
      insertMode: "replace",
      attachments: [],
    });
    assert.deepStrictEqual(messenger.compose._details[1].to, [
      "Katharina <kat@example.com>",
      "team@example.org",
    ]);
  });

  it("merges cc and bcc the same way", async () => {
    setup({ cc: ["a@x.test"], bcc: ["b@x.test"] });
    await insertTemplateIntoTab(1, {
      id: "t1",
      name: "T",
      body: "Text",
      cc: ["c@x.test"],
      bcc: ["b@x.test"],
      insertMode: "replace",
      attachments: [],
    });
    assert.deepStrictEqual(messenger.compose._details[1].cc, ["a@x.test", "c@x.test"]);
    assert.deepStrictEqual(messenger.compose._details[1].bcc, ["b@x.test"]);
  });

  it("leaves the recipient fields untouched when the template brings none", async () => {
    setup({ to: ["kat@example.com"] });
    await insertTemplateIntoTab(1, {
      id: "t1",
      name: "T",
      body: "Text",
      insertMode: "replace",
      attachments: [],
    });
    assert.deepStrictEqual(messenger.compose._details[1].to, ["kat@example.com"]);
  });

  it("resolves variables against the existing recipient, not the template's", async () => {
    setup({ to: ["Katharina Meier <kat@example.com>"] });
    await insertTemplateIntoTab(1, {
      id: "t1",
      name: "T",
      body: "Hallo {RECIPIENT_FIRSTNAME},",
      to: ["team@example.org"],
      insertMode: "replace",
      attachments: [],
    });
    assert.strictEqual(messenger.compose._details[1].body, "Hallo Katharina,");
  });

  it("uses the answered recipient when the window has none", async () => {
    setup({ to: [] });
    await insertTemplateIntoTab(
      1,
      {
        id: "t1",
        name: "T",
        body: "Hallo {RECIPIENT_FIRSTNAME},",
        insertMode: "replace",
        attachments: [],
      },
      { recipient: "Bernd Beispiel <bernd@example.com>" }
    );
    assert.strictEqual(messenger.compose._details[1].body, "Hallo Bernd,");
    assert.deepStrictEqual(messenger.compose._details[1].to, [
      "Bernd Beispiel <bernd@example.com>",
    ]);
  });

  it("puts the answered recipient ahead of the template's own", async () => {
    setup({ to: [] });
    await insertTemplateIntoTab(
      1,
      {
        id: "t1",
        name: "T",
        body: "Text",
        to: ["team@example.org"],
        insertMode: "replace",
        attachments: [],
      },
      { recipient: "bernd@example.com" }
    );
    assert.deepStrictEqual(messenger.compose._details[1].to, [
      "bernd@example.com",
      "team@example.org",
    ]);
  });

  it("ignores a blank answer and falls back to the template recipient", async () => {
    setup({ to: [] });
    await insertTemplateIntoTab(
      1,
      {
        id: "t1",
        name: "T",
        body: "Hallo {RECIPIENT_FIRSTNAME},",
        to: ["Team Sales <team@example.org>"],
        insertMode: "replace",
        attachments: [],
      },
      { recipient: "   " }
    );
    assert.strictEqual(messenger.compose._details[1].body, "Hallo Team,");
  });
});

// ---- Names read out of a bare address, and corrected from the card ----

describe("insertTemplateIntoTab — bare address in To:", () => {
  function setup() {
    messenger.compose._details = {
      1: {
        identityId: null,
        isPlainText: false,
        body: "<html><head></head><body></body></html>",
        to: ["julia.kalder@ikmail.com"],
      },
    };
  }

  it("greets with a name read out of the address when no contact is known", async () => {
    // The bug from the 2.9.0 test run: this used to insert "julia.kalder".
    messenger.permissions._granted = false;
    setup();
    await insertTemplateIntoTab(1, {
      id: "t1",
      name: "T",
      body: "Hallo {RECIPIENT_FIRSTNAME},",
      insertMode: "replace",
      attachments: [],
    });
    assert.strictEqual(messenger.compose._details[1].body, "Hallo Julia,");
  });

  it("prefers the contact card's given name over the guess", async () => {
    messenger.permissions._granted = true;
    messenger.contacts._contacts = [
      {
        properties: {
          PrimaryEmail: "julia.kalder@ikmail.com",
          DisplayName: "Julia Kalder",
          FirstName: "Juliane",
          NickName: "Juli",
        },
      },
    ];
    setup();
    await insertTemplateIntoTab(1, {
      id: "t1",
      name: "T",
      body: "Hallo {RECIPIENT_FIRSTNAME} ({RECIPIENT_NICKNAME}),",
      insertMode: "replace",
      attachments: [],
    });
    assert.strictEqual(messenger.compose._details[1].body, "Hallo Juliane (Juli),");
  });

  it("does not touch the address book for a template without recipient variables", async () => {
    messenger.permissions._granted = true;
    const saved = messenger.contacts.quickSearch;
    messenger.contacts.quickSearch = async () => {
      throw new Error("must not be called");
    };
    setup();
    await insertTemplateIntoTab(1, {
      id: "t1",
      name: "T",
      body: "Hallo zusammen,",
      insertMode: "replace",
      attachments: [],
    });
    assert.strictEqual(messenger.compose._details[1].body, "Hallo zusammen,");
    messenger.contacts.quickSearch = saved;
  });
});
