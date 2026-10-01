import { expect, test } from "@playwright/test";

test("continues keyboard range selection when a new search removes the anchor", async ({ page }) => {
  await page.goto("/");
  const main = page.getByRole("main");
  const searchNav = page.getByRole("complementary").first().getByRole("button", { name: "Search" }).first();
  await searchNav.focus();
  await page.keyboard.press("Enter");
  const input = main.getByPlaceholder("title, author, branch…");
  await input.focus();
  await page.keyboard.press("Enter");
  const grid = main.getByRole("grid", { name: "Pull request search results" });
  const anchor = grid.getByRole("row").filter({ hasText: "Add pull request search dashboard" });
  await expect(anchor).toBeVisible();
  await anchor.focus();
  await page.keyboard.press("Shift+ArrowDown");
  await expect(main.getByText(/2 selected/)).toBeVisible();

  await input.fill("android-app");
  await page.keyboard.press("Enter");
  await expect(anchor).toHaveCount(0);
  await expect(grid.locator('[role="row"][aria-selected]')).toHaveCount(2);
  await grid.focus();
  await page.keyboard.press("Shift+ArrowDown");
  await expect(main.getByText(/2 selected/)).toBeVisible();
});
