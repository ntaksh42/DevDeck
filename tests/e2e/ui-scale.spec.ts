import { expect, test } from "@playwright/test";

test("changes the app zoom from Settings and the keyboard, and keeps it after a reload", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("grid", { name: "My review pull requests" })).toBeVisible();
  const zoom = () => page.evaluate(() => document.documentElement.style.zoom);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("radio", { name: "125%" }).click();
  await expect.poll(zoom).toBe("125%");

  await page.reload();
  await expect.poll(zoom).toBe("125%");

  await page.keyboard.press("Control+=");
  await expect.poll(zoom).toBe("150%");
  await page.keyboard.press("Control+-");
  await page.keyboard.press("Control+-");
  await expect.poll(zoom).toBe("110%");
  await page.keyboard.press("Control+0");
  await expect.poll(zoom).toBe("");
});
