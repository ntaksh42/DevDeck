import { expect, test } from "@playwright/test";

for (const view of [
  { key: "q", query: "42", prefix: "pr:", placeholder: "title, author, branch…", filter: "Filter by Repository", title: "Add pull request search dashboard", grid: "Pull request search results" },
  { key: "f", query: "123", prefix: "wi:", placeholder: "Search work items…", filter: "Filter by State", title: "Validate onboarding with PAT credentials", grid: "Work items" },
]) {
  test(`${view.prefix} external lookup clears column filters`, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("grid", { name: "My review pull requests" }).waitFor();
    await page.keyboard.press("g");
    await page.keyboard.press(view.key);
    await page.getByPlaceholder(view.placeholder).fill(view.query);
    await page.keyboard.press("Enter");
    const grid = page.getByRole("grid", { name: view.grid, exact: true });
    await expect(grid.getByText(view.title, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: view.filter, exact: true }).click();
    await page.getByRole("button", { name: "Uncheck all", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByText(view.title, { exact: true })).toHaveCount(0);
    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette.getByPlaceholder("Type a command or search…").fill(`${view.prefix}${view.query}`);
    const target = palette.getByRole("button", { name: new RegExp(`^${view.prefix === "pr:" ? "PR " : "#"}${view.query} ${view.title}`) });
    await expect(target).toBeVisible();
    await target.click();
    await expect(palette).toBeHidden();
    await expect(grid.getByText(view.title, { exact: true })).toBeVisible();
  });
}
