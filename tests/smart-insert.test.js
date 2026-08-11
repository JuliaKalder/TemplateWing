import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { installMessengerMock, uninstallMessengerMock } from "./_mock-messenger.js";

// template-insert.js imports template-store.js lazily; the mock isn't
// strictly needed for the pure helpers but keeps the import graph happy.
installMessengerMock();

const { smartInsertHtml, smartInsertPlaintext, insertHtmlAtBodyStart, insertHtmlAtBodyEnd } =
  await import("../modules/template-insert.js");

after(() => uninstallMessengerMock());

// ---- smartInsertHtml ----

describe("smartInsertHtml", () => {
  it("inserts before a moz-cite-prefix div", () => {
    const body =
      "<p>User typed reply</p>" +
      '<div class="moz-cite-prefix">On 2026-04-17, Alice wrote:</div>' +
      "<blockquote>quoted</blockquote>";
    const result = smartInsertHtml(body, "<p>TEMPLATE</p>");
    const citeIdx = result.indexOf("moz-cite-prefix");
    const tmplIdx = result.indexOf("TEMPLATE");
    assert.ok(tmplIdx !== -1 && citeIdx !== -1, "both present");
    assert.ok(tmplIdx < citeIdx, "template inserted before cite-prefix");
    // The user's existing text should still be present, unchanged, ahead of
    // the inserted template.
    assert.ok(result.indexOf("User typed reply") < tmplIdx);
  });

  it("inserts before a moz-signature div when no cite-prefix exists", () => {
    const body = "<p>Hello</p>" + '<div class="moz-signature">--<br>Jane</div>';
    const result = smartInsertHtml(body, "<p>TEMPLATE</p>");
    const sigIdx = result.indexOf("moz-signature");
    const tmplIdx = result.indexOf("TEMPLATE");
    assert.ok(tmplIdx !== -1 && sigIdx !== -1);
    assert.ok(tmplIdx < sigIdx, "template inserted before signature");
    assert.ok(result.indexOf("Hello") < tmplIdx, "Hello stays first");
  });

  it("inserts before the earlier of cite-prefix and signature", () => {
    // Signature appears BEFORE cite-prefix (unusual ordering) — helper must
    // still pick the earlier anchor to avoid landing after the signature.
    const body =
      '<div class="moz-signature">--<br>Jane</div>' +
      '<div class="moz-cite-prefix">On ...</div>' +
      "<blockquote>q</blockquote>";
    const result = smartInsertHtml(body, "<p>TEMPLATE</p>");
    const tmplIdx = result.indexOf("TEMPLATE");
    const sigIdx = result.indexOf("moz-signature");
    assert.ok(tmplIdx < sigIdx, "template before signature (earlier anchor)");
  });

  it("appends when no cite-prefix and no signature", () => {
    const body = "<p>Just some typing</p>";
    const result = smartInsertHtml(body, "<p>TEMPLATE</p>");
    assert.strictEqual(result, "<p>Just some typing</p><p>TEMPLATE</p>");
  });

  it("returns the insert when existingBody is empty", () => {
    assert.strictEqual(smartInsertHtml("", "<p>TEMPLATE</p>"), "<p>TEMPLATE</p>");
    assert.strictEqual(smartInsertHtml(null, "<p>TEMPLATE</p>"), "<p>TEMPLATE</p>");
    assert.strictEqual(smartInsertHtml(undefined, "<p>TEMPLATE</p>"), "<p>TEMPLATE</p>");
  });

  it("returns the body when insertHtml is empty", () => {
    assert.strictEqual(smartInsertHtml("<p>Body</p>", ""), "<p>Body</p>");
    assert.strictEqual(smartInsertHtml("<p>Body</p>", null), "<p>Body</p>");
    assert.strictEqual(smartInsertHtml("<p>Body</p>", undefined), "<p>Body</p>");
  });

  it("returns empty string when both inputs are empty", () => {
    assert.strictEqual(smartInsertHtml("", ""), "");
    assert.strictEqual(smartInsertHtml(null, null), "");
  });

  it("matches moz-cite-prefix with additional classes and single quotes", () => {
    const body = "<p>X</p><div class='foo moz-cite-prefix bar'>On ...</div>";
    const result = smartInsertHtml(body, "<p>T</p>");
    assert.ok(result.indexOf("<p>T</p>") < result.indexOf("moz-cite-prefix"));
  });

  it("does not match unrelated classes that happen to contain substrings", () => {
    const body = '<p>X</p><div class="not-moz-cite-prefixy">x</div>';
    const result = smartInsertHtml(body, "<p>T</p>");
    // \b word boundary keeps "not-moz-cite-prefixy" from matching
    // "moz-cite-prefix" because "prefixy" extends past the boundary.
    assert.strictEqual(result, body + "<p>T</p>", "should append");
  });
});

// ---- smartInsertPlaintext ----

describe("smartInsertPlaintext", () => {
  it("inserts before a -- sig delimiter in the middle of the body", () => {
    const body = "Hello\n\n-- \nJane\n";
    const result = smartInsertPlaintext(body, "TEMPLATE");
    const tmplIdx = result.indexOf("TEMPLATE");
    const sigIdx = result.indexOf("-- \n");
    assert.ok(tmplIdx !== -1 && sigIdx !== -1);
    assert.ok(tmplIdx < sigIdx, "template inserted before signature");
    // Hello text should come first, then the inserted template, then sig.
    assert.ok(result.indexOf("Hello") < tmplIdx);
  });

  it("inserts before a > quote prefix line", () => {
    const body = "My reply\n> original message\n> line two\n";
    const result = smartInsertPlaintext(body, "TEMPLATE");
    const tmplIdx = result.indexOf("TEMPLATE");
    const quoteIdx = result.indexOf("> original");
    assert.ok(tmplIdx !== -1);
    assert.ok(tmplIdx < quoteIdx, "template inserted before quote");
    assert.ok(result.indexOf("My reply") < tmplIdx);
  });

  it("appends when neither signature nor quote is present", () => {
    const body = "Just plain content";
    const result = smartInsertPlaintext(body, "TEMPLATE");
    assert.strictEqual(result, "Just plain contentTEMPLATE");
  });

  it("does not double the trailing newline when insert already ends with \\n", () => {
    const body = "Body\n-- \nSig\n";
    const result = smartInsertPlaintext(body, "TEMPLATE\n");
    const idx = result.indexOf("-- \n");
    // The segment just before "-- \n" must be "TEMPLATE\n" (not "TEMPLATE\n\n").
    assert.strictEqual(result.slice(idx - "TEMPLATE\n".length, idx), "TEMPLATE\n");
  });

  it("adds a trailing newline when insert does not end with \\n", () => {
    const body = "Body\n-- \nSig\n";
    const result = smartInsertPlaintext(body, "TEMPLATE");
    const idx = result.indexOf("-- \n");
    assert.strictEqual(result.slice(idx - "TEMPLATE\n".length, idx), "TEMPLATE\n");
  });

  it("handles a sig delimiter at the very start of the body (no leading newline)", () => {
    // This is the (^|\n)"-- \n" anchor with NO leading newline — must still match.
    const body = "-- \nSig only\n";
    const result = smartInsertPlaintext(body, "TEMPLATE");
    assert.ok(result.startsWith("TEMPLATE"), "template at very start");
    assert.ok(result.indexOf("-- \n") > result.indexOf("TEMPLATE"));
  });

  it("handles a quote prefix at the very start of the body", () => {
    const body = "> quoted from the top\n> line two\n";
    const result = smartInsertPlaintext(body, "TEMPLATE");
    assert.ok(result.startsWith("TEMPLATE"));
    assert.ok(result.indexOf("> quoted") > result.indexOf("TEMPLATE"));
  });

  it("picks the earlier of signature and quote when both are present", () => {
    // quote at pos 6, sig at pos ~26 -> should insert before the quote.
    const body = "Reply\n> q one\n> q two\n-- \nSig\n";
    const result = smartInsertPlaintext(body, "TEMPLATE");
    const tmplIdx = result.indexOf("TEMPLATE");
    const quoteIdx = result.indexOf("> q one");
    const sigIdx = result.indexOf("-- \n");
    assert.ok(tmplIdx < quoteIdx && quoteIdx < sigIdx);
  });

  it("returns the insert when existingBody is empty", () => {
    assert.strictEqual(smartInsertPlaintext("", "TEMPLATE"), "TEMPLATE");
    assert.strictEqual(smartInsertPlaintext(null, "TEMPLATE"), "TEMPLATE");
  });

  it("returns the body when insertText is empty", () => {
    assert.strictEqual(smartInsertPlaintext("Body", ""), "Body");
    assert.strictEqual(smartInsertPlaintext("Body", null), "Body");
  });

  it("returns empty string when both inputs are empty", () => {
    assert.strictEqual(smartInsertPlaintext("", ""), "");
    assert.strictEqual(smartInsertPlaintext(null, null), "");
  });
});

// ---- Body-tag splicing (issue #221) ----

// Shape of what compose.getComposeDetails() hands back for a fresh HTML
// compose window: a full document, signature inside <body>.
const COMPOSE_DOC =
  '<html><head><meta http-equiv="content-type" content="text/html; charset=UTF-8"></head>' +
  '<body><p><br></p><div class="moz-signature">-- <br>Alice</div></body></html>';

describe("insertHtmlAtBodyStart", () => {
  it("inserts after the <body> start tag, not before <html>", () => {
    const result = insertHtmlAtBodyStart(COMPOSE_DOC, "<p>TEMPLATE</p>");
    const bodyIdx = result.indexOf("<body>");
    const tmplIdx = result.indexOf("TEMPLATE");
    assert.ok(bodyIdx !== -1 && tmplIdx !== -1);
    assert.ok(tmplIdx > bodyIdx, "template must land inside <body>, not in the head");
    // Nothing may precede the document wrapper.
    assert.ok(result.startsWith("<html>"));
  });

  it("puts the template ahead of existing body content and the signature", () => {
    const result = insertHtmlAtBodyStart(COMPOSE_DOC, "<p>TEMPLATE</p>");
    assert.ok(result.indexOf("TEMPLATE") < result.indexOf("moz-signature"));
    assert.ok(result.indexOf("TEMPLATE") < result.indexOf("<p><br></p>"));
  });

  it("handles a <body> tag carrying attributes", () => {
    const doc = '<html><body bgcolor="#ffffff" dir="ltr"><p>old</p></body></html>';
    const result = insertHtmlAtBodyStart(doc, "<p>NEW</p>");
    assert.strictEqual(
      result,
      '<html><body bgcolor="#ffffff" dir="ltr"><p>NEW</p><p>old</p></body></html>'
    );
  });

  it("matches <BODY> case-insensitively", () => {
    const result = insertHtmlAtBodyStart("<HTML><BODY><p>old</p></BODY></HTML>", "X");
    assert.strictEqual(result, "<HTML><BODY>X<p>old</p></BODY></HTML>");
  });

  it("falls back to concatenation for a bare fragment", () => {
    assert.strictEqual(insertHtmlAtBodyStart("<p>old</p>", "<p>NEW</p>"), "<p>NEW</p><p>old</p>");
  });

  it("handles empty inputs", () => {
    assert.strictEqual(insertHtmlAtBodyStart("", "<p>NEW</p>"), "<p>NEW</p>");
    assert.strictEqual(insertHtmlAtBodyStart(null, "<p>NEW</p>"), "<p>NEW</p>");
    assert.strictEqual(insertHtmlAtBodyStart(COMPOSE_DOC, ""), COMPOSE_DOC);
    assert.strictEqual(insertHtmlAtBodyStart("", ""), "");
  });
});

describe("insertHtmlAtBodyEnd", () => {
  it("inserts before </body>, keeping the document wrapper intact", () => {
    const result = insertHtmlAtBodyEnd(COMPOSE_DOC, "<p>TEMPLATE</p>");
    assert.ok(result.endsWith("</body></html>"));
    assert.ok(result.indexOf("TEMPLATE") > result.indexOf("moz-signature"));
    assert.ok(result.indexOf("TEMPLATE") < result.indexOf("</body>"));
  });

  it("uses the last </body> when a quoted reply carries one", () => {
    const doc = "<html><body><blockquote>a</body>b</blockquote>c</body></html>";
    const result = insertHtmlAtBodyEnd(doc, "X");
    assert.strictEqual(result, "<html><body><blockquote>a</body>b</blockquote>cX</body></html>");
  });

  it("falls back to concatenation for a bare fragment", () => {
    assert.strictEqual(insertHtmlAtBodyEnd("<p>old</p>", "<p>NEW</p>"), "<p>old</p><p>NEW</p>");
  });

  it("handles empty inputs", () => {
    assert.strictEqual(insertHtmlAtBodyEnd("", "<p>NEW</p>"), "<p>NEW</p>");
    assert.strictEqual(insertHtmlAtBodyEnd(COMPOSE_DOC, ""), COMPOSE_DOC);
    assert.strictEqual(insertHtmlAtBodyEnd(null, null), "");
  });
});
