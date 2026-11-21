import { expect, test } from "@playwright/test";

test("Enter on the palette close button returns to the current view without running a command", async ({ page }) => {
  await page.goto("/");
  const grid = page.getByRole("grid", { name: "My review pull requests" });
  await grid.waitFor();
  await grid.focus();
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  const selected = palette.locator('button[aria-current="true"]');
  await selected.focus();
  const firstLabel = await selected.innerText();
  await page.keyboard.press("ArrowDown");
  await expect(selected).toBeFocused();
  await expect(selected).not.toHaveText(firstLabel);
  await page.keyboard.press("ArrowUp");
  await expect(selected).toBeFocused();
  await expect(selected).toHaveText(firstLabel);
  await palette.getByRole("button", { name: "Close command palette" }).focus();
  await page.keyboard.press("Enter");
  await expect(palette).toBeHidden();
  await page.keyboard.press("ArrowDown");
  await expect(grid).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pull Requests My Reviews" })).toBeVisible();
});
