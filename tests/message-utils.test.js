import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findPart, extractBody } from "../modules/message-utils.js";

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
