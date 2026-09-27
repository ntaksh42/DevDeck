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
    await expect(main.getByRole("grid", { name: "Pull request search results" }).getByText("Add pull request search dashboard")).toBeVisible();
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
    await expect(main.getByRole("button", { name: "Open the result in your browser" })).toHaveAttribute(
      "title",
      /review-PR101\.html/,
    );
    await expect(page.getByRole("separator", { name: "Resize navigation" })).toBeVisible();
    await expect(main.getByRole("separator", { name: "Resize Conversation" })).toBeVisible();

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

    // The filter is folded into the Reviews tab strip until opened.
    await main.getByRole("button", { name: "Filter reviews" }).click();
    await main.getByPlaceholder("Filter by repo, title, author…").fill("auth");
    await expect(reviewGrid.getByText("Migrate token signing to RS256")).toBeVisible();
    await expect(reviewGrid.getByText("Add rate limiting middleware to all endpoints")).toHaveCount(0);

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
    await expect(main.getByRole("separator", { name: "Resize Preview" })).toBeVisible();
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
    // Author/branch/date live behind the collapsed "Filters" panel, which only
    // starts open when one of those filters already has a value.
    await main.getByRole("button", { name: /^Filters/ }).click();
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
    await expect(main.getByRole("heading", { name: "Connections" })).toBeVisible();
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
      main.getByRole("grid", { name: "Pull request search results" }).getByText("Add pull request search dashboard #1", { exact: true }),
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

test("adds a searched field as a Work Item View column from the Columns menu", async ({ page }) => {
  await page.goto("/");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "My Reviews" })).toBeVisible();
  await page.keyboard.press("g");
  await page.keyboard.press("v");

  await main.getByRole("button", { name: "Columns" }).click();
  const menu = page.getByRole("menu", { name: "Visible columns" });
  const search = menu.getByLabel("Search fields to add as columns");
  await search.focus();
  await search.fill("prio");
  await expect(menu.getByRole("button", { name: /Severity/ })).toHaveCount(0);
  await search.press("Enter");

  await expect(main.getByRole("columnheader", { name: "Priority" })).toBeVisible();
  await expect(menu.getByLabel("Remove column Microsoft.VSTS.Common.Priority")).toBeChecked();
  await expect(search).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(page.locator('[data-primary-grid="true"]')).toBeFocused();
});

test("snoozes a Work Item View row with Z and lists it under Snoozed", async ({ page }) => {
  await page.goto("/");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "My Reviews" })).toBeVisible();
  await page.keyboard.press("g");
  await page.keyboard.press("v");

  const grid = page.locator('[data-primary-grid="true"]');
  const firstRow = grid.getByRole("row").first();
  await firstRow.click();
  await expect(firstRow).toBeFocused();
  const rowCount = await grid.getByRole("row").count();

  await page.keyboard.press("z");
  const menu = page.getByRole("menu", { name: "Snooze until" });
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(menu).toHaveCount(0);
  await expect(grid.getByRole("row")).toHaveCount(rowCount - 1);
  await expect
    .poll(() => grid.evaluate((node) => node.contains(document.activeElement)))
    .toBe(true);

  await main.getByRole("button", { name: "Snoozed" }).click();
  const unsnooze = main.getByRole("button", { name: "Unsnooze" });
  await expect(unsnooze).toHaveCount(1);
  await unsnooze.click();
  await main.getByRole("button", { name: "Back to inbox" }).click();
  await expect(grid.getByRole("row")).toHaveCount(rowCount);
});

test("leaves an agent note on a PR review result with R", async ({ page }) => {
  await page.goto("/");
  const main = page.getByRole("main");
  const reviewGrid = main.getByRole("grid", { name: "My review pull requests" });
  await reviewGrid.getByText("Add rate limiting middleware to all endpoints").click();
  await page.keyboard.press("r");
  const frame = page.locator("[data-agent-result-frame='true']");
  await expect(main.getByText("1 needs you")).toBeVisible();
  await expect(frame).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("c");
  const composer = main.getByRole("textbox", { name: "Note to the agent" });
  await expect(composer).toBeFocused();
  await composer.fill("Please re-check this paragraph.");
  await page.keyboard.press("Control+Enter");
  await expect(main.getByText("1 open")).toBeVisible();
  await expect(frame).toBeFocused();

  // The help shortcut still reaches the app while the result has focus.
  await page.keyboard.press("?");
  await expect(page.getByRole("button", { name: "Close keyboard shortcuts" })).toBeVisible();
});

test("keeps focus on a done agent note after a reply reopens it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^My Items/ }).click();
  const main = page.getByRole("main");
  await main.getByText("Validate onboarding with PAT credentials").first().click();
  await page.keyboard.press("r");
  await expect(page.locator("[data-agent-result-frame='true']")).toBeFocused();

  // Done notes are folded under their header; Enter opens it.
  await main.getByRole("button", { name: "Done (1)" }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  const doneNote = main.locator('[data-agent-note-id="20260925-174000.md"]');
  await expect(doneNote).toBeFocused();
  await page.keyboard.press("r");
  const reply = main.getByRole("textbox", { name: "Reply to note 20260925-174000.md" });
  await expect(reply).toBeFocused();
  await reply.fill("Please also check release.");
  await page.keyboard.press("Control+Enter");

  await expect(main.getByText("2 open")).toBeVisible();
  await expect(main.locator('[data-agent-note-id="20260925-174000.md"]')).toBeFocused();
});

test("manages agent notes from the keyboard", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^My Items/ }).click();
  const main = page.getByRole("main");
  await main.getByText("Validate onboarding with PAT credentials").first().click();
  await page.keyboard.press("r");
  await expect(page.locator("[data-agent-result-frame='true']")).toBeFocused();
  const note = main.locator('[data-agent-note-id="20260926-091500.md"]');

  // Collapse to one line and back.
  await note.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(note.getByRole("button", { name: "Expand note" })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(note.getByRole("button", { name: "Collapse note" })).toBeVisible();

  // Drafts wait until they are sent together.
  await page.keyboard.press("c");
  const composer = main.getByRole("textbox", { name: "Note to the agent" });
  await expect(composer).toBeFocused();
  await composer.fill("First draft");
  await page.keyboard.press("Alt+Enter");
  await expect(main.getByText("1 draft not sent yet")).toBeVisible();
  await main.getByRole("button", { name: "Send all" }).click();
  await expect(main.getByText("2 open")).toBeVisible();

  // Delete, then undo.
  await note.focus();
  await page.keyboard.press("Delete");
  await expect(main.getByText("Note deleted.")).toBeVisible();
  await expect(note).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(note).toBeVisible();

  // Resolve moves it under Done.
  await note.focus();
  await page.keyboard.press("x");
  await expect(main.getByRole("button", { name: "Done (2)" })).toBeVisible();
});

test("opens the collapsed Work Items dock to half the column after a reload", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.goto("/");
  const main = page.getByRole("main");
  const selectPr = () =>
    main
      .getByRole("grid", { name: "My review pull requests" })
      .getByText("Add rate limiting middleware to all endpoints")
      .click();
  const groupHeight = (title: string) =>
    page.evaluate(
      (name) =>
        [...document.querySelectorAll(".dv-groupview")]
          .find((group) => group.querySelector(".dv-tab")?.textContent === name)
          ?.getBoundingClientRect().height ?? 0,
      title,
    );
  await selectPr();

  // Moving the dock while collapsed keeps it collapsed.
  await main.getByRole("button", { name: "Move Work Items panel" }).click();
  await page
    .getByRole("menu", { name: "Move Work Items" })
    .getByRole("menuitem", { name: "Split below Conversation" })
    .click();
  await expect.poll(() => groupHeight("Work Items")).toBeLessThan(30);
  // The layout is saved on a debounce; reload once the move is persisted.
  await expect
    .poll(() =>
      page.evaluate(() => {
        type Node = { type: string; data: Node[] | { views: string[] } };
        const views = (node: Node): string[] =>
          node.type === "leaf" ? (node.data as { views: string[] }).views : (node.data as Node[]).flatMap(views);
        // True once the saved layout has Work Items in the same split as Conversation.
        const sharesSplit = (node: Node): boolean =>
          node.type === "branch" &&
          ((node.data as Node[]).some((child) => child.type === "leaf" && views(child).includes("linkedWorkItems"))
            ? (node.data as Node[]).some((child) => views(child).includes("review"))
            : (node.data as Node[]).some(sharesSplit));
        return Object.keys(localStorage).some((key) => {
          if (!key.endsWith(":schema:v3")) return false;
          const root = JSON.parse(localStorage.getItem(key) ?? "{}")?.grid?.root;
          return !!root && sharesSplit(root);
        });
      }),
    )
    .toBe(true);

  await page.reload();
  await selectPr();
  await main.getByRole("button", { name: "Show linked work items" }).click();
  await expect
    .poll(async () => Math.abs((await groupHeight("Work Items")) - (await groupHeight("Conversation"))))
    .toBeLessThan(40);
});
