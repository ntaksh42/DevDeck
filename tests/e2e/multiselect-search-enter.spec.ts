import { expect, test } from "@playwright/test";

test("Enter in a project filter searches options without submitting the work item search", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("grid", { name: "My review pull requests" }).waitFor();
  await page.keyboard.press("g");
  await page.keyboard.press("f");
  const trigger = page.getByRole("button", { name: "Filter by project", exact: true });
  await trigger.click();
  const options = page.getByRole("listbox", { name: "Filter by project" });
  const input = options.getByPlaceholder("Search…");
  await input.fill("Platform");
  await page.keyboard.press("Enter");
  await expect(input).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem("azdodeck:workItemSearch:searchHistory"))).toBeNull();
  await expect(page.getByRole("grid", { name: "Work items", exact: true })).toHaveCount(0);

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(options.getByRole("option", { name: "Platform", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.getByRole("main").getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("grid", { name: "Work items", exact: true })).toBeVisible();
});
