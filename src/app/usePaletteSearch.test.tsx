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
    searchAll.mockReset();
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
    expect(callbacks.setPullRequestSearchRequest).toHaveBeenCalledWith(
      expect.objectContaining({ query: "123", organizationId: "org-1" }),
    );
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

  it("switches connections before reopening a recent work item", async () => {
    window.localStorage.setItem("azdodeck:workItems:recent", JSON.stringify([{
      key: "org-2:p:42", id: 42, organizationId: "org-2", projectId: "p", projectName: "Project",
      title: "Target", viewedAt: new Date().toISOString(), webUrl: null,
    }]));
    const { result } = renderHook(() => usePaletteSearch(true, organizations, callbacks), { wrapper });
    await waitFor(() => expect(getActiveOrganization).toHaveBeenCalled());
    act(() => result.current.paletteRecentItems[0].run());
    await waitFor(() => expect(setActiveOrganization).toHaveBeenCalledWith("org-2"));
    await waitFor(() => expect(callbacks.setWorkItemSearchRequest).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-2", query: "42" }),
    ));
  });

  it("does not open a pasted link when switching connections fails", async () => {
    setActiveOrganization.mockRejectedValue(new Error("switch failed"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const linked = [{ ...organizations[1], baseUrl: "https://dev.azure.com/second" }];
      const { result } = renderHook(() => usePaletteSearch(true, linked, callbacks), { wrapper });
      act(() => result.current.setPaletteSearchText("https://dev.azure.com/second/P/_workitems/edit/42"));
      await waitFor(() => expect(result.current.paletteSearchItems).toHaveLength(1));
      act(() => result.current.paletteSearchItems[0].run());
      await waitFor(() => expect(log).toHaveBeenCalled());
      expect(callbacks.setWorkItemSearchRequest).not.toHaveBeenCalled();
      expect(callbacks.setView).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
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
