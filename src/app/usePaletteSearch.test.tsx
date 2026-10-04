import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Organization } from "@/lib/azdoCommands";

const searchCode = vi.fn();
const getActiveOrganization = vi.fn();

vi.mock("@/lib/azdoCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/azdoCommands")>()),
  searchCode: (...args: unknown[]) => searchCode(...args),
  getActiveOrganization: () => getActiveOrganization(),
}));

import { usePaletteSearch } from "./usePaletteSearch";

const organizations = [
  { id: "org-1", name: "first" },
  { id: "org-2", name: "second" },
] as unknown as Organization[];
const callbacks = {
  setWorkItemSearchRequest: vi.fn(),
  setPullRequestSearchRequest: vi.fn(),
  setCommitSearchRequest: vi.fn(),
  setView: vi.fn(),
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("usePaletteSearch code search", () => {
  beforeEach(() => {
    searchCode.mockReset();
    getActiveOrganization.mockReset().mockResolvedValue(organizations[1]);
  });
  afterEach(cleanup);

  it("searches the active connection rather than the first one", async () => {
    searchCode.mockResolvedValue({ count: 0, results: [], notice: null });
    const { result } = renderHook(() => usePaletteSearch(true, organizations, callbacks), {
      wrapper,
    });

    act(() => result.current.setPaletteSearchText("code: needle"));

    await waitFor(() => {
      expect(searchCode).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "org-2", query: "needle" }),
        expect.anything(),
      );
    });
  });

  it("shows a single unavailable row when code search fails", async () => {
    searchCode.mockRejectedValue(new Error("403"));
    const { result } = renderHook(() => usePaletteSearch(true, organizations, callbacks), {
      wrapper,
    });

    act(() => result.current.setPaletteSearchText("code: needle"));

    await waitFor(() => {
      expect(result.current.paletteSearchItems.map((item) => item.label)).toEqual([
        "Code Search is unavailable",
      ]);
    });
  });
});
