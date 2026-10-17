import { expect, test } from "@playwright/test";

test("the sidebar Agent button toggles the panel and shows what waits for the user", async ({ page }) => {
  await page.setViewportSize({ width: 1700, height: 950 });
  await page.goto("/");
  await expect(page.getByRole("grid", { name: "My review pull requests" })).toBeVisible();

  const button = page.getByRole("complementary").first().getByRole("button", { name: /^Agent/ });
  await expect(button).toBeVisible();
  await button.click();
  const panel = page.getByRole("complementary", { name: "Agent", exact: true });
  await expect(panel).toBeVisible();

  // Conversations waiting in other items are listed above the conversations of the selected one.
  const waiting = panel.getByRole("region", { name: "Waiting for you elsewhere" });
  if (await waiting.isVisible()) {
    await expect(waiting.getByRole("button").first()).toBeVisible();
  }
  await button.click();
  await expect(panel).toBeHidden();
});
