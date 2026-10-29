import { expect, test } from "@playwright/test";

test("Inbox priority can be switched and processed entirely by keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  await page.getByRole("complementary").first().getByRole("button", { name: /^Inbox/ }).click();
  const list = page.getByRole("listbox", { name: "Inbox items" });
  const rows = list.getByRole("option");
  await expect(rows).toHaveCount(4);
  await rows.first().click();
  // The priority switch sits in the tab band; Shift+Tab passes the column
  // filter buttons and the panel's Move button first. It must stay reachable
  // within a handful of presses.
  const backToPriority = async () => {
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Shift+Tab");
      const onPriority = await page.evaluate(
        () => document.activeElement?.getAttribute("role") === "radio",
      );
      if (onPriority) return;
    }
  };
  await backToPriority();
  await expect(page.getByRole("radio", { name: "All", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Priority", exact: true })).toBeFocused();
  await expect(rows).toHaveCount(3);
  await page.keyboard.press("Enter");
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press("j");
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press("x");
  await backToPriority();
  await page.keyboard.press("ArrowRight");
  await expect(rows).toHaveCount(1);
  await expect(page.getByText(/marked \(Esc clears\)/)).toBeHidden();
  await page.keyboard.press("Enter");
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press("z");
  await page.keyboard.press("1");
  await expect(rows).toHaveCount(0);
  await expect(list).toBeFocused();
  await page.keyboard.press("u");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press("e");
  await expect(rows).toHaveCount(0);
  await backToPriority();
  await expect(page.getByRole("radio", { name: "Other", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(rows).toHaveCount(3);
});
