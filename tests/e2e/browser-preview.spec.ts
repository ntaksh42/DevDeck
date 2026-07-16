import { expect, test } from "@playwright/test";

test.describe("browser preview", () => {
  test("lets an agent exercise the main demo-data workflows", async ({ page }) => {
    await page.goto("/");
    const main = page.getByRole("main");
    const sidebar = page.getByRole("complementary").first();

    await expect(main.getByRole("heading", { name: "My Reviews" })).toBeVisible();
    await sidebar.getByRole("button", { name: "Search" }).first().click();
    await expect(main.getByRole("heading", { name: "Pull Requests" })).toBeVisible();
    await expect(main.getByText("Run a search to load pull requests.")).toBeVisible();

    await main.getByRole("button", { name: "Search" }).click();
    await expect(main.getByText("Add pull request search dashboard")).toBeVisible();
    await expect(main.getByText("Platform / azdo-dashboard")).toBeVisible();

    await page.getByRole("button", { name: "My Reviews" }).click();
    await expect(main.getByRole("heading", { name: "My Reviews" })).toBeVisible();
    await expect(main.getByRole("grid", { name: "My review pull requests" })).toBeVisible();
    const reviewGrid = main.getByRole("grid", { name: "My review pull requests" });
    await expect(
      reviewGrid.getByText("Add rate limiting middleware to all endpoints"),
    ).toBeVisible();
    await expect(main.getByText(/6 total,\s*2 not voted/)).toBeVisible();
    await expect(main.getByRole("tab", { name: "Rejected" })).toHaveCount(0);

    // The PR review panel shows the selected PR with vote actions and comments.
    // Voting is a "Your vote" combobox (Approve/Suggestions/Wait/Reject/No vote).
    await expect(main.getByRole("combobox", { name: "Your vote" })).toBeVisible();
    await expect(main.getByText("Could you add a test for the empty case?")).toBeVisible();

    // The local review-result preview lives on the Result tab.
    await main.getByRole("tab", { name: "Result" }).click();
    await expect(main.getByText("review-PR101.html", { exact: true })).toBeVisible();
    await expect(page.getByRole("separator", { name: "Resize navigation" })).toBeVisible();
    await expect(main.getByRole("separator", { name: "Resize review preview" })).toBeVisible();

    await main.getByRole("button", { name: "Sort by PR#" }).click();
    await expect(reviewGrid.getByRole("row").first()).toContainText("#98");
    await main.getByRole("button", { name: "Sort by PR#" }).click();
    await expect(reviewGrid.getByRole("row").first()).toContainText("#101");

    // Sections expand by clicking their header (My Reviews groups PRs by the
    // reviewer's next action). Expanding "Waiting for author" reveals its PR
    // while the still-collapsed "Rejected" section keeps its PR hidden.
    await main.getByRole("button", { name: /Waiting for author/ }).click();
    await expect(main.getByText("Fix crash on back press during payment flow")).toBeVisible();
    await expect(main.getByText("Upgrade EKS cluster to 1.29")).toHaveCount(0);

    await main.getByRole("button", { name: /Approved by you/ }).click();
    await expect(main.getByText("Dark mode support for settings screen")).toBeVisible();
    await expect(main.getByText("Add OpenTelemetry tracing support")).toBeVisible();
    await expect(main.getByText("Upgrade EKS cluster to 1.29")).toHaveCount(0);
    await main.getByRole("button", { name: /Rejected by you/ }).click();

    await main.getByPlaceholder("Filter by repo, title, author…").fill("auth");
    await expect(main.getByText("Migrate token signing to RS256")).toBeVisible();
    await expect(main.getByText("Add rate limiting middleware to all endpoints")).toHaveCount(0);

    await main.getByPlaceholder("Filter by repo, title, author…").fill("");
    await main.getByLabel("Show Drafts").check();
    // Draft PRs land in their own collapsed "Drafts" section; expand it to see them.
    await main.getByRole("button", { name: /Drafts/ }).click();
    await expect(main.getByText("Draft", { exact: true })).toBeVisible();

    await sidebar.getByRole("button", { name: "Search" }).nth(1).click();
    await main.getByPlaceholder("Search work items…").fill("onboarding");
    await main.getByRole("button", { name: "Search" }).click();
    await expect(main.getByRole("button", { name: "Edit title" })).toContainText(
      "Validate onboarding with PAT credentials",
    );
    await expect(main.getByRole("separator", { name: "Resize work item preview" })).toBeVisible();
    await expect(
      main.frameLocator('iframe[title="Description"]').getByText("Fetch detail fields from Azure DevOps"),
    ).toBeVisible();
    const commentInput = main.getByRole("textbox", { name: "Comment" });
    await commentInput.fill("@Ali");
    await main.getByRole("button", { name: /Alice Johnson/ }).click();
    await commentInput.fill("@Alice Johnson please check");
    await main.getByRole("button", { name: "Post comment" }).click();
    await expect(main.getByText("Comment posted")).toBeVisible();

    await page.getByRole("button", { name: "Commits" }).click();
    await main.getByPlaceholder("message, author, SHA — or path:src/auth").fill("dashboard");
    await expect(main.getByLabel("Project")).toBeVisible();
    await expect(main.getByLabel("Repository")).toBeVisible();
    await main.getByRole("button", { name: "Filters", exact: true }).click();
    await main.getByLabel("From", { exact: true }).fill("2026-05-01");
    await main.getByLabel("To", { exact: true }).fill("2026-05-28");
    await main.getByRole("button", { name: "Search" }).click();
    await expect(main.getByText("Add commit search dashboard").first()).toBeVisible();

    // The "/" grid shortcut must return focus to the commit search field.
    const commitGrid = main.getByRole("grid", { name: "Commit search results" });
    await commitGrid.getByRole("row").filter({ hasText: "Add commit search dashboard" }).click();
    await page.keyboard.press("/");
    await expect(main.getByRole("textbox", { name: "Filter" })).toBeFocused();

    await page.getByRole("button", { name: "Settings" }).click();
    await expect(main.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    await expect(main.getByRole("heading", { name: "Review result previews" })).toBeVisible();
    await expect(main.getByRole("heading", { name: "Sync health" })).toBeVisible();
    await expect(main.getByText("Pull requests / My Reviews")).toBeVisible();
    await expect(main.getByText("https://dev.azure.com/contoso")).toBeVisible();
  });

  test("renders rich Azure DevOps work item content through the demo harness", async ({
    page,
  }) => {
    await page.goto("/?scenario=rich-text");
    const main = page.getByRole("main");
    const sidebar = page.getByRole("complementary").first();

    await sidebar.getByRole("button", { name: "Search" }).nth(1).click();
    await main.getByPlaceholder("Search work items…").fill("onboarding");
    await main.getByRole("button", { name: "Search" }).click();

    await expect(
      main.frameLocator('iframe[title="Description"]').getByText("rich Azure DevOps content"),
    ).toBeVisible();
    await expect(
      main.frameLocator('iframe[title="Description"]').getByText("Renders through fetch_work_item_image"),
    ).toBeVisible();
  });

  test("can exercise large demo datasets", async ({ page }) => {
    await page.goto("/?scenario=large-data");
    const main = page.getByRole("main");
    const sidebar = page.getByRole("complementary").first();

    await sidebar.getByRole("button", { name: "Search" }).first().click();
    await main.getByRole("button", { name: "Search" }).click();

    await expect(
      main.getByText("Add pull request search dashboard #1", { exact: true }),
    ).toBeVisible();
    await expect(
      main.getByText("Refactor authentication flow with OAuth 2.0 PKCE #2", {
        exact: true,
      }),
    ).toBeVisible();
  });

  test("can mention the current demo user when posting a work item comment", async ({
    page,
  }) => {
    await page.goto("/");
    const main = page.getByRole("main");
    const sidebar = page.getByRole("complementary").first();

    await sidebar.getByRole("button", { name: "Search" }).nth(1).click();
    await main.getByPlaceholder("Search work items…").fill("onboarding");
    await main.getByRole("button", { name: "Search" }).click();

    const commentInput = main.getByRole("textbox", { name: "Comment" });
    await commentInput.fill("@Demo");
    await main.getByRole("button", { name: /Demo User/ }).click();
    await expect(commentInput).toHaveValue(/^@Demo User /);

    await commentInput.fill("@Demo User checking mention flow");
    await main.getByRole("button", { name: "Post comment" }).click();
    await expect(main.getByText("Comment posted")).toBeVisible();
  });
});
