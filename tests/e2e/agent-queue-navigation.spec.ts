import { expect, test } from "@playwright/test";

test("automatic review has no approval step and manual queue execution remains keyboard accessible", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const automatic = page.getByLabel("Review pull requests and investigate work items automatically");
  await expect(automatic).toBeVisible();
  await expect(page.getByLabel("Choose what to run in Auto queue first")).toHaveCount(0);
  await automatic.focus();
  await page.keyboard.press("Space");
  await expect(automatic).toBeChecked();
  await automatic.locator("xpath=ancestor::form").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Agent command saved.")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Choose what the agent handles" })).toHaveCount(0);

  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button", { name: "Agent Work" }).click();
  await expect(page.getByRole("listbox", { name: "Needs attention agent work" })).toBeFocused();
  await page.keyboard.press("5");
  const list = page.getByRole("listbox", { name: "Auto queue candidates" });
  await expect(list).toBeFocused();
  const first = list.getByRole("option").first();
  const firstText = await first.innerText();
  const count = await list.getByRole("option").count();
  await page.keyboard.press("Space");
  await expect(first).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Control+Enter");
  await expect(list.getByRole("option")).toHaveCount(count - 1);
  await expect(list.getByRole("option").filter({ hasText: firstText })).toHaveCount(0);
  await expect(list).toBeFocused();
});

test("G then A opens Agent Work and Analyze is absent", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("azdodeck:keybindings:v1", JSON.stringify({ gotoAnalyze: "Z" }));
    localStorage.setItem("azdodeck:layout:navOrder", JSON.stringify(["analyze", "pipelines", "workItems", "pullRequests"]));
  });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(nav.getByRole("button", { name: "Agent Work" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Analyze", exact: true })).toHaveCount(0);
  await page.keyboard.press("g");
  await page.keyboard.press("a");
  await expect(page.getByRole("heading", { name: "Agent Work", exact: true })).toBeVisible();
  const attention = page.getByRole("listbox", { name: "Needs attention agent work" });
  await expect(attention).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(attention.getByRole("option", { selected: true })).toContainText("!101");
  await page.keyboard.press("Control+k");
  const input = page.getByPlaceholder("Type a command or search…");
  await input.fill("Go to Analyze");
  await expect(page.getByRole("option", { name: /Go to Analyze/ })).toHaveCount(0);
  await input.fill("Go to Agent Work");
  await page.keyboard.press("Enter");
  await expect(input).toHaveCount(0);
  await expect(attention).toBeFocused();
});

test("Agent Work navigation can be rebound", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("azdodeck:keybindings:v1", JSON.stringify({ gotoAutoQueue: "Z" })));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Pull Requests My Reviews" })).toBeVisible();
  await page.keyboard.press("g");
  await page.keyboard.press("a");
  await expect(page.getByRole("heading", { name: "Pull Requests My Reviews" })).toBeVisible();
  await page.keyboard.press("g");
  await page.keyboard.press("z");
  await expect(page.getByRole("heading", { name: "Agent Work", exact: true })).toBeVisible();
  await expect(page.getByRole("listbox", { name: "Needs attention agent work" })).toBeFocused();
});
