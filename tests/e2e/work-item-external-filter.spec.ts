import { expect, test } from "@playwright/test";

test("opening a work item from the palette clears the old result filter", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("grid", { name: "My review pull requests" }).waitFor();
  await page.keyboard.press("g");
  await page.keyboard.press("f");
  await page.getByPlaceholder("Search work items…").fill("123");
  await page.keyboard.press("Enter");
  const grid = page.getByRole("grid", { name: "Work items", exact: true });
  await expect(grid.getByText("Validate onboarding with PAT credentials")).toBeVisible();
  await page.getByRole("button", { name: /Filter work items/ }).click();
  await page.getByLabel("Filter results").fill("no-such-work-item");
  await expect(page.getByText("No work items matched.", { exact: true })).toBeVisible();

  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByPlaceholder("Type a command or search…").fill("wi:118");
  await expect(palette.getByText("#118 Rate limiting middleware causes 429 cascade on retries")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(palette).toBeHidden();
  await expect(grid.getByText("Rate limiting middleware causes 429 cascade on retries")).toBeVisible();
});
