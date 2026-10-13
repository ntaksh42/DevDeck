import { expect, test } from "@playwright/test";

test("pane highlight follows grid, comment input and Agent focus", async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 900 });
  await page.goto("/");
  const grid = page.getByRole("grid", { name: "My review pull requests" });
  await expect(grid).toBeVisible();
  await expect(page.getByRole("button", { name: "Add a comment…", exact: true })).toBeVisible();
  const highlighted = () => page.locator("[data-focus-pane]").evaluateAll((panes) =>
    panes.filter((pane) => getComputedStyle(pane, "::after").boxShadow !== "none")
      .map((pane) => pane.getAttribute("data-focus-pane")),
  );
  await page.keyboard.press("Control+j");
  await expect(page.getByRole("complementary", { name: "Agent", exact: true })).toBeVisible();
  await grid.focus();
  await expect.poll(highlighted).toEqual(["grid"]);
  await page.keyboard.press("m");
  const comment = page.getByRole("textbox", { name: "Add a comment…", exact: true });
  await expect(comment).toBeFocused();
  await expect.poll(highlighted).toEqual(["review"]);
  await page.getByLabel("Agent conversations", { exact: true }).focus();
  await expect.poll(highlighted).toEqual(["agent"]);
  await page.keyboard.press("Control+g");
  await expect.poll(highlighted).toEqual(["grid"]);
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await expect.poll(highlighted).toEqual([]);
});
