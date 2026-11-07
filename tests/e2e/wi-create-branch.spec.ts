import { expect, test } from "@playwright/test";

test("creates a branch for the selected work item from the View options menu", async ({ page }) => {
  await page.setViewportSize({ width: 1700, height: 950 });
  await page.goto("/");
  await page.getByRole("button", { name: /^My Items/ }).click();
  const grid = page.getByRole("grid").first();
  await expect(grid).toBeVisible();
  await grid.getByRole("row").nth(1).click();

  await page.getByRole("button", { name: "View options" }).first().click();
  await page.getByRole("menuitem", { name: "Create branch…" }).click();

  const dialog = page.getByRole("dialog", { name: /Create branch for #/ });
  await expect(dialog).toBeVisible();
  const name = dialog.getByLabel("Branch name");
  await expect(name).toHaveValue(/^[a-z-]+\/\d+-/);
  await expect(dialog.getByLabel("Base branch")).toHaveValue("main");

  // Keyboard path: Ctrl+Enter creates, the result offers the checkout command, Esc closes.
  await page.keyboard.press("Control+Enter");
  await expect(dialog.getByText("Linked to the work item.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Copy checkout command" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("opens the same dialog from the command palette", async ({ page }) => {
  await page.setViewportSize({ width: 1700, height: 950 });
  await page.goto("/");
  await page.getByRole("button", { name: /^My Items/ }).click();
  await page.getByRole("grid").first().getByRole("row").nth(1).click();
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder(/Type a command/).fill("Create a branch");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: /Create branch for #/ })).toBeVisible();
});
