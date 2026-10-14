import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSyncManager } from "./useSyncManager";

describe("useSyncManager", () => {
  it("refreshes the live pipeline queries on the Pipelines view", () => {
    const client = new QueryClient();
    client.setQueryData(["pipelineSubscriptionHistory", "org"], []);
    client.setQueryData(["pipelineRun", "org", 1], {});
    client.setQueryData(["myReviews", "org"], []);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useSyncManager(0, "pipelines"), { wrapper });

    act(() => result.current.refreshCurrentView());

    expect(client.getQueryState(["pipelineSubscriptionHistory", "org"])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["pipelineRun", "org", 1])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["myReviews", "org"])?.isInvalidated).toBe(false);
  });
});
