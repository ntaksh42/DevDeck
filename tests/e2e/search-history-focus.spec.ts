import { expect, test } from "@playwright/test";

for (const view of [
  { scope: "prSearch", key: "q", placeholder: "title, author, branch…" },
  { scope: "workItemSearch", key: "f", placeholder: "Search work items…" },
]) {
  test(`${view.scope}: deleting history keeps a keyboard path to search`, async ({ page }) => {
    await page.addInitScript(({ scope }) => {
      localStorage.setItem(`azdodeck:${scope}:searchHistory`, JSON.stringify({
        recent: ["alpha", "beta"].map((query) => ({
          id: query, organizationId: "contoso", query, filters: {},
          summary: "no filters", at: new Date().toISOString(),
        })),
        saved: [],
      }));
    }, view);
    await page.goto("/");
    await page.getByRole("grid", { name: "My review pull requests" }).waitFor();
    await page.keyboard.press("g");
    await page.keyboard.press(view.key);
    const remove = page.getByRole("button", { name: "Remove search alpha" });
    await remove.focus();
    await page.keyboard.press("Enter");
    const remaining = page.locator('[data-history-row][data-id="beta"]');
    await expect(remaining).toBeFocused();
    await page.keyboard.press("Delete");
    await expect(page.getByPlaceholder(view.placeholder)).toBeFocused();
    await expect(page.locator("[data-history-row]")).toHaveCount(0);
  });
}
