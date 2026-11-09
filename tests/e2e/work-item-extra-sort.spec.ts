import { expect, test } from "@playwright/test";

test("sorts an optional field column with Enter and Space and keeps it after reload", async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("extra-sort-seeded")) return;
    localStorage.setItem("extra-sort-seeded", "true");
    localStorage.setItem("azdodeck:workItemQueryViews", JSON.stringify([{
      id: "extra-sort", name: "Extra sort", projectId: "",
      wiql: "SELECT [System.Id] FROM WorkItems",
      extraColumns: ["Microsoft.VSTS.Common.Priority"],
    }]));
  });
  await page.goto("/");
  await page.getByRole("grid", { name: "My review pull requests" }).waitFor();
  await page.keyboard.press("g");
  await page.keyboard.press("v");
  const sort = page.getByRole("button", { name: "Sort by Priority", exact: true });
  const header = sort.locator("xpath=ancestor::*[@role='columnheader']");
  await expect(sort).toBeVisible();
  await sort.focus();
  await page.keyboard.press("Enter");
  await expect(header).toHaveAttribute("aria-sort", "ascending");
  await sort.focus();
  await page.keyboard.press("Space");
  await expect(header).toHaveAttribute("aria-sort", "descending");
  await page.reload();
  await expect(sort).toBeVisible();
  await expect(header).toHaveAttribute("aria-sort", "descending");
});
