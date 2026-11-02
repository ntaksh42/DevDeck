import { expect, test } from "@playwright/test";

test("palette opens exact work item and active PR IDs with the keyboard", async ({ page }) => {
  await page.goto("/");
  const initialGrid = page.getByRole("grid", { name: "My review pull requests" });
  await initialGrid.waitFor();
  await initialGrid.focus();
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  const input = palette.getByRole("textbox");
  await expect(input).toBeFocused();
  await expect(palette.getByRole("status")).toContainText("Demo data only");
  await input.fill("#123");
  await expect(palette.getByRole("button", { name: /#123 Validate onboarding/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(palette).toBeHidden();
  const wiGrid = page.getByRole("grid", { name: "Work items" });
  await expect(wiGrid.getByText("Validate onboarding with PAT credentials")).toBeVisible();
  await expect(wiGrid.locator('tr[aria-selected="true"], [role="row"][aria-selected="true"]')).toBeFocused();

  await page.keyboard.press("Control+k");
  await expect(palette.getByText("Recent", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  await expect(wiGrid.locator('tr[aria-selected="true"], [role="row"][aria-selected="true"]')).toBeFocused();

  await page.keyboard.press("Control+k");
  await input.fill("pr: 42");
  await expect(palette.getByRole("button", { name: /^PR 42 Add pull request search dashboard/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(palette).toBeHidden();
  const prGrid = page.getByRole("grid", { name: "Pull request search results" });
  await expect(prGrid.getByText("Add pull request search dashboard")).toBeVisible();
});

test("palette does not use numeric prefixes and contains Tab navigation", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("grid", { name: "My review pull requests" }).waitFor();
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  const input = palette.getByRole("textbox");
  await input.fill("wi: 12");
  await expect(palette.getByText(/No matching items or commands/)).toBeVisible();
  await expect(palette.getByRole("button", { name: /#123/ })).toHaveCount(0);
  await page.keyboard.press("Shift+Tab");
  await expect(palette.getByRole("button", { name: "Close command palette" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(input).toBeFocused();
});
