import { expect, test, type Page } from "@playwright/test";

test.setTimeout(60_000);

async function start(page: Page, key: string) {
  await page.setViewportSize({ width: 1800, height: 900 });
  await page.goto("/");
  await page.getByRole("grid", { name: "My review pull requests" }).waitFor({ timeout: 15_000 });
  await page.keyboard.press("g");
  await page.keyboard.press(key);
}

for (const view of [
  { name: "My Reviews", key: "r" },
  { name: "My Work Items", key: "w" },
  { name: "Inbox", key: "i" },
  { name: "PR Search", key: "q" },
  { name: "Work Item Search", key: "f" },
  { name: "Work Item Views", key: "v" },
]) {
  test(`${view.name}: arrows move between editable previews and grid rows`, async ({ page }) => {
    await start(page, view.key);
    if (view.key === "q") await page.getByRole("main").getByRole("button", { name: "Search", exact: true }).click();
    if (view.key === "f") {
      await page.getByPlaceholder("Search work items…").fill("onboarding");
      await page.getByRole("main").getByRole("button", { name: "Search", exact: true }).click();
    }
    const grid = page.locator("[data-primary-grid='true']:visible").first();
    const row = grid.locator("[role='row'][aria-selected='true'], [role='option'][aria-selected='true']").first();
    const preview = view.key === "r" || view.key === "q"
      ? page.locator("[data-focus-pane='review'] [data-primary-preview='true']")
      : page.locator("[data-primary-preview='true']:visible").first();
    if (view.key === "r" || view.key === "q") {
      await page.locator("[data-focus-pane='review'] [data-pane-editable='true']").waitFor();
    }
    await row.focus();
    await page.keyboard.press("ArrowRight");
    await expect(preview).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(row).toBeFocused();
    await page.keyboard.press("Control+g");
    await expect(row).toBeFocused();
  });
}

test("My Pull Requests uses the same arrow navigation", async ({ page }) => {
  await start(page, "r");
  await page.getByRole("complementary").first().getByRole("button", { name: "My Pull Requests", exact: true }).click();
  const row = page.getByRole("grid", { name: "My pull requests" }).getByRole("row", { selected: true }).first();
  await row.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("[data-focus-pane='review'] [data-primary-preview='true']")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(row).toBeFocused();
  await page.keyboard.press("Control+g");
  await expect(row).toBeFocused();
});

test("PR preview and Agent body support a complete left/right round trip", async ({ page }) => {
  await start(page, "r");
  const row = page.getByRole("grid", { name: "My review pull requests" }).getByRole("row", { selected: true }).first();
  const preview = page.locator("[data-focus-pane='review'] [data-primary-preview='true']");
  const agent = page.getByLabel("Agent conversations");
  await row.focus();
  await page.keyboard.press("ArrowRight");
  await expect(preview).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(agent).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(agent).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(preview).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(row).toBeFocused();
  await page.keyboard.press("Control+g");
  await expect(row).toBeFocused();
});

test("moving Conversation to the left changes arrow focus direction", async ({ page }) => {
  await start(page, "r");
  await page.getByRole("button", { name: "Move Conversation panel", exact: true }).click();
  await page.getByRole("menuitem", { name: "Split left of Reviews", exact: true }).click();
  const row = page.getByRole("grid", { name: "My review pull requests" }).getByRole("row", { selected: true }).first();
  const preview = page.locator("[data-focus-pane='review'] [data-primary-preview='true']");
  await row.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(preview).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(preview).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(row).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByLabel("Agent conversations")).toBeFocused();
  await page.keyboard.press("Control+g");
  await expect(row).toBeFocused();
});

test("Work Item preview columns and iframe body follow pane focus", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("azdodeck:wiPreview:commentsLayout", JSON.stringify("side")));
  await start(page, "w");
  const row = page.locator("[data-primary-grid='true']:visible [role='row'][aria-selected='true']").first();
  const main = page.locator("[data-focus-pane='work-item-details']");
  const side = page.locator("[data-focus-pane='work-item-side']");
  await row.focus();
  await page.keyboard.press("ArrowRight");
  await expect(main).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(side).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(main).toBeFocused();
  const body = main.frameLocator("iframe").first().locator("body");
  await body.evaluate((element) => {
    element.tabIndex = -1;
    element.ownerDocument.getSelection()?.removeAllRanges();
    element.focus();
  });
  await page.keyboard.press("ArrowRight");
  await expect(side).toBeFocused();
});

test("Notifications and the Agent drawer support arrows without a dock", async ({ page }) => {
  await start(page, "n");
  const row = page.getByRole("grid", { name: "Notifications" }).getByRole("row", { selected: true }).first();
  const agent = page.getByLabel("Agent conversations");
  await row.focus();
  await page.keyboard.press("ArrowRight");
  await expect(agent).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(row).toBeFocused();
  await page.keyboard.press("Control+g");
  await expect(row).toBeFocused();
});

test("Pipelines skips the read-only Preview while tree arrows stay local", async ({ page }) => {
  await start(page, "p");
  const pane = page.locator("[data-focus-pane='grid']");
  await pane.getByRole("button", { expanded: false }).filter({ hasText: "CI" }).first().click();
  const row = pane.getByRole("row").first();
  await row.click();
  await row.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByLabel("Agent conversations")).toBeFocused();
  await page.keyboard.press("Control+p");
  await expect(page.locator("[data-primary-preview='true']:visible")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(row).toBeFocused();
  await page.keyboard.press("Control+g");
  await expect(row).toBeFocused();
  const tree = page.getByRole("tree");
  const node = tree.getByRole("treeitem").first();
  await node.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => tree.evaluate((element) => element.contains(document.activeElement))).toBe(true);
});

test("Analyze group rows skip the read-only Trend pane", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("azdodeck:analyze:groups", JSON.stringify([{
    id: "g1", name: "Release blockers", organizationId: "", projectId: "p1",
    queries: [{ id: "q1", name: "Open bugs", projectId: "", wiql: "SELECT [System.Id] FROM WorkItems" }],
    granularity: "week", rangeCount: 12,
  }])));
  await start(page, "a");
  const row = page.locator("[data-pane-focus-row='true']").first();
  await row.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByLabel("Agent conversations")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(row).toBeFocused();
  await page.keyboard.press("Control+g");
  await expect(row).toBeFocused();
});

test("reply inputs and Agent conversation folding keep their arrow behavior", async ({ page }) => {
  await start(page, "r");
  const preview = page.locator("[data-focus-pane='review']");
  await preview.getByRole("button", { name: "Reply", exact: true }).click();
  const reply = preview.getByPlaceholder("Reply…", { exact: true });
  await reply.fill("abc");
  await reply.press("ArrowLeft");
  await expect(reply).toBeFocused();
  expect(await reply.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(2);
  const conversation = page.getByRole("complementary", { name: "Agent", exact: true }).locator("button[aria-expanded]").first();
  await conversation.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(conversation).toBeFocused();
  await expect(conversation).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("ArrowRight");
  await expect(conversation).toHaveAttribute("aria-expanded", "true");
});

test("Settings body can reach the Agent drawer without stealing control arrows", async ({ page }) => {
  await start(page, "s");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  const view = page.locator("[data-focus-pane='view']");
  const agent = page.getByLabel("Agent conversations");
  await expect(agent).toHaveCount(0);
  await view.focus();
  await page.keyboard.press("Control+j");
  await expect(agent).toBeVisible();
  await view.focus();
  await page.keyboard.press("ArrowRight");
  await expect(agent).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(agent).toBeFocused();
});

test("Result HTML is skipped between editable Conversation and Agent panes", async ({ page }) => {
  await start(page, "r");
  await page.getByRole("tab", { name: "Result", exact: true }).click();
  await page.getByRole("button", { name: "Move Result panel", exact: true }).click();
  await page.getByRole("menuitem", { name: "Split right of Conversation", exact: true }).click();
  const preview = page.locator("[data-focus-pane='review'] [data-primary-preview='true']");
  const agent = page.getByLabel("Agent conversations");
  await preview.focus();
  await page.keyboard.press("ArrowRight");
  await expect(agent).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(preview).toBeFocused();
  const result = page.locator("[data-focus-pane='result']");
  await result.focus();
  await page.keyboard.press("ArrowRight");
  await expect(agent).toBeFocused();
});
