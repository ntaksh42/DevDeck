import { expect, test } from "@playwright/test";

const GROUPS = [
  {
    id: "g1",
    name: "Release blockers",
    organizationId: "",
    projectId: "p1",
    queries: [
      { id: "q1", name: "Open bugs (P1)", projectId: "", wiql: "SELECT [System.Id] FROM WorkItems" },
      { id: "q2", name: "Blocked tasks", projectId: "", wiql: "SELECT [System.Id] FROM WorkItems" },
    ],
    granularity: "week",
    rangeCount: 12,
  },
  {
    id: "g2",
    name: "Support backlog",
    organizationId: "",
    projectId: "p1",
    queries: [{ id: "q3", name: "Open tickets", projectId: "", wiql: "SELECT [System.Id] FROM WorkItems" }],
    granularity: "day",
    rangeCount: 30,
  },
];

test("Analyze sits on the dock with the Agent panel and keyboard flows", async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 900 });
  await page.addInitScript((groups) => {
    window.localStorage.setItem("azdodeck:analyze:groups", JSON.stringify(groups));
  }, GROUPS);
  await page.goto("/");
  await page.getByRole("button", { name: "Analyze" }).first().click();

  const groupRow = page.getByRole("button", { name: /^Release blockers [0-9]/ });
  await expect(groupRow).toBeVisible();
  await expect(page.getByRole("button", { name: "Add group" })).toBeVisible();
  await expect(page.getByText("2 items")).toBeVisible();
  await expect(page.getByRole("button", { name: "Week", exact: true })).toBeVisible();
  const panel = page.getByRole("complementary", { name: "Agent", exact: true });
  await expect(panel).toBeVisible();
  await expect(
    panel.locator("[data-agent-composer]").getByRole("button", { name: "Ask about Release blockers…" }),
  ).toBeVisible();

  // Keyboard: arrows move the selection, N opens the dialog, Esc returns focus to the row.
  await groupRow.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("button", { name: /^Support backlog [0-9]/ })).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("n");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Support backlog [0-9]/ })).toBeFocused();

  // Enter moves into the Trend pane, Escape returns to the list.
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-primary-preview='true']")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^Support backlog [0-9]/ })).toBeFocused();
});
