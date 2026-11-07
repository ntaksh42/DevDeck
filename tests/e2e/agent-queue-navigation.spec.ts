import { expect, test } from "@playwright/test";

test("G then A opens Agent Auto Queue and Analyze is absent", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("azdodeck:keybindings:v1", JSON.stringify({ gotoAnalyze: "Z" }));
    localStorage.setItem("azdodeck:layout:navOrder", JSON.stringify(["analyze", "pipelines", "workItems", "pullRequests"]));
  });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(nav.getByRole("button", { name: "Agent Auto Queue" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Analyze", exact: true })).toHaveCount(0);
  await page.keyboard.press("g");
  await page.keyboard.press("a");
  await expect(page.getByRole("heading", { name: "Agent Auto Queue", exact: true })).toBeVisible();
  await expect(page.getByRole("listbox", { name: "Auto queue candidates" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");
  await expect(page.getByRole("option", { selected: true })).toHaveCount(1);
  await page.keyboard.press("Control+k");
  const input = page.getByPlaceholder("Type a command or search…");
  await input.fill("Go to Analyze");
  await expect(page.getByRole("option", { name: /Go to Analyze/ })).toHaveCount(0);
  await input.fill("Go to Agent Auto Queue");
  await page.keyboard.press("Enter");
  await expect(input).toHaveCount(0);
  await expect(page.getByRole("listbox", { name: "Auto queue candidates" })).toBeFocused();
});

test("Agent Auto Queue navigation can be rebound", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("azdodeck:keybindings:v1", JSON.stringify({ gotoAutoQueue: "Z" })));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Pull Requests My Reviews" })).toBeVisible();
  await page.keyboard.press("g");
  await page.keyboard.press("a");
  await expect(page.getByRole("heading", { name: "Pull Requests My Reviews" })).toBeVisible();
  await page.keyboard.press("g");
  await page.keyboard.press("z");
  await expect(page.getByRole("heading", { name: "Agent Auto Queue", exact: true })).toBeVisible();
  await expect(page.getByRole("listbox", { name: "Auto queue candidates" })).toBeFocused();
});
