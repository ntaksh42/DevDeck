import { expect, test } from "@playwright/test";

test("keeps the reviewed PR and comment draft while sorting from the keyboard", async ({ page }) => {
  await page.goto("/");
  const main = page.getByRole("main");
  const grid = main.getByRole("grid", { name: "My review pull requests" });
  const rows = grid.locator('[role="row"][aria-selected]');
  await expect(rows.nth(1)).toBeVisible();
  await rows.first().focus();
  await page.keyboard.press("ArrowDown");
  const selected = grid.locator('[role="row"][aria-selected="true"]');
  const selectedText = (await selected.textContent()) ?? "";

  await main.getByRole("button", { name: "Add a comment…" }).focus();
  await page.keyboard.press("Enter");
  const editor = main.getByRole("textbox", { name: "Add a comment…" });
  await editor.fill("Keep this review draft");
  await main.getByRole("button", { name: "Sort by PR#" }).focus();
  await page.keyboard.press("Enter");
  await expect(selected).toHaveText(selectedText);
  await expect(editor).toHaveValue("Keep this review draft");

  await selected.focus();
  await page.keyboard.press("ArrowDown");
  await expect(selected).toBeFocused();
  await expect(selected).not.toHaveText(selectedText);
});
