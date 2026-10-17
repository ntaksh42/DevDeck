import { expect, test } from "@playwright/test";

test("shows merge requirements and suggested reviewers for the selected pull request", async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("grid", { name: "My review pull requests" })).toBeVisible();

  // Merge requirements: the required policy that has not passed blocks the merge.
  const merge = page.getByLabel("Merge requirements");
  await expect(merge).toBeVisible();
  await expect(merge.getByText("Blocked (1)")).toBeVisible();
  await expect(merge.getByText(/Minimum number of reviewers/)).toBeVisible();

  // Suggested reviewers appear before anything is typed and can be driven by keyboard.
  await page.getByTitle("Add a reviewer").click();
  const input = page.getByRole("combobox", { name: "Search people to add as a reviewer" });
  await expect(input).toBeFocused();
  await expect(page.getByText(/Suggested from recent commits/)).toBeVisible();
  await expect(page.getByRole("option", { name: /Carol Wang/ })).toBeVisible();
  await expect(page.getByText("6 recent commits across 3 changed files")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option", { name: /Frank Lee/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(input).toBeHidden();
  await expect(page.getByTitle("Add a reviewer")).toBeFocused();
});

test("My Pull Requests rows show conflict, CI and open-comment badges", async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "My Pull Requests", exact: true }).click();
  const grid = page.getByRole("grid", { name: "My pull requests" });
  await expect(grid).toBeVisible();
  await expect(grid.getByText("Conflicts")).toBeVisible();
  // The demo reports a failed build for even pull request numbers.
  await expect(grid.getByText("CI failed").first()).toBeVisible();
});
