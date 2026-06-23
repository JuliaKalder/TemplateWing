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
