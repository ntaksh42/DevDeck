import { expect, test, type Page } from "@playwright/test";

// Long keyboard jumps in a virtualized grid swap the whole virtual window. The
// newly selected row must end up fully visible and keep keyboard focus, so the
// next key press keeps working instead of landing on <body>.
async function expectFocusedRowFullyVisible(page: Page) {
  // Focus may rest on the grid container for a moment while the new row mounts.
  const focusedRowState = () =>
    page.evaluate(() => {
      const row = document.activeElement as HTMLElement | null;
      if (!row || !["row", "option"].includes(row.getAttribute("role") ?? "")) {
        return { focusedRow: false, visible: false };
      }
      let scroller = row.parentElement;
      while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) {
        scroller = scroller.parentElement;
      }
      if (!scroller) return { focusedRow: true, visible: false };
      const r = row.getBoundingClientRect();
      const s = scroller.getBoundingClientRect();
      return { focusedRow: true, visible: r.top >= s.top - 1 && r.bottom <= s.bottom + 1 };
    });
  await expect.poll(focusedRowState, { timeout: 15_000 }).toEqual({ focusedRow: true, visible: true });
}

async function exerciseJumps(page: Page, firstRow: string) {
  await page.locator(firstRow).first().click();
  for (const key of ["End", "Home", "PageDown", "PageDown", "ArrowDown", "End", "ArrowUp", "Home"]) {
    await page.keyboard.press(key);
    await expectFocusedRowFullyVisible(page);
  }
}

// Hundreds of rows per grid: allow for slow, heavily parallel CI runners.
test.describe.configure({ timeout: 60_000 });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/?scenario=large-data");
});

test("My Reviews keeps focus on long keyboard jumps", async ({ page }) => {
  await exerciseJumps(page, '[aria-label="My review pull requests"] [role="row"][aria-selected]');
});

test("Work items keep focus on long keyboard jumps", async ({ page }) => {
  await page.locator("nav").getByRole("button", { name: /^My Items/ }).click();
  await exerciseJumps(page, '[aria-label="Work items"] [role="row"][aria-selected]');
});

test("PR search keeps focus on long keyboard jumps", async ({ page }) => {
  await page.locator("nav").getByRole("button", { name: /^Search$/ }).first().click();
  await page.getByRole("main").getByRole("button", { name: "Search", exact: true }).click();
  await exerciseJumps(page, '[aria-label="Pull request search results"] [role="row"][aria-selected]');
});

test("Notifications keep focus on long keyboard jumps", async ({ page }) => {
  await page.locator("nav").getByRole("button", { name: /^Notifications/ }).click();
  await exerciseJumps(page, '[aria-label="Notifications"] [role="row"]');
});

test("Inbox keeps focus on long keyboard jumps", async ({ page }) => {
  await page.locator("nav").getByRole("button", { name: /^Inbox/ }).click();
  await exerciseJumps(page, '[role="listbox"][aria-label="Inbox items"] [role="option"]');
});
