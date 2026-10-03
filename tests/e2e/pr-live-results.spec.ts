import { expect, test } from "@playwright/test";

test("PR result envelopes work in browser demo mode", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  await navigation.getByRole("button", { name: "My Pull Requests", exact: true }).click();
  const grid = page.getByRole("grid", { name: "My pull requests" });
  await expect(grid.getByText("Add request tracing to the gateway")).toBeVisible();
  await grid.getByRole("row").first().focus();
  await page.keyboard.press("ArrowDown");

  await navigation.getByRole("button", { name: "Search", exact: true }).first().click();
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("grid", { name: "Pull request search results" })
    .getByText("Add pull request search dashboard")).toBeVisible();
  await expect(page.getByText(/Could not fetch .* project/)).toHaveCount(0);
});
