import { expect, test, type Locator } from "@playwright/test";

// The virtualized grids compute spacer heights from a fixed row height (29px).
// If a row grows taller because of its content (vote badges, chips, icons),
// the rendered rows drift away from the spacers and scrolling a long list
// jitters. Every data row must render at exactly the fixed height.
const ROW_HEIGHT = 29;

async function expectFixedRowHeights(grid: Locator) {
  const rows = grid.locator('[role="row"][aria-selected]');
  await expect(rows.first()).toBeVisible();
  const heights = await rows.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().height),
  );
  expect(heights.length).toBeGreaterThan(0);
  for (const height of heights) expect(height).toBe(ROW_HEIGHT);
}

test("My Reviews rows match the virtualizer row height", async ({ page }) => {
  await page.goto("/");
  await expectFixedRowHeights(
    page.getByRole("main").getByRole("grid", { name: "My review pull requests" }),
  );
});

test("Work item rows match the virtualizer row height", async ({ page }) => {
  await page.goto("/");
  await page.locator("nav").getByRole("button", { name: /^My Items/ }).click();
  await expectFixedRowHeights(page.getByRole("main").getByRole("grid", { name: "Work items" }));
});
