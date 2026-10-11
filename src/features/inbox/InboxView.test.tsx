import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { openExternalUrl } from "@/lib/openExternal";
import { NAVIGATE_PULL_REQUEST_EVENT } from "@/lib/crossLinks";
import { resetDemoInbox } from "@/lib/demo/actionInbox";
import { InboxView } from "./InboxView";

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
});

function renderView(props: { onOpenView?: (view: "pipelines") => void } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <InboxView {...props} />
    </QueryClientProvider>,
  );
}

const isApproval = (row: HTMLElement) => row.textContent?.startsWith("Approval") ?? false;
/** Derived rows: live pipeline approvals and agent replies waiting for the user. */
const isDerived = (row: HTMLElement) =>
  isApproval(row) || (row.textContent?.startsWith("Agent") ?? false);

/** Rows of stored items (everything except the derived rows). */
function storedRows(list: HTMLElement): HTMLElement[] {
  return within(list)
    .queryAllByRole("option")
    .filter((row) => !isDerived(row));
}

async function openList() {
  const list = await screen.findByRole("listbox", { name: "Inbox items" });
  await waitFor(() => {
    expect(storedRows(list)).toHaveLength(6);
  });
  return list;
}

/** Approvals are fetched live after the stored items, so wait for them. */
async function approvalRows(list: HTMLElement): Promise<HTMLElement[]> {
  await waitFor(() => {
    expect(within(list).queryAllByRole("option").filter(isApproval).length).toBeGreaterThan(0);
  });
  return within(list).getAllByRole("option").filter(isApproval);
}

function rowFor(list: HTMLElement, text: string): HTMLElement {
  const row = within(list)
    .getAllByRole("option")
    .find((candidate) => candidate.textContent?.includes(text));
  if (!row) throw new Error(`no row containing ${text}`);
  return row;
}

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
    expect(rows[2].textContent).toContain("Returned");
    expect(rows[2].textContent).toContain("!210 web-app");
    expect(rows[3].textContent).toContain("Reply");
    expect(rows[3].textContent).toContain("!103 api-gateway");
    expect(rows[4].textContent).toContain("!189 android-app");
    expect(rows[5].textContent).toContain("Assigned");
    expect(rows[5].textContent).toContain("#118 Platform");
  });

  it("shows tab counts and includes the derived approvals in Inbox", async () => {
    renderView();
    const list = await openList();
    await approvalRows(list);
    const derived = within(list).getAllByRole("option").filter(isDerived);

    const inboxTab = screen.getByRole("tab", { name: /Inbox/ });
    await waitFor(() => {
      expect(inboxTab.textContent).toContain(String(6 + derived.length));
    });
    expect(screen.getByRole("tab", { name: /Snoozed/ }).textContent).toContain("0");
    expect(screen.getByRole("tab", { name: /Done/ }).textContent).toContain("0");
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
      expect(storedRows(list)).toHaveLength(5);
    });
    expect(storedRows(list).some((row) => row.textContent?.includes("!42"))).toBe(false);

    fireEvent.click(screen.getByRole("tab", { name: /Done/ }));
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
    fireEvent.click(screen.getByRole("tab", { name: /Inbox/ }));
    const reopened = await screen.findByRole("listbox", { name: "Inbox items" });
    await waitFor(() => {
      expect(storedRows(reopened)).toHaveLength(6);
    });
  });

  it("snoozes through the shared menu and moves the item to the Snoozed tab", async () => {
    renderView();
    const list = await openList();
    fireEvent.click(rowFor(list, "!42"));

    fireEvent.keyDown(list, { key: "z" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /In 3 days/ }));

    await waitFor(() => {
      expect(storedRows(list)).toHaveLength(5);
    });
    fireEvent.click(screen.getByRole("tab", { name: /Snoozed/ }));
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

  it("votes on a review request with a and finishes the item", async () => {
    renderView();
    const list = await openList();
    fireEvent.click(rowFor(list, "!210"));
    expect(await screen.findByRole("button", { name: /^Approve\s*A$/ })).toBeTruthy();

    fireEvent.keyDown(list, { key: "a" });

    await waitFor(() => {
      expect(storedRows(list).some((row) => row.textContent?.includes("!210"))).toBe(false);
    });
    fireEvent.click(screen.getByRole("tab", { name: /Done/ }));
    const done = await screen.findByRole("listbox", { name: "Inbox items" });
    await waitFor(() => {
      expect(within(done).getAllByRole("option")[0].textContent).toContain("!210");
    });
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

  it("asks the agent about the selected item from its own tab with q", async () => {
    renderView();
    const list = await openList();
    fireEvent.click(rowFor(list, "!42"));

    fireEvent.keyDown(list, { key: "q" });
    const input = await screen.findByPlaceholderText(/the agent…/);
    expect(screen.getByRole("tab", { name: "Agent" }).getAttribute("aria-selected")).toBe("true");

    // The demo cannot launch a process; the failure is shown, not swallowed.
    fireEvent.change(input, { target: { value: "Is this null really impossible?" } });
    fireEvent.click(screen.getByRole("button", { name: /^(Ask|Answer)$/ }));
    expect(await screen.findByText(/only available in the desktop app/)).toBeTruthy();
  });

  it("opens the agent thread directly for an agent reply row", async () => {
    renderView();
    const list = await openList();
    await waitFor(() => {
      expect(within(list).queryAllByRole("option").some((row) => row.textContent?.startsWith("Agent"))).toBe(true);
    });
    const agentRow = within(list)
      .getAllByRole("option")
      .find((row) => row.textContent?.startsWith("Agent")) as HTMLElement;
    fireEvent.click(agentRow);

    expect(await screen.findByRole("heading", { name: /Agent ·/ })).toBeTruthy();
    // The row only exists to carry the agent's reply; the conversation points there.
    fireEvent.pointerDown(screen.getByRole("tab", { name: "Conversation" }), { button: 0 });
    expect(await screen.findByText(/answer it in the Agent panel/)).toBeTruthy();
  });

  it("does not offer Done or Snooze for a derived approval entry", async () => {
    renderView();
    const list = await openList();
    const [approval] = await approvalRows(list);
    fireEvent.click(approval);

    expect(await screen.findByRole("button", { name: /^Approve\s*A$/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Done/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Snooze/ })).toBeNull();
    // e does nothing to a derived entry.
    const before = within(list).getAllByRole("option").length;
    fireEvent.keyDown(list, { key: "e" });
    expect(within(list).getAllByRole("option")).toHaveLength(before);
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
