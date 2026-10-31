import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Organization } from "@/lib/azdoCommands";

const searchWiki = vi.fn();
const searchAll = vi.fn();
const getActiveOrganization = vi.fn();
const listActionInboxItems = vi.fn();
const setActionInboxItemState = vi.fn();
const setActiveOrganization = vi.fn();

vi.mock("@/lib/azdoCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/azdoCommands")>()),
  searchWiki: (...args: unknown[]) => searchWiki(...args),
  searchAll: (...args: unknown[]) => searchAll(...args),
  getActiveOrganization: () => getActiveOrganization(),
  listActionInboxItems: (...args: unknown[]) => listActionInboxItems(...args),
  setActionInboxItemState: (...args: unknown[]) => setActionInboxItemState(...args),
  setActiveOrganization: (...args: unknown[]) => setActiveOrganization(...args),
}));

import { usePaletteSearch } from "./usePaletteSearch";
import { clearToasts, getSnapshot } from "@/lib/toast";

const organizations = [
  { id: "org-1", name: "first" },
  { id: "org-2", name: "second" },
] as unknown as Organization[];
const callbacks = {
  setWorkItemSearchRequest: vi.fn(),
  setPullRequestSearchRequest: vi.fn(),
  setView: vi.fn(),
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("usePaletteSearch wiki search", () => {
  const hit = {
    fileName: "Deploy-Guide.md",
    pagePath: "/Deploy Guide",
    projectId: "p-1",
    projectName: "Platform",
    wikiId: "w-1",
    wikiName: "Platform.wiki",
    webUrl: "https://dev.azure.com/contoso/Platform/_wiki/wikis/Platform.wiki?pagePath=%2FDeploy%20Guide",
  };

  beforeEach(() => {
    searchWiki.mockReset();
    getActiveOrganization.mockReset().mockResolvedValue(organizations[1]);
  });
  afterEach(cleanup);

  it("lists wiki pages behind the wiki: prefix and opens the in-app preview", async () => {
    searchWiki.mockResolvedValue({ count: 1, results: [hit], notice: null });
    const opened = vi.fn();
    window.addEventListener("azdodeck:wiki:open-page", opened);
    const { result } = renderHook(() => usePaletteSearch(true, organizations, callbacks), {
      wrapper,
    });

    act(() => result.current.setPaletteSearchText("wiki: deploy"));

    await waitFor(() => {
      expect(result.current.paletteSearchItems.map((item) => item.label)).toEqual([
        "/Deploy Guide",
      ]);
    });
    expect(searchWiki).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-2", query: "deploy" }),
    );

    act(() => result.current.paletteSearchItems[0].run());
    window.removeEventListener("azdodeck:wiki:open-page", opened);
    expect(opened).toHaveBeenCalledTimes(1);
    expect((opened.mock.calls[0][0] as CustomEvent).detail).toEqual({
      organizationId: "org-2",
      hit,
    });
  });

  it("shows a single unavailable row when wiki search fails", async () => {
    searchWiki.mockRejectedValue(new Error("403"));
    const { result } = renderHook(() => usePaletteSearch(true, organizations, callbacks), {
      wrapper,
    });

    act(() => result.current.setPaletteSearchText("wiki: deploy"));

    await waitFor(() => {
      expect(result.current.paletteSearchItems.map((item) => item.label)).toEqual([
        "Wiki Search is unavailable",
      ]);
    });
  });
});

describe("usePaletteSearch pasted links", () => {
  const linkedOrganizations = [
    { id: "org-1", name: "contoso", baseUrl: "https://dev.azure.com/contoso" },
  ] as unknown as Organization[];

  beforeEach(() => {
    searchAll.mockReset().mockResolvedValue({ workItems: [], pullRequests: [{ pullRequestId: 123, organizationId: "org-1", title: "Live PR" }], totals: { workItems: 0, pullRequests: 1 }, warnings: [] });
    getActiveOrganization.mockReset().mockResolvedValue(linkedOrganizations[0]);
    callbacks.setPullRequestSearchRequest.mockReset();
    callbacks.setView.mockReset();
  });
  afterEach(cleanup);

  it("opens a pasted pull request URL instead of searching the text", async () => {
    const { result } = renderHook(
      () => usePaletteSearch(true, linkedOrganizations, callbacks),
      { wrapper },
    );

    act(() =>
      result.current.setPaletteSearchText(
        "https://dev.azure.com/contoso/Web/_git/site/pullrequest/123",
      ),
    );

    await waitFor(() => {
      expect(result.current.paletteSearchItems.map((item) => item.label)).toEqual([
        "Open pull request !123",
      ]);
    });
    expect(result.current.paletteSearchEnabled).toBe(false);
    expect(searchAll).not.toHaveBeenCalled();

    act(() => result.current.paletteSearchItems[0].run());
    await waitFor(() => expect(callbacks.setPullRequestSearchRequest).toHaveBeenCalledWith(
      expect.objectContaining({ query: "123", organizationId: "org-1", pullRequest: expect.objectContaining({ title: "Live PR" }) }),
    ));
    expect(callbacks.setView).toHaveBeenCalledWith("pullRequestSearch");
  });
});

describe("usePaletteSearch cross-organization targets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    getActiveOrganization.mockResolvedValue(organizations[0]);
    setActiveOrganization.mockReset().mockImplementation(async () => {
      getActiveOrganization.mockResolvedValue(organizations[1]);
      return organizations[1];
    });
    searchAll.mockResolvedValue({
      workItems: [{ id: 42, organizationId: "org-2", title: "Target item" }],
      pullRequests: [{ pullRequestId: 42, organizationId: "org-2", repositoryId: "repo", title: "Target PR" }],
      totals: { workItems: 1, pullRequests: 1 },
    });
  });
  afterEach(cleanup);

  it.each([0, 1])("switches connections before opening search result %i", async (index) => {
    const { result } = renderHook(() => usePaletteSearch(true, organizations, callbacks), { wrapper });
    act(() => result.current.setPaletteSearchText("target"));
    await waitFor(() => expect(result.current.paletteSearchItems).toHaveLength(2));
    act(() => result.current.paletteSearchItems[index].run());
    await waitFor(() => expect(setActiveOrganization).toHaveBeenCalledWith("org-2"));
    await waitFor(() => expect(callbacks.setView).toHaveBeenCalledWith(index === 0 ? "workItems" : "pullRequestSearch"));
    expect(await getActiveOrganization()).toEqual(organizations[1]);
  });

  it("only lists recent items from the current organization", async () => {
    window.localStorage.setItem("azdodeck:workItems:recent", JSON.stringify(["org-1", "org-2"].map((organizationId) => ({
      key: `${organizationId}:p:42`, id: 42, organizationId, projectId: "p", projectName: "Project",
      title: "Target", viewedAt: new Date().toISOString(), webUrl: null,
    }))));
    const { result } = renderHook(() => usePaletteSearch(true, organizations, callbacks), { wrapper });
    await waitFor(() => expect(result.current.paletteRecentItems).toHaveLength(1));
    searchAll.mockResolvedValue({ workItems: [{ id: 42, organizationId: "org-1", title: "Target" }], pullRequests: [], totals: { workItems: 1, pullRequests: 0 }, warnings: [] });
    act(() => result.current.paletteRecentItems[0].run());
    await waitFor(() => expect(callbacks.setWorkItemSearchRequest).toHaveBeenCalled());
    expect(setActiveOrganization).not.toHaveBeenCalled();
    expect(callbacks.setWorkItemSearchRequest).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", query: "42" }),
    );
  });

  it("scopes normal searches to the active organization", async () => {
    const { result } = renderHook(() => usePaletteSearch(true, organizations, callbacks), { wrapper });
    act(() => result.current.setPaletteSearchText("target"));
    await waitFor(() => expect(searchAll).toHaveBeenCalledWith({ organizationId: "org-1", query: "target" }));
  });

  it("clears previous results when the active organization changes", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["activeOrganization"], organizations[0]);
    const { result } = renderHook(() => usePaletteSearch(true, organizations, callbacks), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    act(() => result.current.setPaletteSearchText("target"));
    await waitFor(() => expect(result.current.paletteSearchItems).toHaveLength(2));
    searchAll.mockReturnValue(new Promise(() => {}));
    act(() => client.setQueryData(["activeOrganization"], organizations[1]));
    await waitFor(() => expect(searchAll).toHaveBeenLastCalledWith({ organizationId: "org-2", query: "target" }));
    expect(result.current.paletteSearchItems).toEqual([]);
  });

  it("puts an exact PR ID ahead of work item title matches while keeping groups together", async () => {
    searchAll.mockResolvedValue({ workItems: [{ id: 118, organizationId: "org-1", title: "Handle 429 errors" }],
      pullRequests: [{ pullRequestId: 42, organizationId: "org-1", title: "Target PR" }],
      totals: { workItems: 1, pullRequests: 1 } });
    const { result } = renderHook(() => usePaletteSearch(true, organizations, callbacks), { wrapper });
    act(() => result.current.setPaletteSearchText("42"));
    await waitFor(() => expect(result.current.paletteSearchItems).toHaveLength(2));
    expect(result.current.paletteSearchItems[0].label).toBe("PR 42 Target PR");
  });

  it("shows partial-search warnings and an honest limit notice", async () => {
    searchAll.mockResolvedValue({ workItems: [{ id: 42, title: "Target", organizationId: "org-1" }], pullRequests: [],
      totals: { workItems: 6, pullRequests: 0 }, warnings: ["PR search failed: 401"] });
    const { result } = renderHook(() => usePaletteSearch(true, organizations, callbacks), { wrapper });
    act(() => result.current.setPaletteSearchText("target"));
    await waitFor(() => expect(result.current.paletteSearchItems).toHaveLength(1));
    expect(result.current.paletteSearchStatus).toContain("PR search failed: 401");
    expect(result.current.paletteSearchStatus).toContain("Refine your search");
    expect(result.current.paletteSearchStatus).toContain("Demo data only");
    act(() => result.current.setPaletteSearchText("another"));
    expect(result.current.paletteSearchItems).toEqual([]);
  });

  it("reports API failures and sends an explicit kind for prefixed searches", async () => {
    searchAll.mockRejectedValue(new Error("permission denied"));
    const { result } = renderHook(() => usePaletteSearch(true, organizations, callbacks), { wrapper });
    act(() => result.current.setPaletteSearchText("wi: #42"));
    await waitFor(() => expect(result.current.paletteSearchError).toBe("permission denied"));
    expect(searchAll).toHaveBeenCalledWith({ organizationId: "org-1", query: "42", kind: "workItems" });
    expect(result.current.paletteSearchItems).toEqual([]);
  });

  it("does not search while the active organization is unresolved", async () => {
    getActiveOrganization.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => usePaletteSearch(true, organizations, callbacks), { wrapper });
    act(() => result.current.setPaletteSearchText("target"));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(searchAll).not.toHaveBeenCalled();
    expect(result.current.paletteSearchItems).toEqual([]);
    expect(result.current.paletteRecentItems).toEqual([]);
  });

  it("does not open a pasted link when switching connections fails", async () => {
    setActiveOrganization.mockRejectedValue(new Error("switch failed"));
    clearToasts();
    try {
      const linked = [{ ...organizations[1], baseUrl: "https://dev.azure.com/second" }];
      const { result } = renderHook(() => usePaletteSearch(true, linked, callbacks), { wrapper });
      act(() => result.current.setPaletteSearchText("https://dev.azure.com/second/P/_workitems/edit/42"));
      await waitFor(() => expect(result.current.paletteSearchItems).toHaveLength(1));
      act(() => result.current.paletteSearchItems[0].run());
      await waitFor(() => expect(getSnapshot()[0]?.message).toContain("switch failed"));
      expect(callbacks.setWorkItemSearchRequest).not.toHaveBeenCalled();
      expect(callbacks.setView).not.toHaveBeenCalled();
    } finally {
      clearToasts();
    }
  });
});

describe("usePaletteSearch inbox actions", () => {
  const inboxItem = (id: number, title: string) => ({
    id,
    organizationId: "org-1",
    title,
    repositoryName: "repo",
    author: "Alice",
    snippet: null,
  });

  beforeEach(() => {
    listActionInboxItems.mockReset().mockResolvedValue([
      inboxItem(1, "Fix null check"),
      inboxItem(2, "Rename helper"),
    ]);
    setActionInboxItemState.mockReset().mockResolvedValue(1);
    getActiveOrganization.mockReset().mockResolvedValue(organizations[0]);
  });
  afterEach(cleanup);

  it("lists open items behind inbox: and narrows them by text", async () => {
    const { result } = renderHook(() => usePaletteSearch(true, organizations, callbacks), {
      wrapper,
    });

    act(() => result.current.setPaletteSearchText("inbox: rename"));

    await waitFor(() => {
      expect(result.current.paletteSearchItems.map((item) => item.label)).toEqual([
        "Done — Rename helper",
        "Snooze until tomorrow — Rename helper",
      ]);
    });
    expect(listActionInboxItems).toHaveBeenCalledWith({ state: "open" });
  });

  it("marks done and snoozes through the Inbox state command", async () => {
    const { result } = renderHook(() => usePaletteSearch(true, organizations, callbacks), {
      wrapper,
    });

    act(() => result.current.setPaletteSearchText("inbox:"));
    await waitFor(() => expect(result.current.paletteSearchItems).toHaveLength(4));

    act(() => result.current.paletteSearchItems[0].run());
    expect(setActionInboxItemState).toHaveBeenLastCalledWith({
      ids: [1],
      state: "done",
      snoozedUntil: undefined,
    });

    act(() => result.current.paletteSearchItems[1].run());
    expect(setActionInboxItemState).toHaveBeenLastCalledWith({
      ids: [1],
      state: "snoozed",
      snoozedUntil: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });
});
