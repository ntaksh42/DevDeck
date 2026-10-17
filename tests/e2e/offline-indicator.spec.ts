import { expect, test } from "@playwright/test";

test("shows the offline badge while the network is down and clears it on reconnect", async ({ page, context }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("grid", { name: "My review pull requests" })).toBeVisible();
  const badge = page.getByText("Offline — showing cached data");
  await expect(badge).toBeHidden();

  await context.setOffline(true);
  await expect(badge).toBeVisible();
  // Cached rows stay on screen.
  await expect(page.getByRole("grid", { name: "My review pull requests" })).toBeVisible();

  await context.setOffline(false);
  await expect(badge).toBeHidden();
});
