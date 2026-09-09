import { test, expect } from "@playwright/test";
import { messengerStubSource } from "./_browser-messenger.mjs";

const popupUrl = "/popup/popup.html";

function seedScript(templates) {
  return `
    (() => {
      function waitForStub() {
        if (window.messenger && window.messenger.storage) {
          window.messenger.storage.local._raw.schemaVersion = 2;
          window.messenger.storage.local._raw.templates = ${JSON.stringify(templates)};
        } else {
          setTimeout(waitForStub, 5);
        }
      }
      waitForStub();
    })();
  `;
}

async function openPopup(page, templates) {
  await page.addInitScript({ content: messengerStubSource });
  await page.addInitScript({ content: seedScript(templates) });
  await page.goto(popupUrl);
  await page.waitForSelector("#template-list .template-item, #empty-state:not([hidden])");
}

test("renders one row per seeded template", async ({ page }) => {
  await openPopup(page, [
    { id: "t1", name: "Greeting", category: "", subject: "Hi", pinned: false, identities: [] },
    { id: "t2", name: "Sign-off", category: "", subject: "Bye", pinned: false, identities: [] },
  ]);
  const items = await page.$$("#template-list .template-item");
  expect(items.length).toBe(2);
});

test("shows empty state when there are no templates", async ({ page }) => {
  await openPopup(page, []);
  await expect(page.locator("#empty-state")).toBeVisible();
});

test("search filters the list as the user types", async ({ page }) => {
  await openPopup(page, [
    { id: "t1", name: "Welcome message", pinned: false, identities: [] },
    { id: "t2", name: "Goodbye message", pinned: false, identities: [] },
  ]);
  await page.fill("#search-input", "welcome");
  await expect(page.locator(".template-item:not([hidden])")).toHaveCount(1);
  await page.fill("#search-input", "");
  await expect(page.locator(".template-item:not([hidden])")).toHaveCount(2);
});

test("Esc clears the search box and refocuses it", async ({ page }) => {
  await openPopup(page, [{ id: "t1", name: "A", pinned: false, identities: [] }]);
  await page.fill("#search-input", "xyz");
  await page.press("#search-input", "Escape");
  await expect(page.locator("#search-input")).toHaveValue("");
});

test("pinned templates render first", async ({ page }) => {
  await openPopup(page, [
    { id: "t1", name: "Zoo", pinned: false, identities: [] },
    { id: "t2", name: "Apple", pinned: true, identities: [] },
  ]);
  const firstName = await page.locator(".template-item .name").first().textContent();
  expect(firstName?.trim()).toBe("Apple");
});

// ---- "Resolve again" row (#229) ----

/** Make the background answer getLastInsert, and record what the popup sends. */
function lastInsertScript(name) {
  return `
    (() => {
      function patch() {
        if (!window.messenger || !window.messenger.runtime) {
          setTimeout(patch, 5);
          return;
        }
        window.__sent = [];
        window.messenger.runtime.sendMessage = async (message) => {
          window.__sent.push(message);
          if (message && message.action === "templatewing:getLastInsert") {
            return { templateId: "t1", name: ${JSON.stringify(name)} };
          }
          return undefined;
        };
      }
      patch();
    })();
  `;
}

test("the resolve-again row stays hidden when nothing was inserted yet", async ({ page }) => {
  await openPopup(page, [{ id: "t1", name: "Follow-up", pinned: false, identities: [] }]);
  await expect(page.locator("#reinsert-row")).toBeHidden();
});

test("the resolve-again row names the template last inserted", async ({ page }) => {
  await page.addInitScript({ content: lastInsertScript("Follow-up") });
  await openPopup(page, [{ id: "t1", name: "Follow-up", pinned: false, identities: [] }]);
  await expect(page.locator("#reinsert-row")).toBeVisible();
  await expect(page.locator("#reinsert-label")).toContainText("Follow-up");
});

test("resolve again takes two clicks before it replaces the body", async ({ page }) => {
  await page.addInitScript({ content: lastInsertScript("Follow-up") });
  await openPopup(page, [{ id: "t1", name: "Follow-up", pinned: false, identities: [] }]);

  const button = page.locator("#btn-reinsert");
  await button.click();
  // First click only arms it — nothing has been sent to the background yet.
  await expect(button).toHaveClass(/confirming/);
  let sent = await page.evaluate(() => window.__sent.map((m) => m.action));
  expect(sent).not.toContain("templatewing:reinsertTemplate");

  await button.click();
  sent = await page.evaluate(() => window.__sent.map((m) => m.action));
  expect(sent).toContain("templatewing:reinsertTemplate");
});
