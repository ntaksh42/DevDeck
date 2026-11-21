import { expect, test } from "@playwright/test";

test("reorders grid columns from the Columns menu with Alt+Arrow and keeps the order", async ({ page }) => {
  await page.goto("/");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "My Reviews" })).toBeVisible();

  const headers = () => main.getByRole("columnheader").allInnerTexts();
  const before = (await headers()).map((text) => text.trim());
  expect(before.length).toBeGreaterThan(3);

  await main.getByRole("button", { name: "Columns" }).click();
  const menu = page.getByRole("menu", { name: "Visible columns" });
  const boxes = menu.locator('input[data-colvis-key]');
  const second = boxes.nth(1);
  const secondKey = await second.getAttribute("data-colvis-key");
  await second.focus();
  await page.keyboard.press("Alt+ArrowUp");

  // The same column keeps focus after moving to the first slot.
  await expect(boxes.nth(0)).toHaveAttribute("data-colvis-key", secondKey!);
  await expect(boxes.nth(0)).toBeFocused();

  const after = (await headers()).map((text) => text.trim());
  expect(after).not.toEqual(before);

  await page.keyboard.press("Escape");
  await page.reload();
  await expect(main.getByRole("heading", { name: "My Reviews" })).toBeVisible();
  expect((await headers()).map((text) => text.trim())).toEqual(after);
});

test("reorders grid columns by dragging a header onto another and keeps the order", async ({ page }) => {
  await page.goto("/");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "My Reviews" })).toBeVisible();

  const headers = async () => (await main.getByRole("columnheader").allInnerTexts()).map((text) => text.trim());
  const before = await headers();

  await main.getByRole("button", { name: "Sort by Author" }).dragTo(main.getByRole("columnheader", { name: /Repository/ }));

  const after = await headers();
  expect(after.indexOf("Author")).toBeLessThan(after.indexOf("Repository"));
  expect(after).not.toEqual(before);
  // Dragging must not have triggered a sort.
  await expect(main.getByRole("columnheader", { name: /Author/ })).toHaveAttribute("aria-sort", "none");

  await page.reload();
  await expect(main.getByRole("heading", { name: "My Reviews" })).toBeVisible();
  expect(await headers()).toEqual(after);
});
