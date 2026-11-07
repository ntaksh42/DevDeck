import { expect, test, type Page } from "@playwright/test";

async function openSearch(page: Page, suffix = "") {
  await page.goto(`/${suffix}`);
  await page.getByRole("grid", { name: "My review pull requests" }).waitFor();
  await page.getByRole("navigation", { name: "Primary navigation" })
    .getByRole("button", { name: "Search", exact: true }).first().click();
  return page.getByRole("main");
}

function queryInput(page: Page) {
  return page.getByRole("main").locator('input[data-filter-input="true"]').first();
}

async function search(page: Page, query: string) {
  const input = queryInput(page);
  await input.click();
  await input.fill(query);
  await input.press("Enter");
}

function resultGrid(page: Page) {
  return page.getByRole("grid", { name: "Pull request search results", exact: true });
}

function searchMore(page: Page) {
  return page.getByRole("button", { name: /^(Search more|Continue search)$/ });
}

test("PR search starts simple and cancels filter drafts with the keyboard", async ({ page }) => {
  const main = await openSearch(page);
  await expect(main.getByRole("combobox", { name: "Author", exact: true })).toHaveCount(0);
  await expect(main.getByRole("button", { name: "Change status filter", exact: true })).toHaveText("Active + Completed");

  const filters = main.getByRole("button", { name: /^Filters/ });
  await filters.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("combobox", { name: "Author", exact: true })).toBeFocused();
  await expect(dialog.getByLabel("From", { exact: true })).not.toBeVisible();
  await dialog.getByRole("checkbox", { name: "Completed", exact: true }).uncheck();
  await dialog.getByRole("combobox", { name: "Author", exact: true }).press("Escape");
  await expect(dialog).toBeHidden();
  await expect(filters).toBeFocused();

  await filters.press("Enter");
  await expect(dialog.getByRole("checkbox", { name: "Completed", exact: true })).toBeChecked();
  await dialog.getByRole("button", { name: "Use me as author", exact: true }).click();
  await dialog.getByRole("button", { name: "Apply & search", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(filters).toBeFocused();
  const grid = resultGrid(page);
  await expect(grid.getByText("Add pull request search dashboard", { exact: true })).toBeVisible();
  await expect(grid.getByText("Add OpenTelemetry tracing support", { exact: true })).toHaveCount(0);
  const authorChip = main.getByRole("button", { name: "Remove author filter", exact: true });
  await expect(authorChip).toBeVisible();
  await authorChip.click();
  await expect(grid.getByText("Add OpenTelemetry tracing support", { exact: true })).toBeVisible();
});

test("PR search resolves a person with arrows and Enter before applying", async ({ page }) => {
  const main = await openSearch(page);
  await main.getByRole("button", { name: /^Filters/ }).click();
  const dialog = page.getByRole("dialog");
  const author = dialog.getByRole("combobox", { name: "Author", exact: true });
  await author.fill("Frank");
  await expect(dialog.getByRole("option", { name: /Frank Lee/ })).toBeVisible();
  await author.press("ArrowDown");
  await author.press("Enter");
  await expect(author).toHaveValue("Frank Lee");
  await expect(author).toBeFocused();
  await dialog.getByRole("button", { name: "Apply & search", exact: true }).click();
  await expect(resultGrid(page).getByText("Fix crash on back press during payment flow", { exact: true })).toBeVisible();
  await expect(resultGrid(page).getByText("Add pull request search dashboard", { exact: true })).toHaveCount(0);
});

test("PR search combines words, phrases, exclusions and exact PR numbers", async ({ page }) => {
  await openSearch(page);
  await search(page, "dashboard search");
  await expect(resultGrid(page).getByText("Add pull request search dashboard", { exact: true })).toBeVisible();
  await search(page, '"pull request" dashboard');
  await expect(resultGrid(page).getByText("Add pull request search dashboard", { exact: true })).toBeVisible();
  await search(page, "dashboard -search");
  await expect(page.getByText(/No (matching PRs|pull requests matched)/)).toBeVisible();
  await search(page, "#42");
  await expect(resultGrid(page).getByText("Add pull request search dashboard", { exact: true })).toBeVisible();
  await expect(resultGrid(page).locator('[role="row"][aria-selected]')).toHaveCount(1);
  await search(page, '"unclosed');
  await expect(page.getByRole("alert").filter({ hasText: /quotation|quote|phrase/i })).toBeVisible();
});

test("PR search appends more than 100 matches without changing the selected PR", async ({ page }) => {
  const main = await openSearch(page, "?scenario=large-data");
  await main.getByRole("button", { name: "Search", exact: true }).click();
  const grid = resultGrid(page);
  const selected = grid.locator('[role="row"][aria-selected="true"]').first();
  await expect(selected).toBeVisible();
  await selected.focus();
  await page.keyboard.press("ArrowDown");
  const selectedText = await selected.textContent();
  await expect(searchMore(page)).toBeVisible();
  await searchMore(page).click();
  await expect(main.getByText(/1[0-9]{2} found/)).toBeVisible();
  await expect(selected).toHaveText(selectedText ?? "");
  await expect(selected).toBeFocused();
  await expect(searchMore(page)).toBeHidden();
  await expect(main.getByText(/Search complete/)).toBeVisible();
  await expect(resultGrid(page).locator('[role="row"][aria-selected="true"]').first()).toBeFocused();
});

test("zero matches during exploration still offers another search page", async ({ page }) => {
  const main = await openSearch(page, "?prSearchScenario=empty-first");
  await main.getByRole("button", { name: "Search", exact: true }).click();
  await expect(main.getByText(/^No matches yet/)).toBeVisible();
  await expect(searchMore(page)).toBeVisible();
  await searchMore(page).click();
  await expect(resultGrid(page).getByText("Add pull request search dashboard", { exact: true })).toBeVisible();
  await expect(main.getByText(/^No matches yet/)).toBeHidden();
});

test("a partial search retains results and retries the failed scope", async ({ page }) => {
  const main = await openSearch(page, "?prSearchScenario=partial");
  await main.getByRole("button", { name: "Search", exact: true }).click();
  await expect(resultGrid(page).getByText("Add pull request search dashboard", { exact: true })).toBeVisible();
  const retry = main.getByRole("button", { name: /Retry failed scopes/i });
  await expect(retry).toBeVisible();
  await expect(main.getByText(/Search complete/)).toHaveCount(0);
  await retry.click();
  await expect(retry).toBeHidden();
  await expect(resultGrid(page).getByText("Add pull request search dashboard", { exact: true })).toBeVisible();
  await expect(main.getByText(/Search complete/)).toBeVisible();
  await expect(resultGrid(page).locator('[role="row"][aria-selected="true"]').first()).toBeFocused();
});


test("PR search can stop and then resume a slow first exploration", async ({ page }) => {
  const main = await openSearch(page, "?scenario=slow-network");
  await main.getByRole("button", { name: "Search", exact: true }).click();
  await main.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(searchMore(page)).toBeVisible();
  await expect(main.getByText(/^No matches yet/)).toBeVisible();
  await searchMore(page).click();
  await expect(resultGrid(page).getByText("Add pull request search dashboard", { exact: true })).toBeVisible();
  await expect(main.getByText(/Search complete/)).toBeVisible();
  await expect(resultGrid(page).locator('[role="row"][aria-selected="true"]').first()).toBeFocused();
});
