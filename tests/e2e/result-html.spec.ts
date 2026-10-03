import { expect, test } from "@playwright/test";

test("large result HTML has a keyboard path to external opening without an iframe", async ({ page }) => {
  test.setTimeout(60_000);
  await page.route("**/src/lib/demo/settings.ts", async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replaceAll("tooLarge: false", "tooLarge: true");
    await route.fulfill({ response, body });
  });
  for (const key of ["Enter", "o"]) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "Result", exact: true }).click();
    await expect(page.getByText(/ファイルが大きすぎます/)).toBeVisible();
    const open = page.getByRole("button", { name: "外部ブラウザで開く (o)" });
    const panel = open.locator("xpath=ancestor::*[@data-primary-preview='true']");
    await expect(panel.locator("iframe")).toHaveCount(0);
    // Reach the explicit open action through the panel's normal tab order.
    await panel.focus();
    await page.keyboard.press("Tab");
    await expect(open).toBeFocused();
    await page.keyboard.press(key);
    // Browser preview cannot open local paths; this error proves the action
    // reached openLocalPath through both keyboard routes.
    await expect(page.getByText("Opening local files is only available in the desktop app.")).toBeVisible();
  }
});
