import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { organization, renderApp } from "./test/appTestHelpers";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invokeMock(command, args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: () => Promise.resolve(),
  openPath: () => Promise.resolve(),
}));

const viewResults = [
  {
    organizationId: "contoso",
    projectId: "project-1",
    projectName: "Platform",
    id: 321,
    title: "Fix view query workflow",
    workItemType: "Bug",
    state: "Active",
    assignedTo: "Test User",
    changedDate: "2026-05-24T00:00:00Z",
    webUrl: "https://dev.azure.com/contoso/project/_workitems/edit/321",
  },
];

/** Opens the Views screen with a single saved view already selected. */
async function openViewsScreen() {
  renderApp();
  const main = within(await screen.findByRole("main"));
  // Some tests call this twice in one test to verify a setting survives a
  // remount, and the dockable layout itself now also persists across
  // remounts -- so the second call may already land on Work Item Views
  // instead of My Reviews. Wait for the nav to be interactive rather than
  // for My Reviews' specific content, which is not guaranteed to render.
  const nav = within(screen.getByRole("navigation", { name: "Primary navigation" }));
  await waitFor(() => {
    if ((nav.getByRole("button", { name: "Views" }) as HTMLButtonElement).disabled) {
      throw new Error("nav not ready yet");
    }
  });
  fireEvent.click(nav.getByRole("button", { name: "Views" }));
  return main;
}

async function addView(main: ReturnType<typeof within>, name: string) {
  fireEvent.click(await main.findByRole("button", { name: /Add/ }));
  await screen.findByRole("dialog", { name: "Add View" });
  await main.findByText("Platform");
  fireEvent.change(main.getByLabelText("Name"), { target: { value: name } });
  fireEvent.change(main.getByLabelText("Project"), { target: { value: "project-1" } });
  fireEvent.change(main.getByLabelText("WIQL"), {
    target: {
      value: "SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] = 'Bug'",
    },
  });
}

describe("App — Work Item Views UX", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    window.localStorage.clear();
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_app_settings") {
        return Promise.resolve({ reviewResultFolderPath: null });
      }
      if (command === "get_review_result_preview") return Promise.resolve(null);
      if (command === "list_sync_states") return Promise.resolve([]);
      if (command === "trigger_sync") return Promise.resolve(undefined);
      if (command === "list_organizations") return Promise.resolve([organization]);
      if (command === "get_active_organization") return Promise.resolve(organization);
      if (command === "list_my_review_pull_requests") return Promise.resolve([]);
      if (command === "list_work_item_projects") {
        return Promise.resolve([{ projectId: "project-1", projectName: "Platform" }]);
      }
      if (command === "run_work_item_query") return Promise.resolve(viewResults);
      if (command === "count_work_item_query") return Promise.resolve(7);
      if (command === "list_work_item_fields") return Promise.resolve([]);
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
  });

  afterEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    cleanup();
  });

  it("shows the views as one row of chips by default and switches to cards with the toggle", async () => {
    await openViewsScreen();
    const list = await screen.findByRole("listbox", { name: "Saved work item views" });
    // Chip row: no card density switch, one option per view.
    expect(screen.queryByRole("button", { name: "Compact view list" })).toBeNull();
    const firstView = within(list).getAllByRole("option")[0];
    expect(firstView.textContent).toContain("Assigned to me");

    const expandToggle = screen.getByRole("button", { name: /Show view cards/ });
    expect(expandToggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(expandToggle);

    // The card display is back, with its density switch, and focus is on a card.
    const cards = screen.getByRole("listbox", { name: "Saved work item views" });
    expect(within(cards).getAllByRole("option").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Compact view list" })).toBeTruthy();
    const collapseToggle = screen.getByRole("button", { name: /Collapse to one row of chips/ });
    expect(collapseToggle.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(collapseToggle);
    expect(screen.queryByRole("button", { name: "Compact view list" })).toBeNull();
    // Focus lands on the toggle rather than <body> so the keyboard is not stranded.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: /Show view cards/ })),
    );
  });

  it("moves the selected chip with the arrow keys", async () => {
    await openViewsScreen();
    const list = await screen.findByRole("listbox", { name: "Saved work item views" });
    const options = within(list).getAllByRole("option");
    expect(options.length).toBeGreaterThan(1);
    fireEvent.click(options[0]);
    expect(options[0].getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(options[0], { key: "ArrowRight" });
    await waitFor(() =>
      expect(
        within(screen.getByRole("listbox", { name: "Saved work item views" }))
          .getAllByRole("option")[1]
          .getAttribute("aria-selected"),
      ).toBe("true"),
    );
  });

  it("keeps pin, preview and reorder reachable from the chip row's more menu", async () => {
    await openViewsScreen();
    await screen.findByRole("listbox", { name: "Saved work item views" });
    expect(screen.queryByRole("button", { name: "Pin selected view" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "More view actions" }));
    const menu = await screen.findByRole("menu", { name: "More view actions" });
    expect(within(menu).getByRole("menuitem", { name: /Pin view|Unpin view/ })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: /Hide preview|Show preview/ })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: /Move view right/ })).toBeTruthy();
  });

  it("restores the card display on the next visit", async () => {
    await openViewsScreen();
    await screen.findByRole("listbox", { name: "Saved work item views" });
    fireEvent.click(screen.getByRole("button", { name: /Show view cards/ }));
    cleanup();

    await openViewsScreen();
    expect(await screen.findByRole("button", { name: /Collapse to one row of chips/ })).toBeTruthy();
  });

  it("switches the card list to the compact density and persists it", async () => {
    await openViewsScreen();
    await screen.findByRole("listbox", { name: "Saved work item views" });
    fireEvent.click(screen.getByRole("button", { name: /Show view cards/ }));

    const compact = screen.getByRole("button", { name: "Compact view list" });
    expect(compact.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(compact);
    expect(compact.getAttribute("aria-pressed")).toBe("true");
    // Every view is still selectable in the denser layout.
    expect(
      within(screen.getByRole("listbox", { name: "Saved work item views" })).getAllByRole("option")
        .length,
    ).toBeGreaterThan(0);

    cleanup();
    await openViewsScreen();
    await screen.findByRole("listbox", { name: "Saved work item views" });
    expect(screen.getByRole("button", { name: "Compact view list" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("moves through WIQL completions with the arrow keys and applies one with Enter", async () => {
    const main = await openViewsScreen();
    await addView(main, "Keyboard view");

    const wiql = main.getByLabelText("WIQL") as HTMLTextAreaElement;
    fireEvent.change(wiql, { target: { value: "SELECT [System.Id] FROM WorkItems WHERE Sys" } });

    const list = await screen.findByRole("listbox", { name: "WIQL completions" });
    const options = within(list).getAllByRole("option");
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    expect(wiql.getAttribute("aria-activedescendant")).toBe(options[0].id);

    fireEvent.keyDown(wiql, { key: "ArrowDown" });
    await waitFor(() =>
      expect(
        within(screen.getByRole("listbox", { name: "WIQL completions" }))
          .getAllByRole("option")[1]
          .getAttribute("aria-selected"),
      ).toBe("true"),
    );

    // The first child span holds the completion's field reference name.
    const secondLabel =
      within(screen.getByRole("listbox", { name: "WIQL completions" })).getAllByRole("option")[1]
        .firstElementChild?.textContent ?? "";
    expect(secondLabel).not.toBe("");

    fireEvent.keyDown(wiql, { key: "Enter" });

    await waitFor(() =>
      expect((main.getByLabelText("WIQL") as HTMLTextAreaElement).value).toContain(secondLabel),
    );
  });

  it("closes the completion list with Escape without closing the dialog", async () => {
    const main = await openViewsScreen();
    await addView(main, "Escape view");

    const wiql = main.getByLabelText("WIQL");
    fireEvent.change(wiql, { target: { value: "SELECT [System.Id] FROM WorkItems WHERE Sys" } });
    await screen.findByRole("listbox", { name: "WIQL completions" });

    fireEvent.keyDown(wiql, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("listbox", { name: "WIQL completions" })).toBeNull(),
    );
    // The dialog stays open, so Escape did not fall through to it.
    expect(screen.getByRole("dialog", { name: "Add View" })).toBeTruthy();
  });

  it("reformats the draft query from the Format button", async () => {
    const main = await openViewsScreen();
    await addView(main, "Format view");

    const wiql = main.getByLabelText("WIQL") as HTMLTextAreaElement;
    fireEvent.change(wiql, {
      target: {
        value:
          "select [System.Id] from WorkItems where [System.State] = 'Active' and [System.Id] > 5 order by [System.Id] desc",
      },
    });

    fireEvent.click(main.getByRole("button", { name: /Format/ }));

    await waitFor(() =>
      expect((main.getByLabelText("WIQL") as HTMLTextAreaElement).value).toBe(
        [
          "SELECT [System.Id]",
          "FROM WorkItems",
          "WHERE [System.State] = 'Active'",
          "  AND [System.Id] > 5",
          // Clause keywords are normalized; the sort direction the user typed is left alone.
          "ORDER BY [System.Id] desc",
        ].join("\n"),
      ),
    );
  });

  it("reports the matching count from a test run without saving the view", async () => {
    const main = await openViewsScreen();
    await addView(main, "Tested view");

    fireEvent.click(main.getByRole("button", { name: /^Test$/ }));

    expect(await screen.findByText(/7 matching work items/)).toBeTruthy();
    // Still on the dialog: testing must not save or close it.
    expect(screen.getByRole("dialog", { name: "Add View" })).toBeTruthy();
  });

  it("reports a validation failure from the test run without calling the backend", async () => {
    const main = await openViewsScreen();
    await addView(main, "Invalid view");

    fireEvent.change(main.getByLabelText("WIQL"), { target: { value: "not a query" } });
    invokeMock.mockClear();
    fireEvent.click(main.getByRole("button", { name: /^Test$/ }));

    // The message lands in the test-result strip, not only the inline validation
    // list. `role="status"` is no longer unique -- the dockable layout adds its
    // own visually-hidden live region for screen-reader announcements -- so find
    // the one that actually carries this message.
    const status = await waitFor(() => {
      const match = screen
        .getAllByRole("status")
        .find((el) => /WIQL must start with SELECT/.test(el.textContent ?? ""));
      if (!match) throw new Error("validation status not found yet");
      return match;
    });
    expect(status.textContent).toMatch(/WIQL must start with SELECT/);
    expect(
      invokeMock.mock.calls.some(([command]) => command === "count_work_item_query"),
    ).toBe(false);
  });

  it("expands the WIQL editor and shrinks it again", async () => {
    const main = await openViewsScreen();
    await addView(main, "Expanded view");

    const expand = main.getByRole("button", { name: /Expand/ });
    expect(expand.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(expand);

    const shrink = await main.findByRole("button", { name: /Shrink/ });
    expect(shrink.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(shrink);
    expect(main.getByRole("button", { name: /Expand/ }).getAttribute("aria-pressed")).toBe("false");
  });
});
