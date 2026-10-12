import { expect, test } from "@playwright/test";

test("shows the Agent panel by default with its composer at the bottom", async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 900 });
  await page.goto("/");
  const grid = page.getByRole("grid", { name: "My review pull requests" });
  await expect(grid).toBeVisible();
  const panel = page.getByRole("complementary", { name: "Agent", exact: true });
  await expect(panel).toBeVisible();
  // Shown by default, so it does not take the focus from the grid.
  await expect(panel.getByRole("textbox")).toHaveCount(0);
  await expect(panel.locator("[data-agent-composer]").getByRole("button")).toBeVisible();

  const trailingSpace = () =>
    panel.evaluate((element) => {
      const composer = element.querySelector("[data-agent-composer]")!;
      return element.getBoundingClientRect().bottom - composer.getBoundingClientRect().bottom;
    });
  await expect.poll(trailingSpace).toBeLessThanOrEqual(12);

  // Ctrl+J closes it, then opens it focused on the input.
  await page.keyboard.press("Control+j");
  await expect(panel).toHaveCount(0);
  await page.keyboard.press("Control+j");
  const input = panel.getByRole("textbox", { name: /^Ask (about|the agent)/ });
  await expect(input).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel.locator("[data-agent-composer]").getByRole("button", { name: /^Ask (about|the agent)/ })).toBeVisible();
  await expect.poll(trailingSpace).toBeLessThanOrEqual(12);

  await page.keyboard.press("m");
  await expect(input).toBeFocused();
  await page.setViewportSize({ width: 1800, height: 480 });
  await expect(input).toBeInViewport();
  await expect(panel.getByRole("button", { name: "Ask", exact: true })).toBeInViewport();
});
