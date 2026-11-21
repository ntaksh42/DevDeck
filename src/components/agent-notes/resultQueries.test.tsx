import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useHasResult, type ResultSubject } from "./resultQueries";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useHasResult", () => {
  it("is false without a subject", () => {
    const { result } = renderHook(() => useHasResult(null), { wrapper });
    expect(result.current).toBe(false);
  });

  it("is true for a PR whose result HTML exists and false for one without", async () => {
    // Demo PR 101 resolves a review-result HTML; PR 98 does not.
    const { result, rerender } = renderHook((subject: ResultSubject) => useHasResult(subject), {
      wrapper,
      initialProps: { target: "pull-request", itemId: 101 },
    });
    await waitFor(() => expect(result.current).toBe(true));
    rerender({ target: "pull-request", itemId: 98 });
    // Keeps the last answer while the next PR loads, then folds.
    expect(result.current).toBe(true);
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("is false for a pipeline run with no agent question", () => {
    const { result } = renderHook(() => useHasResult({ target: "pipeline", askId: null, status: "failed" }), { wrapper });
    expect(result.current).toBe(false);
  });
});
