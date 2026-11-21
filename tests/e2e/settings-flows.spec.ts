import { expect, test, type Page } from "@playwright/test";

async function openSettings(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await page.getByRole("grid", { name: "My review pull requests" }).waitFor();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
}

test("rebinds a go-to-view key with the keyboard, refuses conflicts and keeps it after a reload", async ({ page }) => {
  await openSettings(page);
  const pipelines = page.getByRole("button", { name: "Shortcut for Pipelines (Enter to rebind)" });
  const save = page.getByRole("button", { name: "Save shortcuts" });
  await expect(save).toBeDisabled();

  // Esc cancels a capture without changing the key.
  await pipelines.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(pipelines).toHaveText("P");
  await expect(pipelines).toBeFocused();

  // H belongs to Home: the conflict is shown and Save stays off.
  await page.keyboard.press("Enter");
  await page.keyboard.press("h");
  await expect(pipelines).toHaveText("H");
  await expect(page.getByText(/Conflicts with/).first()).toBeVisible();
  await expect(page.getByText("Resolve the highlighted conflicts before saving.")).toBeVisible();
  await expect(save).toBeDisabled();

  await pipelines.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("l");
  await expect(pipelines).toHaveText("L");
  await expect(page.getByText(/Conflicts with/)).toHaveCount(0);
  await save.click();

  await page.reload();
  await page.getByRole("grid", { name: "My review pull requests" }).waitFor();
  await page.keyboard.press("g");
  await page.keyboard.press("l");
  await expect(page.getByRole("heading", { name: "Pipelines", level: 1 })).toBeVisible();

  // Reset all restores P.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Reset all to defaults" }).click();
  await expect(pipelines).toHaveText("P");
  await save.click();
  await page.getByRole("button", { name: "Shortcut for My Reviews (Enter to rebind)" }).focus();
  await page.keyboard.press("Control+g");
  await page.keyboard.press("g");
  await page.keyboard.press("p");
  await expect(page.getByRole("heading", { name: "Pipelines", level: 1 })).toBeVisible();
});

test("Ctrl+F reaches the settings filter and Enter jumps to the first matching control", async ({ page }) => {
  await openSettings(page);
  const filter = page.getByRole("searchbox", { name: "Filter settings" });
  await expect(filter).toBeVisible();
  await page.keyboard.press("Control+f");
  await expect(filter).toBeFocused();
  await page.keyboard.type("theme");
  await expect(page.getByRole("heading", { name: "Connections" })).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("radio", { name: "Light" })).toBeFocused();

  await filter.focus();
  await page.keyboard.press("Escape");
  await expect(filter).toHaveValue("");
  await expect(filter).toBeFocused();
  await expect(page.getByRole("heading", { name: "Connections" })).toBeVisible();
});

test("theme choice applies at once and survives a reload", async ({ page }) => {
  await openSettings(page);
  const isDark = () => page.evaluate(() => document.documentElement.classList.contains("dark"));
  await page.getByRole("radio", { name: "Dark" }).check();
  await expect.poll(isDark).toBe(true);
  await page.reload();
  await expect.poll(isDark).toBe(true);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
  await page.getByRole("radio", { name: "Light" }).check();
  await expect.poll(isDark).toBe(false);
});

test("quiet hours enable their time fields only when switched on", async ({ page }) => {
  await openSettings(page);
  const quiet = page.getByRole("checkbox", { name: "Quiet hours" });
  const from = page.getByRole("textbox", { name: "From" });
  const to = page.getByRole("textbox", { name: "To" });
  await expect(from).toBeDisabled();
  await expect(to).toBeDisabled();
  await quiet.focus();
  await page.keyboard.press("Space");
  await expect(quiet).toBeChecked();
  await expect(from).toBeEnabled();
  await expect(to).toBeEnabled();
  await page.keyboard.press("Space");
  await expect(from).toBeDisabled();
});

test("read-only validation mode turns off pipeline re-run and stage retry", async ({ page }) => {
  await openSettings(page);
  await page.getByRole("checkbox", { name: "Read-only validation mode" }).check();
  const validation = page.locator("form").filter({ has: page.getByRole("checkbox", { name: "Read-only validation mode" }) });
  await validation.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Validation mode saved.")).toBeVisible();

  await page.getByRole("button", { name: "Pipelines", exact: true }).click();
  const ci = page.locator("[data-board-header]").filter({ hasText: "CI" });
  await ci.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("grid", { name: "CI runs" }).getByRole("row", { name: /Failed 20260613\.4/ }).click();
  await page.keyboard.press("Enter");
  const preview = page.getByRole("tabpanel", { name: "Preview" });
  await expect(preview).toContainText("feature/login · pullRequest");
  await expect(preview.getByRole("heading", { name: /Failed stages/ })).toHaveCount(0);
  await expect(preview.getByRole("button", { name: "Retry failed jobs" })).toHaveCount(0);

  // R does not offer a re-run, and the menu says why.
  await preview.getByRole("tree", { name: "Run timeline" }).getByRole("treeitem").first().focus();
  await page.keyboard.press("r");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await page.getByRole("button", { name: "View options" }).click();
  await expect(page.getByRole("menuitem", { name: "Re-run (read-only mode)" })).toBeDisabled();
});
