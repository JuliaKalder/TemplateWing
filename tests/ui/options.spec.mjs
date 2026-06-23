import { test, expect } from "@playwright/test";
import { messengerStubSource } from "./_browser-messenger.mjs";

const optionsUrl = "/options/options.html";

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

async function openOptions(page, templates = []) {
  await page.addInitScript({ content: messengerStubSource });
  await page.addInitScript({ content: seedScript(templates) });
  await page.goto(optionsUrl);
  // Wait for the page to settle — either a card or the empty state appears.
  await page.waitForSelector("#template-list .template-card, #empty-state:not([hidden])");
}

test("renders template cards for each seeded template", async ({ page }) => {
  await openOptions(page, [
    {
      id: "t1",
      name: "Welcome",
      category: "Onboarding",
      subject: "Welcome aboard",
      pinned: false,
      identities: [],
    },
  ]);
  await expect(page.locator(".template-card .name")).toContainText("Welcome");
});

test("switches between Templates and Usage tabs", async ({ page }) => {
  await openOptions(page, [
    { id: "t1", name: "Sample", pinned: false, identities: [], usageCount: 3, lastUsedAt: "2026-06-20T00:00:00Z" },
  ]);
  await expect(page.locator("#view-list")).toBeVisible();
  await page.click('button[data-tab="usage"]');
  await expect(page.locator("#view-usage")).toBeVisible();
  await expect(page.locator("#view-list")).toBeHidden();
  // Usage table populated with the seeded template.
  await expect(page.locator("#usage-table tbody tr")).toHaveCount(1);
});

test("Defaults section lists configured identities", async ({ page }) => {
  await openOptions(page);
  await expect(page.locator("#defaults-list .defaults-row")).toHaveCount(1);
});

test("lint summary appears when a template has an unknown variable", async ({ page }) => {
  await openOptions(page, [
    {
      id: "t1",
      name: "Bad",
      body: "Hello {NONEXISTENT}",
      pinned: false,
      identities: [],
    },
  ]);
  await expect(page.locator("#lint-summary")).toBeVisible();
  await expect(page.locator(".lint-badge")).toBeVisible();
});

test("opening the editor and cancelling returns to the list", async ({ page }) => {
  await openOptions(page);
  await page.click("#btn-add");
  await expect(page.locator("#view-editor")).toBeVisible();
  await page.click("#btn-cancel");
  await expect(page.locator("#view-list")).toBeVisible();
});
