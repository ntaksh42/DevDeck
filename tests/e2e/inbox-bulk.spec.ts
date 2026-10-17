import { expect, test } from "@playwright/test";

test("marks several Inbox items, finishes them together and undoes them together", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  await page.getByRole("complementary").first().getByRole("button", { name: /^Inbox/ }).click();
  const list = page.getByRole("listbox", { name: "Inbox items" });
  const rows = list.getByRole("option");
  await expect(rows).toHaveCount(4);
  await rows.first().click();

  // Shift+Down extends the marked range over the rows it passes.
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(page.getByText("3 marked (Esc clears)")).toBeVisible();

  // E applies to every marked row at once.
  await page.keyboard.press("e");
  await expect(rows).toHaveCount(1);
  await expect(page.getByRole("status").filter({ hasText: "Marked done (3)" })).toBeVisible();

  // U brings all of them back.
  await page.keyboard.press("u");
  await expect(rows).toHaveCount(4);
  await expect(list.getByRole("option", { selected: true })).toBeFocused();

  // X toggles a single mark and Esc clears it without touching the items.
  await page.keyboard.press("x");
  await expect(page.getByText("1 marked (Esc clears)")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText(/marked \(Esc clears\)/)).toBeHidden();
  await expect(rows).toHaveCount(4);
});
