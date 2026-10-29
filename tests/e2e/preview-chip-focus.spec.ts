import { expect, test } from "@playwright/test";

test("keyboard assignee pick draws the focus ring on the field chip, not the trigger", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  await page.getByRole("grid", { name: "My review pull requests" }).waitFor();
  await page.keyboard.press("g");
  await page.keyboard.press("f");
  await page.getByPlaceholder("Search work items…").fill("123");
  await page.keyboard.press("Enter");
  const grid = page.getByRole("grid", { name: "Work items", exact: true });
  await grid.getByText("Validate onboarding with PAT credentials").click();
  await page.keyboard.press("Enter");
  await page.keyboard.press("a");
  await expect(page.getByPlaceholder("Search assignee...")).toBeFocused();
  await expect(page.getByRole("button", { name: /Alice Johnson/ })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");

  const trigger = page.getByRole("button", { name: "Change assignee" });
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveCSS("outline-color", "rgba(0, 0, 0, 0)");
  const chip = trigger.locator("xpath=../../..");
  await expect.poll(() => chip.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe("none");
});
