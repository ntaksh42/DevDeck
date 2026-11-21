import { expect, test, type Page } from "@playwright/test";

async function openPipelines(page: Page) {
  await page.goto("/");
  await page.getByRole("grid", { name: "My review pull requests" }).waitFor();
  await page.keyboard.press("g");
  await page.keyboard.press("p");
  await expect(page.locator("[data-board-header]").first()).toBeVisible();
}

/** Opens the failed CI run in the preview with the keyboard alone. */
async function openFailedCiRun(page: Page) {
  const ci = page.locator("[data-board-header]").filter({ hasText: "CI" });
  await ci.focus();
  await expect(ci).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");
  await expect(ci).toHaveAttribute("aria-expanded", "true");
  const grid = page.getByRole("grid", { name: "CI runs" });
  const failed = grid.getByRole("row", { name: /Failed 20260613\.4/ });
  await failed.click();
  await expect(failed).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  const preview = page.getByRole("tabpanel", { name: "Preview" });
  await expect(preview).toContainText("feature/login · pullRequest");
  return { grid, failed, preview };
}

test("watched pipeline headers move with J / K / Home / End and Enter folds a pipeline", async ({ page }) => {
  await openPipelines(page);
  const headers = page.locator("[data-board-header]");
  await expect(headers).toHaveText([/Nightly/, /CI/]);
  await headers.first().focus();
  await page.keyboard.press("j");
  await expect(headers.nth(1)).toBeFocused();
  await page.keyboard.press("k");
  await expect(headers.nth(0)).toBeFocused();
  await page.keyboard.press("End");
  await expect(headers.nth(1)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(headers.nth(0)).toBeFocused();

  // The board is one roving tab stop: only one header is tabbable.
  await expect(headers.nth(0)).toHaveAttribute("tabindex", "0");
  await expect(headers.nth(1)).toHaveAttribute("tabindex", "-1");

  const ci = headers.nth(1);
  await ci.focus();
  const expanded = await ci.getAttribute("aria-expanded");
  await page.keyboard.press("Enter");
  await expect(ci).toHaveAttribute("aria-expanded", expanded === "true" ? "false" : "true");
  await page.keyboard.press("Enter");
  await expect(ci).toHaveAttribute("aria-expanded", expanded ?? "false");
});

test("F jumps to the first failed step and its log; Esc returns to the run row", async ({ page }) => {
  await openPipelines(page);
  const { failed, preview } = await openFailedCiRun(page);

  await page.keyboard.press("f");
  const step = preview.getByRole("treeitem", { name: /Push to registry/ });
  await expect(step).toHaveAttribute("aria-selected", "true");
  await expect(step).toBeFocused();
  await expect(preview.getByRole("heading", { name: "Log — Push to registry" })).toBeVisible();
  await expect(preview).toContainText("##[error]unauthorized: authentication required");

  // Errors/warnings only keeps the failure lines and drops the rest.
  const errorsOnly = preview.getByRole("button", { name: /Errors\/warnings only/ });
  await errorsOnly.click();
  await expect(preview).toContainText("##[error]Process completed with exit code 1.");
  await expect(preview).not.toContainText("Login Succeeded");
  await errorsOnly.click();
  await expect(preview).toContainText("Login Succeeded");

  await step.focus();
  await page.keyboard.press("Escape");
  await expect(failed).toBeFocused();
});

test("R asks before re-running; Esc keeps the run and Enter on Re-run queues it", async ({ page }) => {
  await openPipelines(page);
  const { preview } = await openFailedCiRun(page);
  await preview.getByRole("tree", { name: "Run timeline" }).getByRole("treeitem").first().focus();

  await page.keyboard.press("r");
  const bar = page.getByRole("alertdialog", { name: "Queue a new run of CI on feature/login?" });
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(bar).toBeHidden();
  await expect(page.getByRole("button", { name: "View options" })).toBeFocused();

  await preview.getByRole("tree", { name: "Run timeline" }).getByRole("treeitem").first().focus();
  await page.keyboard.press("r");
  await expect(bar.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(bar.getByRole("button", { name: "Re-run" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(bar).toBeHidden();
  await expect(page.getByRole("button", { name: "View options" })).toBeFocused();

  // X on a finished run does not offer to cancel it.
  await preview.getByRole("tree", { name: "Run timeline" }).getByRole("treeitem").first().focus();
  await page.keyboard.press("x");
  await expect(page.getByRole("alertdialog", { name: "Cancel this run?" })).toBeHidden();
});

test("Delete on a pipeline header stops watching it", async ({ page }) => {
  await openPipelines(page);
  const headers = page.locator("[data-board-header]");
  const nightly = headers.filter({ hasText: "Nightly" });
  await nightly.focus();
  await page.keyboard.press("Delete");
  await expect(headers).toHaveText([/CI/]);
  await expect(page.getByRole("button", { name: "Remove Nightly from watched pipelines" })).toHaveCount(0);
});

test("queues a run from the keyboard: pick a pipeline, Esc cancels, Ctrl+Enter queues", async ({ page }) => {
  await openPipelines(page);
  const picker = page.getByRole("combobox", { name: "Pipeline", exact: true });
  const queueRun = page.getByRole("button", { name: "Queue run" });
  await expect(queueRun).toBeDisabled();

  await picker.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox", { name: "Pipeline" })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(picker).toHaveValue("Nightly");
  await expect(queueRun).toBeEnabled();

  await queueRun.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Queue Nightly" });
  const branch = dialog.getByRole("textbox", { name: "Branch" });
  await expect(branch).toBeFocused();
  await expect(branch).toHaveValue("main");
  await expect(dialog.getByRole("textbox", { name: "BuildConfiguration" })).toHaveValue("Release");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(queueRun).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(branch).toBeFocused();
  await branch.fill("release/2.0");
  await page.keyboard.press("Control+Enter");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "Queued Nightly #1005." })).toBeVisible();
});
