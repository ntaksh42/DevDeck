import { expect, test } from "@playwright/test";

test("replies and resolves PR threads in Inbox using the keyboard", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("complementary").first().getByRole("button", { name: /^Inbox/ }).click();
  const list = page.getByRole("listbox", { name: "Inbox items" });
  const row = list.getByRole("option").filter({ hasText: "!42 azdo-dashboard" });
  await row.click();
  const reply = page.getByPlaceholder("Reply…", { exact: true });
  await expect(reply).toBeVisible();
  await list.focus();
  await page.keyboard.press("r");
  await expect(reply).toBeFocused();
  await reply.fill("Confirmed the null handling in Inbox.");
  await page.keyboard.press("Control+Enter");
  await expect(row).toHaveCount(0);
  await expect(list.getByRole("option", { selected: true })).toBeFocused();

  const next = list.getByRole("option").filter({ hasText: "!189 android-app" });
  await next.click();
  const resolve = page.getByRole("button", { name: "Resolve + Done", exact: true });
  await resolve.focus();
  await page.keyboard.press("Enter");
  await expect(next).toHaveCount(0);
  await expect(list.getByRole("option", { selected: true })).toBeFocused();
});

test("Ctrl+Enter opens the browser from Inbox preview but submits in the reply editor", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as Window & { openedUrls: string[] };
    state.openedUrls = [];
    window.open = (url) => {
      state.openedUrls.push(String(url));
      return null;
    };
  });
  await page.goto("/");
  await page.getByRole("complementary").first().getByRole("button", { name: /^Inbox/ }).click();
  const list = page.getByRole("listbox", { name: "Inbox items" });
  await list.getByRole("option").filter({ hasText: "!42 azdo-dashboard" }).click();
  const preview = page.locator('[data-primary-preview="true"]').filter({ has: page.getByRole("heading", { name: /!42/ }) });
  await preview.focus();
  await page.keyboard.press("Control+Enter");
  const urls = () => page.evaluate(() => (window as Window & { openedUrls: string[] }).openedUrls);
  await expect.poll(urls).toEqual(["https://dev.azure.com/contoso/Platform/_git/azdo-dashboard/pullrequest/42"]);
  const reply = page.getByPlaceholder("Reply…", { exact: true });
  await reply.fill("Reply instead of opening a browser.");
  await page.keyboard.press("Control+Enter");
  await expect(list.getByRole("option").filter({ hasText: "!42 azdo-dashboard" })).toHaveCount(0);
  expect(await urls()).toHaveLength(1);
});

test("Ctrl+Enter opens the PR from an agent reply row", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as Window & { openedUrls: string[] };
    state.openedUrls = [];
    window.open = (url) => {
      state.openedUrls.push(String(url));
      return null;
    };
  });
  await page.goto("/");
  await page.getByRole("complementary").first().getByRole("button", { name: /^Inbox/ }).click();
  const list = page.getByRole("listbox", { name: "Inbox items" });
  await list.getByRole("option", { name: /Agent.*!101/ }).click();
  await expect(page.getByRole("button", { name: "Open in Azure DevOps (O / Ctrl+Enter)" })).toBeEnabled();
  await list.focus();
  await page.keyboard.press("Control+Enter");
  await expect.poll(() => page.evaluate(() => (window as Window & { openedUrls: string[] }).openedUrls)).toEqual([
    "https://dev.azure.com/contoso/Platform/_git/api-gateway/pullrequest/101",
  ]);
});
