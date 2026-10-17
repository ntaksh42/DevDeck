import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Organization } from "@/lib/azdoCommands";

const searchWiki = vi.fn();
const getActiveOrganization = vi.fn();
const listActionInboxItems = vi.fn();
const setActionInboxItemState = vi.fn();

vi.mock("@/lib/azdoCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/azdoCommands")>()),
  searchWiki: (...args: unknown[]) => searchWiki(...args),
  getActiveOrganization: () => getActiveOrganization(),
  listActionInboxItems: (...args: unknown[]) => listActionInboxItems(...args),
  setActionInboxItemState: (...args: unknown[]) => setActionInboxItemState(...args),
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
