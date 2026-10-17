import { expect, test } from "@playwright/test";

test("the Startup panel explains and disables its options outside the desktop app", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await expect(page.getByRole("grid", { name: "My review pull requests" })).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const heading = page.getByRole("heading", { name: "Startup" });
  await heading.scrollIntoViewIfNeeded();
  await expect(heading).toBeVisible();
  await expect(page.getByText("These options are only available in the desktop app.")).toBeVisible();
  for (const name of [
    /Start DevDeck when I sign in to Windows/,
    /Start minimized/,
    /Keep running in the tray/,
  ]) {
    await expect(page.getByLabel(name)).toBeDisabled();
  }
});
