import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { installMessengerMock, uninstallMessengerMock } from "./_mock-messenger.js";

installMessengerMock();

const {
  nicknameFromVCard,
  emailsFromVCard,
  contactHasEmail,
  nicknameFromContact,
  hasAddressBookPermission,
  lookupNicknameByEmail,
} = await import("../modules/address-book.js");

after(() => {
  uninstallMessengerMock();
});

function vcard(...lines) {
  return ["BEGIN:VCARD", "VERSION:4.0", ...lines, "END:VCARD"].join("\r\n");
}

describe("nicknameFromVCard", () => {
  it("reads a plain NICKNAME line", () => {
    assert.strictEqual(nicknameFromVCard(vcard("FN:Katharina Meier", "NICKNAME:Kat")), "Kat");
  });

  it("ignores parameters and group prefixes on the property name", () => {
    assert.strictEqual(nicknameFromVCard(vcard("item1.NICKNAME;TYPE=work:Kat")), "Kat");
  });

  it("takes the first entry of a comma-separated list", () => {
    assert.strictEqual(nicknameFromVCard(vcard("NICKNAME:Kat,Kate")), "Kat");
  });

  it("keeps an escaped comma inside one value", () => {
    assert.strictEqual(nicknameFromVCard(vcard("NICKNAME:Meier\\, Kat")), "Meier, Kat");
  });

  it("unfolds a wrapped value", () => {
    assert.strictEqual(nicknameFromVCard(vcard("NICKNAME:Kat", " harina")), "Katharina");
  });

  it("is case-insensitive on the property name", () => {
    assert.strictEqual(nicknameFromVCard(vcard("nickname:Kat")), "Kat");
  });

  it("skips an empty NICKNAME and keeps looking", () => {
    assert.strictEqual(nicknameFromVCard(vcard("NICKNAME:", "NICKNAME:Kat")), "Kat");
  });

  it("returns empty string for a card without a nickname", () => {
    assert.strictEqual(nicknameFromVCard(vcard("FN:Jane Doe")), "");
  });

  it("does not confuse a colon inside a quoted parameter for the value separator", () => {
    assert.strictEqual(nicknameFromVCard(vcard('NICKNAME;X-LABEL="a:b":Kat')), "Kat");
  });

  it("tolerates null, empty and garbage input", () => {
    assert.strictEqual(nicknameFromVCard(null), "");
    assert.strictEqual(nicknameFromVCard(""), "");
    assert.strictEqual(nicknameFromVCard("not a vcard at all"), "");
  });
});

describe("emailsFromVCard", () => {
  it("collects and lower-cases every EMAIL value", () => {
    const card = vcard("EMAIL;TYPE=work:Jane@Example.COM", "EMAIL;TYPE=home:jd@home.test");
    assert.deepStrictEqual(emailsFromVCard(card), ["jane@example.com", "jd@home.test"]);
  });

  it("returns an empty list when there is no EMAIL line", () => {
    assert.deepStrictEqual(emailsFromVCard(vcard("FN:Jane")), []);
  });
});

describe("contactHasEmail", () => {
  it("matches the legacy PrimaryEmail property, case-insensitively", () => {
    const contact = { properties: { PrimaryEmail: "Jane@Example.com" } };
    assert.strictEqual(contactHasEmail(contact, "jane@example.com"), true);
  });

  it("matches SecondEmail", () => {
    const contact = { properties: { PrimaryEmail: "a@b.test", SecondEmail: "jane@example.com" } };
    assert.strictEqual(contactHasEmail(contact, "jane@example.com"), true);
  });

  it("matches an address that only exists in the vCard", () => {
    const contact = { properties: { vCard: vcard("EMAIL:jane@example.com") } };
    assert.strictEqual(contactHasEmail(contact, "jane@example.com"), true);
  });

  it("rejects a contact that merely mentions the address in another field", () => {
    const contact = { properties: { Notes: "write to jane@example.com", vCard: vcard("FN:Bob") } };
    assert.strictEqual(contactHasEmail(contact, "jane@example.com"), false);
  });
});

describe("nicknameFromContact", () => {
  it("prefers the legacy NickName property when present", () => {
    const contact = { properties: { NickName: "Legacy", vCard: vcard("NICKNAME:FromCard") } };
    assert.strictEqual(nicknameFromContact(contact), "Legacy");
  });

  it("falls back to the vCard when the legacy property is blank", () => {
    const contact = { properties: { NickName: "   ", vCard: vcard("NICKNAME:FromCard") } };
    assert.strictEqual(nicknameFromContact(contact), "FromCard");
  });

  it("returns empty string for a contact with no properties", () => {
    assert.strictEqual(nicknameFromContact({}), "");
    assert.strictEqual(nicknameFromContact(null), "");
  });
});

describe("lookupNicknameByEmail", () => {
  const kat = {
    properties: {
      PrimaryEmail: "kat@example.com",
      vCard: vcard("FN:Katharina Meier-Lohse", "EMAIL:kat@example.com", "NICKNAME:Kat"),
    },
  };

  beforeEach(() => {
    messenger.permissions._granted = true;
    messenger.contacts._contacts = [kat];
  });

  it("returns the nickname of the matching contact", async () => {
    assert.strictEqual(await lookupNicknameByEmail("kat@example.com"), "Kat");
  });

  it("matches case-insensitively", async () => {
    assert.strictEqual(await lookupNicknameByEmail("KAT@Example.com"), "Kat");
  });

  it("returns empty string when the permission is not granted", async () => {
    messenger.permissions._granted = false;
    assert.strictEqual(await lookupNicknameByEmail("kat@example.com"), "");
  });

  it("returns empty string when no contact matches", async () => {
    assert.strictEqual(await lookupNicknameByEmail("nobody@example.com"), "");
  });

  it("returns empty string when the contact has no nickname", async () => {
    messenger.contacts._contacts = [
      { properties: { PrimaryEmail: "no@example.com", vCard: vcard("FN:No Nick") } },
    ];
    assert.strictEqual(await lookupNicknameByEmail("no@example.com"), "");
  });

  it("skips a contact that matched on another field and keeps searching", async () => {
    messenger.contacts._contacts = [
      { properties: { Notes: "cc kat@example.com", vCard: vcard("NICKNAME:Wrong") } },
      kat,
    ];
    assert.strictEqual(await lookupNicknameByEmail("kat@example.com"), "Kat");
  });

  it("returns empty string for a blank address without touching the API", async () => {
    messenger.contacts.quickSearch = async () => {
      throw new Error("must not be called");
    };
    assert.strictEqual(await lookupNicknameByEmail(""), "");
    assert.strictEqual(await lookupNicknameByEmail(null), "");
    delete messenger.contacts.quickSearch;
    messenger.contacts.quickSearch = createQuickSearch();
  });

  it("falls back to the legacy string signature of quickSearch", async () => {
    const calls = [];
    messenger.contacts.quickSearch = async (arg) => {
      calls.push(arg);
      if (typeof arg !== "string") throw new Error("queryInfo form unsupported");
      return [kat];
    };
    assert.strictEqual(await lookupNicknameByEmail("kat@example.com"), "Kat");
    assert.strictEqual(calls.length, 2);
    messenger.contacts.quickSearch = createQuickSearch();
  });

  it("returns empty string when both quickSearch signatures fail", async () => {
    messenger.contacts.quickSearch = async () => {
      throw new Error("nope");
    };
    assert.strictEqual(await lookupNicknameByEmail("kat@example.com"), "");
    messenger.contacts.quickSearch = createQuickSearch();
  });

  it("returns empty string when the contacts API is missing entirely", async () => {
    const saved = messenger.contacts;
    delete messenger.contacts;
    assert.strictEqual(await lookupNicknameByEmail("kat@example.com"), "");
    messenger.contacts = saved;
  });
});

describe("hasAddressBookPermission", () => {
  it("returns false when the permissions API is absent", async () => {
    const saved = messenger.permissions;
    delete messenger.permissions;
    assert.strictEqual(await hasAddressBookPermission(), false);
    messenger.permissions = saved;
  });

  it("returns false when contains() throws", async () => {
    const saved = messenger.permissions.contains;
    messenger.permissions.contains = async () => {
      throw new Error("boom");
    };
    assert.strictEqual(await hasAddressBookPermission(), false);
    messenger.permissions.contains = saved;
  });
});

/** Rebuild the default quickSearch stub after a test swapped it out. */
function createQuickSearch() {
  return async function quickSearch(queryInfo) {
    const needle = String((queryInfo && queryInfo.searchString) ?? queryInfo ?? "").toLowerCase();
    return this._contacts.filter((c) =>
      JSON.stringify(c.properties ?? "")
        .toLowerCase()
        .includes(needle)
    );
  };
}
