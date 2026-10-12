import { expect, test } from "@playwright/test";

test("keeps the Agent composer next to short conversations", async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("grid", { name: "My review pull requests" })).toBeVisible();
  await page.keyboard.press("Control+j");
  const panel = page.getByRole("complementary", { name: "Agent", exact: true });
  // The input names the subject when one is selected ("Ask about …").
  const askName = /^Ask (about .+|the agent)… \(M\)$/;
  const input = panel.getByRole("textbox", { name: askName });
  await expect(input).toBeFocused();
  await page.keyboard.press("Escape");
  const composer = panel.locator("[data-agent-composer]");
  await expect(composer.getByRole("button", { name: askName })).toBeVisible();

  const measure = () => panel.evaluate((element) => {
    const list = element.querySelector('[aria-label="Agent conversations"]')!;
    const composer = element.querySelector("[data-agent-composer]")!;
    return {
      trailingSpace: list.getBoundingClientRect().bottom - list.lastElementChild!.getBoundingClientRect().bottom,
      gap: composer.getBoundingClientRect().top - list.getBoundingClientRect().bottom,
    };
  });
  await expect.poll(async () => {
    return (await measure()).trailingSpace;
  }).toBeLessThanOrEqual(8);
  expect((await measure()).gap).toBeLessThan(80);

  await page.keyboard.press("m");
  await expect(input).toBeFocused();
  await page.setViewportSize({ width: 1800, height: 480 });
  await expect(input).toBeInViewport();
  await expect(panel.getByRole("button", { name: "Ask", exact: true })).toBeInViewport();
});
