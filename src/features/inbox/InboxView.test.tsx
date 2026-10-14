import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPEN_AGENT_PANEL_EVENT, useAgentSubject, type OpenAgentPanelDetail } from "@/components/agent/agentSubject";
import { useAgentListScope } from "@/components/agent/agentListScope";
import { closeAgentPanel, resetAgentPanelState } from "@/components/agent/agentPanelStore";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { openExternalUrl } from "@/lib/openExternal";
import { NAVIGATE_PULL_REQUEST_EVENT } from "@/lib/crossLinks";
import { resetDemoInbox } from "@/lib/demo/actionInbox";
import { InboxView } from "./InboxView";
import { openList, renderView, rowFor, storedRows } from "./inboxViewTestUtils";

vi.mock("@/lib/openExternal", () => ({ openExternalUrl: vi.fn() }));

// The view reads the browser demo's seeded Inbox: stored items for PR !42
// (mention), !103 (reply), !189 (mention), !210 (returned for another review) and work item
// #123 (mention), plus the demo's pending pipeline approvals, which the view
// derives and lists too.

beforeEach(() => {
  resetDemoInbox();
  vi.mocked(openExternalUrl).mockClear();
});

afterEach(() => {
  cleanup();
  // The Agent panel's open state is app-wide; a test that opens it must not leak.
  resetAgentPanelState();
});

describe("InboxView", () => {
  it("lists stored items newest first with their kind labels", async () => {
    renderView();
    const list = await openList();
    const rows = storedRows(list);
    expect(rows[0].textContent).toContain("Mention");
    expect(rows[0].textContent).toContain("!42 azdo-dashboard");
    expect(rows[0].textContent).toContain("Add pull request search dashboard");
    expect(rows[1].textContent).toContain("WI mention");
    expect(rows[1].textContent).toContain("#123 Platform");
    expect(rows[2].textContent).toContain("Reply");
    expect(rows[2].textContent).toContain("!103 api-gateway");
    expect(rows[3].textContent).toContain("!189 android-app");
  });

  it("shows the item count and Done / Snoozed buttons in the status bar", async () => {
    renderView();
    await openList();
    await waitFor(() => {
      expect(screen.getByText("4 items")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "Snoozed 0" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Done 0" })).toBeTruthy();
    // The old Inbox / Snoozed / Done tabs and the key-hint footer are gone.
    expect(screen.queryByRole("tab", { name: /Done/ })).toBeNull();
    expect(screen.queryByText(/E done · Z snooze/)).toBeNull();
    expect(screen.getByRole("button", { name: "Show keyboard shortcuts for this view" })).toBeTruthy();
  });

  it("returns from the Done list with the chip and with Escape", async () => {
    renderView();
    const list = await openList();
    fireEvent.click(rowFor(list, "!42"));
    fireEvent.keyDown(list, { key: "e" });
    fireEvent.click(await screen.findByRole("button", { name: "Done 1" }));

    const done = await screen.findByRole("listbox", { name: "Inbox items" });
    await waitFor(() => {
      expect(within(done).getAllByRole("option")).toHaveLength(1);
    });
    fireEvent.click(screen.getByRole("button", { name: /Back to open list/ }));
    await waitFor(() => {
      expect(storedRows(screen.getByRole("listbox", { name: "Inbox items" }))).toHaveLength(3);
    });
    expect(screen.queryByRole("button", { name: /Back to open list/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Done 1" }));
    const again = await screen.findByRole("listbox", { name: "Inbox items" });
    await waitFor(() => {
      expect(within(again).getAllByRole("option")).toHaveLength(1);
    });
    fireEvent.keyDown(again, { key: "Escape" });
    await waitFor(() => {
      expect(storedRows(screen.getByRole("listbox", { name: "Inbox items" }))).toHaveLength(3);
    });
  });

  it("selects with j/k and shows the item in the preview", async () => {
    renderView();
    const list = await openList();
    fireEvent.click(rowFor(list, "!103"));

    expect(await screen.findByRole("heading", { name: /!103/ })).toBeTruthy();
    expect(rowFor(list, "!103").getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(list, { key: "j" });
    await waitFor(() => {
      expect(rowFor(list, "!103").getAttribute("aria-selected")).toBe("false");
    });
    fireEvent.keyDown(list, { key: "k" });
    await waitFor(() => {
      expect(rowFor(list, "!103").getAttribute("aria-selected")).toBe("true");
    });
  });

  it("finishes the selected item with e and lists it under Done", async () => {
    renderView();
    const list = await openList();
    fireEvent.click(rowFor(list, "!42"));
    fireEvent.keyDown(list, { key: "e" });

    await waitFor(() => {
      expect(storedRows(list)).toHaveLength(3);
    });
    expect(storedRows(list).some((row) => row.textContent?.includes("!42"))).toBe(false);

    fireEvent.click(await screen.findByRole("button", { name: "Done 1" }));
    const done = await screen.findByRole("listbox", { name: "Inbox items" });
    await waitFor(() => {
      expect(within(done).getAllByRole("option")).toHaveLength(1);
    });
    expect(within(done).getByRole("option").textContent).toContain("!42 azdo-dashboard");

    // e on a Done item reopens it.
    fireEvent.keyDown(done, { key: "e" });
    await waitFor(() => {
      expect(within(done).queryAllByRole("option")).toHaveLength(0);
    });
    fireEvent.click(screen.getByRole("button", { name: /^Done \d+$/ }));
    const reopened = await screen.findByRole("listbox", { name: "Inbox items" });
    await waitFor(() => {
      expect(storedRows(reopened)).toHaveLength(4);
    });
  });

  it("snoozes through the shared menu and moves the item to the Snoozed tab", async () => {
    renderView();
    const list = await openList();
    fireEvent.click(rowFor(list, "!42"));

    fireEvent.keyDown(list, { key: "z" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /In 3 days/ }));

    await waitFor(() => {
      expect(storedRows(list)).toHaveLength(3);
    });
    fireEvent.click(await screen.findByRole("button", { name: "Snoozed 1" }));
    const snoozed = await screen.findByRole("listbox", { name: "Inbox items" });
    await waitFor(() => {
      expect(within(snoozed).getAllByRole("option")).toHaveLength(1);
    });

    // z on a snoozed item wakes it.
    fireEvent.keyDown(snoozed, { key: "z" });
    await waitFor(() => {
      expect(within(snoozed).queryAllByRole("option")).toHaveLength(0);
    });
  });

  it("opens the selected pull request in the browser with Ctrl+Enter and o", async () => {
    renderView();
    const list = await openList();
    fireEvent.click(rowFor(list, "!42"));
    const url = "https://dev.azure.com/contoso/Platform/_git/azdo-dashboard/pullrequest/42";

    fireEvent.keyDown(list, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(list, { key: "o" });

    await waitFor(() => {
      expect(openExternalUrl).toHaveBeenCalledTimes(2);
    });
    expect(openExternalUrl).toHaveBeenCalledWith(url);
  });

  it("opens the pull request inside DevDeck with Shift+Enter", async () => {
    renderView();
    const list = await openList();
    fireEvent.click(rowFor(list, "!42"));
    const listener = vi.fn();
    window.addEventListener(NAVIGATE_PULL_REQUEST_EVENT, listener);

    fireEvent.keyDown(list, { key: "Enter", shiftKey: true });

    expect(listener).toHaveBeenCalledTimes(1);
    const detail = (listener.mock.calls[0][0] as CustomEvent).detail;
    expect(detail).toMatchObject({ pullRequestId: 42, repositoryId: "azdo-dashboard" });
    window.removeEventListener(NAVIGATE_PULL_REQUEST_EVENT, listener);
  });

  it("opens the browser from the preview and toolbar with Ctrl+Enter", async () => {
    renderView();
    const list = await openList();
    fireEvent.click(rowFor(list, "!42"));
    const heading = await screen.findByRole("heading", { name: /!42/ });
    fireEvent.keyDown(heading.closest('[data-primary-preview="true"]')!, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(screen.getByRole("button", { name: "Open in DevDeck (Shift+Enter)" }), { key: "Enter", ctrlKey: true });
    expect(openExternalUrl).toHaveBeenCalledTimes(2);
    expect(openExternalUrl).toHaveBeenCalledWith("https://dev.azure.com/contoso/Platform/_git/azdo-dashboard/pullrequest/42");
  });

  it("replies in place with R and Ctrl+Enter, then finishes the item", async () => {
    renderView();
    const list = await openList();
    fireEvent.click(rowFor(list, "!42"));
    const input = await screen.findByPlaceholderText("Reply…");
    fireEvent.keyDown(list, { key: "r" });
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.change(input, { target: { value: "Confirmed the null handling." } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    await waitFor(() => {
      expect(storedRows(list).some((row) => row.textContent?.includes("!42"))).toBe(false);
    });
    expect(openExternalUrl).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(within(list).getByRole("option", { selected: true })));
    // The row leaves at once; the stored state lands with the refetch.
    expect(await screen.findByRole("button", { name: "Done 1" })).toBeTruthy();
  });

  it("replies, resolves and finishes the item with Ctrl+Shift+Enter", async () => {
    renderView();
    const list = await openList();
    fireEvent.click(rowFor(list, "!189"));
    const input = await screen.findByPlaceholderText("Reply…");
    expect(screen.getByText(/Ctrl\+Shift\+Enter to post & resolve/)).toBeTruthy();
    fireEvent.change(input, { target: { value: "Added the test." } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true, shiftKey: true });
    await waitFor(() => {
      expect(storedRows(list).some((row) => row.textContent?.includes("!189"))).toBe(false);
    });
    expect(await screen.findByText("Resolved + done")).toBeTruthy();
    // Wait for the stored state so it does not land after the next test resets the demo.
    expect(await screen.findByRole("button", { name: "Done 1" })).toBeTruthy();
  });

  it("clears the reply draft when selecting another inbox thread", async () => {
    renderView();
    const list = await openList();
    fireEvent.click(rowFor(list, "!42"));
    fireEvent.change(await screen.findByPlaceholderText("Reply…"), { target: { value: "For PR 42 only" } });
    fireEvent.click(rowFor(list, "!189"));
    await screen.findByRole("heading", { name: /!189/ });
    await waitFor(() => expect((screen.getByPlaceholderText("Reply…") as HTMLTextAreaElement).value).toBe(""));
  });

  it("resolves the selected thread in place and finishes the item", async () => {
    renderView();
    const list = await openList();
    fireEvent.click(rowFor(list, "!42"));
    fireEvent.click(await screen.findByRole("button", { name: /^Resolve \+ Done/ }));
    await waitFor(() => {
      expect(storedRows(list).some((row) => row.textContent?.includes("!42"))).toBe(false);
    });
    expect(openExternalUrl).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Done 1" })).toBeTruthy();
  });

  it("shows a mentioned work item and finishes it by commenting", async () => {
    renderView();
    const list = await openList();
    fireEvent.click(rowFor(list, "#123"));

    expect(await screen.findByRole("heading", { name: /#123/ })).toBeTruthy();
    const input = await screen.findByPlaceholderText("Comment…");
    fireEvent.change(input, { target: { value: "Only the onboarding flow is affected." } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));

    await waitFor(() => {
      expect(storedRows(list).some((row) => row.textContent?.includes("#123"))).toBe(false);
    });
    expect(await screen.findByRole("button", { name: "Done 1" })).toBeTruthy();
  });

  it("replies to a work item comment by quoting it and mentioning its author", async () => {
    renderView();
    const list = await openList();
    fireEvent.click(rowFor(list, "#123"));

    const replyButtons = await screen.findAllByRole("button", { name: "Reply" });
    fireEvent.click(replyButtons[0]);

    const input = (await screen.findByPlaceholderText("Reply…")) as HTMLTextAreaElement;
    expect(input.value).toBe("> LGTM — shipped this in the last sprint, no blockers.\n\n@Alice Johnson ");
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(screen.getByText("Replying to Alice Johnson")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(((await screen.findByPlaceholderText("Comment…")) as HTMLTextAreaElement).value).toBe("");
  });

  it("opens the shared Agent panel on the selected pull request with q", async () => {
    const opened: OpenAgentPanelDetail[] = [];
    const listener = (event: Event) => opened.push((event as CustomEvent<OpenAgentPanelDetail>).detail);
    window.addEventListener(OPEN_AGENT_PANEL_EVENT, listener);
    renderView();
    const list = await openList();
    fireEvent.click(rowFor(list, "!42"));

    fireEvent.keyDown(list, { key: "q" });
    window.removeEventListener(OPEN_AGENT_PANEL_EVENT, listener);
    expect(opened).toHaveLength(1);
    expect(opened[0].subject).toMatchObject({ kind: "pull-request", id: 42 });
    // The shared panel docks into the Inbox workspace as its own tab.
    expect(await screen.findByRole("complementary", { name: "Agent" })).toBeTruthy();
    act(() => closeAgentPanel());
  });

  it("filters the list by text", async () => {
    renderView();
    const list = await openList();

    fireEvent.keyDown(list, { key: "/" });
    const input = await screen.findByLabelText("Filter inbox items");
    fireEvent.change(input, { target: { value: "android" } });

    await waitFor(() => {
      expect(within(list).getAllByRole("option")).toHaveLength(1);
    });
    expect(within(list).getByRole("option").textContent).toContain("!189 android-app");
  });
});

describe("InboxView Agent context", () => {
  function Probe() {
    const subject = useAgentSubject();
    const scope = useAgentListScope();
    return (
      <>
        <output data-testid="subject">{subject ? JSON.stringify(subject) : ""}</output>
        <output data-testid="list">{scope ? `${scope.id}:${scope.count}` : ""}</output>
      </>
    );
  }
  function renderWithProbe() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Probe />
        <InboxView />
      </QueryClientProvider>,
    );
  }
  const published = () => screen.getByTestId("subject").textContent ?? "";

  it("publishes the selected entry's pull request with its thread, and the work item for a WI entry", async () => {
    renderWithProbe();
    const list = await openList();
    fireEvent.click(rowFor(list, "!42"));
    await waitFor(() => expect(published()).toContain('"kind":"pull-request"'));
    const pr = JSON.parse(published());
    expect(pr).toMatchObject({ id: 42, repositoryName: "azdo-dashboard" });
    expect(pr.threadId).toBeGreaterThan(0);

    fireEvent.click(rowFor(list, "#123"));
    await waitFor(() => expect(JSON.parse(published())).toMatchObject({ kind: "work-item", id: 123 }));
  });

  it("offers the visible entries as the Inbox list, following the text filter", async () => {
    renderWithProbe();
    const list = await openList();
    await waitFor(() => expect(screen.getByTestId("list").textContent).toMatch(/^inbox:\d+$/));
    const total = Number(screen.getByTestId("list").textContent?.split(":")[1]);
    expect(total).toBe(within(list).getAllByRole("option").length);

    fireEvent.keyDown(list, { key: "/" });
    fireEvent.change(await screen.findByLabelText("Filter inbox items"), { target: { value: "android" } });
    await waitFor(() => expect(screen.getByTestId("list").textContent).toBe("inbox:1"));
  });
});
