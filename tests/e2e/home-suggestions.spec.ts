import { expect, test, type Page } from "@playwright/test";

async function openHome(page: Page) {
  await page.goto("/");
  await page.getByRole("grid", { name: "My review pull requests" }).waitFor();
  await page.keyboard.press("g");
  await page.keyboard.press("h");
  const list = page.getByRole("listbox", { name: "Suggestions" });
  await expect(list).toBeFocused();
  return list;
}

test("Home lists suggestions by urgency and moves, expands and dismisses them by keyboard", async ({ page }) => {
  const list = await openHome(page);
  const options = list.getByRole("option");

  // Three rows show first; the Now rows lead.
  await expect(options).toHaveCount(3);
  await expect(options.nth(0)).toContainText("Now");
  await expect(options.nth(0)).toContainText("!798 の CI を直す");
  await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Show 2 more" })).toBeVisible();

  // Arrowing past the third row reveals the rest.
  for (let i = 0; i < 4; i += 1) await page.keyboard.press("ArrowDown");
  await expect(options).toHaveCount(5);
  await expect(options.nth(4)).toHaveAttribute("aria-selected", "true");
  await expect(options.nth(4)).toContainText("!790 の衝突を解消");
  await page.keyboard.press("ArrowDown");
  await expect(options.nth(4)).toHaveAttribute("aria-selected", "true");

  // E dismisses the last row and selects the one above, keeping focus on the list.
  await page.keyboard.press("e");
  await expect(options).toHaveCount(4);
  await expect(list).not.toContainText("!790 の衝突を解消");
  await expect(options.nth(3)).toHaveAttribute("aria-selected", "true");
  await expect(list).toBeFocused();

  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("e");
  await expect(list).not.toContainText("!798 の CI を直す");
  await expect(options.nth(0)).toContainText("!812 をレビュー");
  await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");
});

test("Q puts a suggestion's ask in the composer and sending it starts a worker", async ({ page }) => {
  const list = await openHome(page);
  const composer = page.getByRole("textbox", { name: "Message the Orchestrator" });

  await page.keyboard.press("q");
  await expect(composer).toHaveValue(/!798 の api-tests 失敗の原因を調べて/);
  await expect(page.getByRole("button", { name: "Remove !798" })).toBeVisible();

  await composer.focus();
  await page.keyboard.press("Enter");
  await expect(list).toBeFocused();
  await expect(list).not.toContainText("!798 の CI を直す");

  const chat = page.getByRole("log", { name: "Orchestrator chat" });
  await expect(chat).toContainText("!798 を claude の worker に依頼。");

  // W shows the worker; X then Enter stops it.
  await list.focus();
  await page.keyboard.press("w");
  const workers = page.getByRole("listbox", { name: "Workers" });
  await expect(workers).toBeFocused();
  const worker = workers.getByRole("option").first();
  await expect(worker).toContainText("Running");
  await expect(worker).toContainText("!798");
  await page.keyboard.press("x");
  await expect(worker.getByRole("alert")).toHaveText(/Stop\?/);
  await page.keyboard.press("Escape");
  await expect(worker.getByRole("alert")).toBeHidden();
  await expect(worker).toContainText("Running");
  await page.keyboard.press("x");
  await page.keyboard.press("Enter");
  await expect(worker).toContainText("Stopped");

  // Esc returns to the suggestions.
  await page.keyboard.press("Escape");
  await expect(list).toBeFocused();
});

test("L looks around again and the status follows it", async ({ page }) => {
  const list = await openHome(page);
  const lookNow = page.getByRole("button", { name: "Look now" });
  await expect(lookNow).toBeEnabled();
  await page.keyboard.press("l");
  await expect(page.getByText("Looking…")).toBeVisible();
  await expect(lookNow).toBeDisabled();
  await expect(page.getByText(/^Looked /)).toBeVisible({ timeout: 15_000 });
  await expect(lookNow).toBeEnabled();
  await expect(list).toBeFocused();
});

test("dismissing every suggestion leaves an empty state with a hint to look again", async ({ page }) => {
  const list = await openHome(page);
  for (let i = 0; i < 5; i += 1) await page.keyboard.press("e");
  await expect(list.getByRole("option")).toHaveCount(0);
  await expect(list).toContainText("Nothing needs you.");
  await expect(list).toContainText("L to look again");
});
