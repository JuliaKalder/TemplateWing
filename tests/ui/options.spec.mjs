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
    {
      id: "t1",
      name: "Sample",
      pinned: false,
      identities: [],
      usageCount: 3,
      lastUsedAt: "2026-06-20T00:00:00Z",
    },
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

const THREE_TEMPLATES = [
  { id: "t1", name: "Alpha", category: "Work", pinned: false, identities: [] },
  { id: "t2", name: "Beta", category: "Work", pinned: false, identities: [] },
  { id: "t3", name: "Gamma", category: "Private", pinned: false, identities: [] },
];

test("selection bar stays hidden until a template is ticked", async ({ page }) => {
  await openOptions(page, THREE_TEMPLATES);
  await expect(page.locator("#selection-bar")).toBeHidden();
  await page.locator(".template-card .select-box").first().check();
  await expect(page.locator("#selection-bar")).toBeVisible();
  await expect(page.locator("#selection-count")).toContainText("1");
});

test("select all ticks every row and clearing unticks them", async ({ page }) => {
  await openOptions(page, THREE_TEMPLATES);
  await page.check("#select-all");
  await expect(page.locator("#selection-count")).toContainText("3");
  await expect(page.locator(".template-card .select-box:checked")).toHaveCount(3);

  await page.click("#btn-selection-clear");
  await expect(page.locator("#selection-bar")).toBeHidden();
  await expect(page.locator(".template-card .select-box:checked")).toHaveCount(0);
});

test("select all only covers rows passing the current filter", async ({ page }) => {
  await openOptions(page, THREE_TEMPLATES);
  await page.selectOption("#category-filter", "Work");
  await page.check("#select-all");
  // Gamma is filtered out, so only the two Work templates get selected.
  await expect(page.locator("#selection-count")).toContainText("2");
});

test("bulk category change rewrites the category of the selection", async ({ page }) => {
  await openOptions(page, THREE_TEMPLATES);
  await page.check("#select-all");
  await page.fill("#selection-category", "Archive");
  await page.click("#btn-selection-category");

  await expect(page.locator(".template-card .category-badge")).toHaveCount(3);
  for (const badge of await page.locator(".template-card .category-badge").all()) {
    await expect(badge).toHaveText("Archive");
  }
});

test("the category filter survives a re-render", async ({ page }) => {
  // setFilterOptions used to drop the selected <option>, which resets the
  // select to "All" and silently widened what "Select all" covered.
  await openOptions(page, THREE_TEMPLATES);
  await page.selectOption("#category-filter", "Work");
  await page.locator(".template-card .select-box").first().check();
  await page.click("#btn-selection-clear");
  await expect(page.locator("#category-filter")).toHaveValue("Work");
  await expect(page.locator(".template-card:not([hidden])")).toHaveCount(2);
});

test("an external template change keeps the active filter applied", async ({ page }) => {
  await openOptions(page, THREE_TEMPLATES);
  await page.selectOption("#category-filter", "Work");
  await expect(page.locator(".template-card:not([hidden])")).toHaveCount(2);

  // Simulate the background page writing templates (e.g. trackUsage after an
  // insert). The options page re-renders; the filter must not fall away.
  await page.evaluate(() => {
    const raw = window.messenger.storage.local._raw.templates;
    raw[0] = { ...raw[0], usageCount: 7 };
    return window.messenger.storage.local.set({ templates: raw });
  });

  await expect(page.locator(".template-card:not([hidden])")).toHaveCount(2);
  await expect(page.locator("#category-filter")).toHaveValue("Work");
});

test("applying an empty category asks before clearing", async ({ page }) => {
  await openOptions(page, THREE_TEMPLATES);
  const dialogs = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    dialog.dismiss();
  });

  await page.check("#select-all");
  await page.click("#btn-selection-category");

  expect(dialogs).toHaveLength(1);
  // Dismissed, so every category must still be intact.
  await expect(page.locator(".template-card .category-badge")).toHaveCount(3);
});

test("unticking select all drops filtered-out rows too", async ({ page }) => {
  // Otherwise a selection made before narrowing the filter survives with no
  // ticked row on screen, and the next bulk action hits an invisible template.
  await openOptions(page, THREE_TEMPLATES);
  await page.check("#select-all");
  await expect(page.locator("#selection-count")).toContainText("3");

  await page.selectOption("#category-filter", "Work");
  await page.uncheck("#select-all");
  await expect(page.locator("#selection-bar")).toBeHidden();
});

test("bulk delete confirm names the templates it will remove", async ({ page }) => {
  await openOptions(page, THREE_TEMPLATES);
  const messages = [];
  page.on("dialog", (dialog) => {
    messages.push(dialog.message());
    dialog.dismiss();
  });

  await page.check("#select-all");
  await page.click("#btn-selection-delete");

  expect(messages).toHaveLength(1);
  for (const name of ["Alpha", "Beta", "Gamma"]) {
    expect(messages[0]).toContain(name);
  }
  await expect(page.locator(".template-card")).toHaveCount(3);
});

test("clearing the selection keeps focus on the page", async ({ page }) => {
  await openOptions(page, THREE_TEMPLATES);
  // Filter everything away so #select-all is disabled — the case where the
  // focus hand-off used to fall through to <body>.
  await page.locator(".template-card .select-box").first().check();
  await page.fill("#search-input", "zzzznomatch");
  await page.click("#btn-selection-clear");

  const active = await page.evaluate(() => document.activeElement?.id || "");
  expect(active).not.toBe("");
  expect(active).toBe("search-input");
});

test("bulk delete removes the selected templates", async ({ page }) => {
  await openOptions(page, THREE_TEMPLATES);
  page.on("dialog", (dialog) => dialog.accept());

  await page.locator(".template-card .select-box").first().check();
  await page.click("#btn-selection-delete");

  await expect(page.locator(".template-card")).toHaveCount(2);
  await expect(page.locator("#selection-bar")).toBeHidden();
});

test("opening the editor and cancelling returns to the list", async ({ page }) => {
  await openOptions(page);
  await page.click("#btn-add");
  await expect(page.locator("#view-editor")).toBeVisible();
  await page.click("#btn-cancel");
  await expect(page.locator("#view-list")).toBeVisible();
});
