import { expect, test } from "@playwright/test";

test("Inbox uses row focus and Ctrl+G returns from the preview to the selected row", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("complementary").first().getByRole("button", { name: /^Inbox/ }).click();
  const list = page.getByRole("listbox", { name: "Inbox items" });
  const row = list.getByRole("option").filter({ hasText: "!103 api-gateway" });
  await row.click();
  await expect(row).toBeFocused();
  const focusedShadow = await row.evaluate((el) => getComputedStyle(el).boxShadow);
  await page.keyboard.press("Shift+Tab");
  await expect(row).not.toBeFocused();
  await page.keyboard.press("Control+g");
  await expect(row).toBeFocused();

  await page.keyboard.press("Control+p");
  await expect(page.locator('[data-primary-preview="true"]')).toBeFocused();
  expect(await row.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe(focusedShadow);
  await page.keyboard.press("Control+g");
  await expect(row).toBeFocused();
  expect(await row.evaluate((el) => getComputedStyle(el).boxShadow)).toBe(focusedShadow);

  await page.keyboard.press("j");
  await expect(list.getByRole("option").filter({ hasText: "!189 android-app" })).toBeFocused();
  await page.keyboard.press("k");
  await expect(row).toBeFocused();
});

test("Ctrl+G returns from Agent conversations to the Inbox row", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("complementary").first().getByRole("button", { name: /^Inbox/ }).click();
  const row = page.getByRole("listbox", { name: "Inbox items" }).getByRole("option").filter({ hasText: "!42 azdo-dashboard" });
  await row.click();
  await page.keyboard.press("q");
  const conversations = page.getByLabel("Agent conversations");
  await conversations.focus();
  await page.keyboard.press("Control+g");
  await expect(row).toBeFocused();
});
