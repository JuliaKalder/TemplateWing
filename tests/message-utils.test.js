import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findPart,
  extractBody,
  parseRecipient,
  nameFromLocalPart,
  recipientKey,
  mergeRecipients,
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
    // Capitalised: this name goes into a greeting, and "jane" reads as a bug.
    assert.strictEqual(p.name, "Jane");
    assert.strictEqual(p.firstname, "Jane");
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

  it("reads a name out of the local part when no display name is present", () => {
    const p = parseRecipient("first.last@x.com");
    assert.strictEqual(p.name, "First Last");
    assert.strictEqual(p.firstname, "First");
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

// ---- recipientKey / mergeRecipients ----

describe("recipientKey", () => {
  it("keys a plain address by itself, lower-cased", () => {
    assert.strictEqual(recipientKey("Jane@Example.com"), "jane@example.com");
  });

  it("keys a named address by the address alone", () => {
    assert.strictEqual(recipientKey("Jane Doe <Jane@Example.com>"), "jane@example.com");
  });

  it("keys an address-book reference by type and id", () => {
    assert.strictEqual(recipientKey({ id: "abc", type: "mailingList" }), "mailingList:abc");
  });

  it("falls back to the raw text for something unparseable", () => {
    assert.strictEqual(recipientKey("Team Sales"), "team sales");
  });

  it("returns empty string for nothing", () => {
    assert.strictEqual(recipientKey(""), "");
    assert.strictEqual(recipientKey(null), "");
    assert.strictEqual(recipientKey({}), "");
  });
});

describe("mergeRecipients", () => {
  it("keeps existing recipients ahead of the template's", () => {
    const merged = mergeRecipients(["kat@example.com"], ["team@example.org"]);
    assert.deepStrictEqual(merged, ["kat@example.com", "team@example.org"]);
  });

  it("does not drop the recipient the user picked by hand", () => {
    // The regression this function exists for: assigning template.to used to
    // delete whatever the user had already chosen.
    const merged = mergeRecipients(["Katharina <kat@example.com>"], ["info@example.org"]);
    assert.ok(merged.includes("Katharina <kat@example.com>"));
  });

  it("drops a duplicate address regardless of display name", () => {
    const merged = mergeRecipients(["Kat <kat@example.com>"], ["kat@example.com"]);
    assert.deepStrictEqual(merged, ["Kat <kat@example.com>"]);
  });

  it("de-duplicates case-insensitively", () => {
    const merged = mergeRecipients(["KAT@example.com"], ["kat@Example.com"]);
    assert.strictEqual(merged.length, 1);
  });

  it("skips empty entries", () => {
    assert.deepStrictEqual(mergeRecipients(["", "  "], ["a@b.test"]), ["a@b.test"]);
  });

  it("keeps address-book references and plain addresses side by side", () => {
    const ref = { id: "c1", type: "contact" };
    assert.deepStrictEqual(mergeRecipients([ref], ["a@b.test"]), [ref, "a@b.test"]);
  });

  it("tolerates missing lists", () => {
    assert.deepStrictEqual(mergeRecipients(undefined, ["a@b.test"]), ["a@b.test"]);
    assert.deepStrictEqual(mergeRecipients(["a@b.test"], undefined), ["a@b.test"]);
    assert.deepStrictEqual(mergeRecipients(null, null), []);
  });

  it("does not mutate its inputs", () => {
    const existing = ["a@b.test"];
    const incoming = ["c@d.test"];
    mergeRecipients(existing, incoming);
    assert.deepStrictEqual(existing, ["a@b.test"]);
    assert.deepStrictEqual(incoming, ["c@d.test"]);
  });
});

// ---- nameFromLocalPart ----

describe("nameFromLocalPart", () => {
  it("turns a first.last address into a readable name", () => {
    assert.strictEqual(nameFromLocalPart("julia.kalder@ikmail.com"), "Julia Kalder");
  });

  it("handles underscores, hyphens and plus tags as word boundaries", () => {
    assert.strictEqual(nameFromLocalPart("julia_kalder@x.test"), "Julia Kalder");
    assert.strictEqual(nameFromLocalPart("no-reply@x.test"), "No Reply");
  });

  it("capitalises non-ASCII letters correctly", () => {
    assert.strictEqual(nameFromLocalPart("über.müller@x.de"), "Über Müller");
  });

  it("drops initials and tokens carrying digits", () => {
    assert.strictEqual(nameFromLocalPart("k.meier@x.test"), "Meier");
    assert.strictEqual(nameFromLocalPart("julia.kalder2@x.test"), "Julia");
  });

  it("falls back to the raw local part when no token qualifies", () => {
    assert.strictEqual(nameFromLocalPart("user42@x.test"), "user42");
    assert.strictEqual(nameFromLocalPart("a.b@x.test"), "a.b");
  });

  it("returns empty string for nothing", () => {
    assert.strictEqual(nameFromLocalPart(""), "");
    assert.strictEqual(nameFromLocalPart(null), "");
  });
});

describe("parseRecipient — hasDisplayName", () => {
  it("is true when the recipient carried a display name", () => {
    assert.strictEqual(parseRecipient("Julia Kalder <j@x.test>").hasDisplayName, true);
  });

  it("is false for a bare address, and the name is derived", () => {
    const parsed = parseRecipient("julia.kalder@ikmail.com");
    assert.strictEqual(parsed.hasDisplayName, false);
    assert.strictEqual(parsed.name, "Julia Kalder");
    assert.strictEqual(parsed.firstname, "Julia");
  });
});
