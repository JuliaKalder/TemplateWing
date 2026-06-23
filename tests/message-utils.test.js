import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findPart,
  extractBody,
  parseRecipient,
  stripReplyForwardPrefix,
  quotePlaintext,
  quoteHtml,
} from "../modules/message-utils.js";

// ---- findPart ----

describe("findPart", () => {
  it("returns body when top-level part matches contentType", () => {
    const part = { contentType: "text/plain", body: "hello" };
    assert.strictEqual(findPart(part, "text/plain"), "hello");
  });

  it("returns null when top-level part does not match", () => {
    const part = { contentType: "text/plain", body: "hello" };
    assert.strictEqual(findPart(part, "text/html"), null);
  });

  it("returns null when matching part has no body", () => {
    const part = { contentType: "text/html" };
    assert.strictEqual(findPart(part, "text/html"), null);
  });

  it("finds a nested part matching contentType", () => {
    const part = {
      contentType: "multipart/alternative",
      parts: [
        { contentType: "text/plain", body: "plain text" },
        { contentType: "text/html", body: "<p>html</p>" },
      ],
    };
    assert.strictEqual(findPart(part, "text/html"), "<p>html</p>");
  });

  it("finds a deeply nested part", () => {
    const part = {
      contentType: "multipart/mixed",
      parts: [
        {
          contentType: "multipart/alternative",
          parts: [
            { contentType: "text/plain", body: "plain" },
            { contentType: "text/html", body: "<b>deep</b>" },
          ],
        },
      ],
    };
    assert.strictEqual(findPart(part, "text/html"), "<b>deep</b>");
  });

  it("returns first match when multiple parts have same contentType", () => {
    const part = {
      contentType: "multipart/mixed",
      parts: [
        { contentType: "text/plain", body: "first" },
        { contentType: "text/plain", body: "second" },
      ],
    };
    assert.strictEqual(findPart(part, "text/plain"), "first");
  });
});

// ---- extractBody ----

describe("extractBody", () => {
  it("prefers HTML over plain text", () => {
    const part = {
      contentType: "multipart/alternative",
      parts: [
        { contentType: "text/plain", body: "plain" },
        { contentType: "text/html", body: "<p>html</p>" },
      ],
    };
    assert.deepStrictEqual(extractBody(part), { html: true, body: "<p>html</p>" });
  });

  it("falls back to plain text when no HTML is present", () => {
    const part = {
      contentType: "multipart/alternative",
      parts: [{ contentType: "text/plain", body: "just plain" }],
    };
    assert.deepStrictEqual(extractBody(part), { html: false, body: "just plain" });
  });

  it("returns null when neither HTML nor plain text is present", () => {
    const part = {
      contentType: "multipart/mixed",
      parts: [{ contentType: "image/png", body: "binarydata" }],
    };
    assert.strictEqual(extractBody(part), null);
  });

  it("returns HTML directly from a top-level part", () => {
    const part = { contentType: "text/html", body: "<em>direct</em>" };
    assert.deepStrictEqual(extractBody(part), { html: true, body: "<em>direct</em>" });
  });

  it("returns plain text directly from a top-level part when no HTML", () => {
    const part = { contentType: "text/plain", body: "direct plain" };
    assert.deepStrictEqual(extractBody(part), { html: false, body: "direct plain" });
  });
});

// ---- parseRecipient ----

describe("parseRecipient", () => {
  it("parses bare 'user@example.com'", () => {
    const p = parseRecipient("jane@example.com");
    assert.strictEqual(p.email, "jane@example.com");
    assert.strictEqual(p.name, "jane");
    assert.strictEqual(p.firstname, "jane");
    assert.strictEqual(p.domain, "example.com");
  });

  it("parses 'Display Name <user@example.com>'", () => {
    const p = parseRecipient("Jane Doe <jane@example.com>");
    assert.strictEqual(p.name, "Jane Doe");
    assert.strictEqual(p.firstname, "Jane");
    assert.strictEqual(p.email, "jane@example.com");
  });

  it("strips outer quotes from display name", () => {
    const p = parseRecipient('"Doe, Jane" <jane@example.com>');
    assert.strictEqual(p.name, "Doe, Jane");
    assert.strictEqual(p.firstname, "Doe,");
  });

  it("falls back to local-part as name when no display name", () => {
    const p = parseRecipient("first.last@x.com");
    assert.strictEqual(p.name, "first.last");
    assert.strictEqual(p.firstname, "first.last");
  });

  it("returns null for empty/invalid input", () => {
    assert.strictEqual(parseRecipient(""), null);
    assert.strictEqual(parseRecipient(null), null);
    assert.strictEqual(parseRecipient("not-an-email"), null);
  });
});

// ---- stripReplyForwardPrefix ----

describe("stripReplyForwardPrefix", () => {
  it("strips 'Re:' prefix", () => {
    assert.strictEqual(stripReplyForwardPrefix("Re: Project update"), "Project update");
  });
  it("strips repeated 'Re: Re:'", () => {
    assert.strictEqual(stripReplyForwardPrefix("Re: Re: hello"), "hello");
  });
  it("strips 'Fwd:' prefix", () => {
    assert.strictEqual(stripReplyForwardPrefix("Fwd: hi"), "hi");
  });
  it("strips German 'AW:' prefix", () => {
    assert.strictEqual(stripReplyForwardPrefix("AW: Termin"), "Termin");
  });
  it("strips German 'WG:' prefix", () => {
    assert.strictEqual(stripReplyForwardPrefix("WG: Termin"), "Termin");
  });
  it("returns original when no prefix present", () => {
    assert.strictEqual(stripReplyForwardPrefix("Hello"), "Hello");
  });
  it("returns empty string for empty input", () => {
    assert.strictEqual(stripReplyForwardPrefix(""), "");
  });
});

// ---- quotePlaintext / quoteHtml ----

describe("quotePlaintext", () => {
  it("prefixes every non-empty line with '> '", () => {
    assert.strictEqual(quotePlaintext("hello\nworld"), "> hello\n> world");
  });
  it("uses bare '>' for blank lines", () => {
    assert.strictEqual(quotePlaintext("a\n\nb"), "> a\n>\n> b");
  });
  it("returns empty string for empty input", () => {
    assert.strictEqual(quotePlaintext(""), "");
  });
});

describe("quoteHtml", () => {
  it("wraps content in a cite blockquote", () => {
    assert.strictEqual(quoteHtml("<p>hi</p>"), '<blockquote type="cite"><p>hi</p></blockquote>');
  });
  it("returns empty string for empty input", () => {
    assert.strictEqual(quoteHtml(""), "");
  });
});
