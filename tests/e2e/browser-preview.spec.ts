import { expect, test } from "@playwright/test";

test.describe("browser preview", () => {
  test("lets an agent exercise the main demo-data workflows", async ({ page }) => {
    await page.goto("/");
    const main = page.getByRole("main");

    await expect(main.getByRole("heading", { name: "Pull Requests" })).toBeVisible();
    await expect(main.getByText("Run a search to load pull requests.")).toBeVisible();

    await main.getByRole("button", { name: "Search" }).click();
    await expect(main.getByText("Add pull request search dashboard")).toBeVisible();
    await expect(main.getByText("Platform / azdo-dashboard")).toBeVisible();

    await page.getByRole("button", { name: "My Reviews" }).click();
    await expect(main.getByRole("heading", { name: "My Reviews" })).toBeVisible();
    await expect(main.getByRole("grid", { name: "My review pull requests" })).toBeVisible();
    await expect(main.getByText("Add rate limiting middleware to all endpoints")).toBeVisible();
    await expect(main.getByText(/件中 2 件が未投票/)).toBeVisible();
    await expect(main.getByRole("tab", { name: "Rejected" })).toHaveCount(0);

    const reviewGrid = main.getByRole("grid", { name: "My review pull requests" });
    await main.getByRole("button", { name: "Sort by PR#" }).click();
    await expect(reviewGrid.getByRole("row").first()).toContainText("#98");
    await main.getByRole("button", { name: "Sort by PR#" }).click();
    await expect(reviewGrid.getByRole("row").first()).toContainText("#101");

    await page.keyboard.press("3");
    await expect(main.getByText("Fix crash on back press during payment flow")).toBeVisible();
    await expect(main.getByText("Upgrade EKS cluster to 1.29")).toHaveCount(0);
    await page.keyboard.press("4");

    await main.getByPlaceholder("Filter by repo, title, author…").fill("auth");
    await expect(main.getByText("Migrate token signing to RS256")).toBeVisible();
    await expect(main.getByText("Add rate limiting middleware to all endpoints")).toHaveCount(0);

    await main.getByPlaceholder("Filter by repo, title, author…").fill("");
    await main.getByLabel("Show Drafts").check();
    await expect(main.getByText("Draft", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Work Items" }).click();
    await main.getByPlaceholder("title text").fill("onboarding");
    await main.getByRole("button", { name: "Search" }).click();
    await expect(main.getByText("Validate onboarding with PAT credentials")).toBeVisible();

    await page.getByRole("button", { name: "Commits" }).click();
    await main.getByPlaceholder("message, author, repository, SHA").fill("dashboard");
    await main.getByRole("button", { name: "Search" }).click();
    await expect(main.getByText("Add commit search dashboard")).toBeVisible();

    await page.getByRole("button", { name: "Settings" }).click();
    await expect(main.getByRole("heading", { name: "Organizations" })).toBeVisible();
    await expect(main.getByText("https://dev.azure.com/contoso")).toBeVisible();
  });
});
