import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useExtraColumnLabel } from "./useWorkItemFields";

const listWorkItemFields = vi.fn();

vi.mock("@/lib/azdoCommands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/azdoCommands")>();
  return {
    ...actual,
    listWorkItemFields: (...args: unknown[]) => listWorkItemFields(...args),
  };
});

afterEach(() => {
  cleanup();
  listWorkItemFields.mockReset();
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useExtraColumnLabel", () => {
  it("uses the Azure DevOps display name once fields load, matching reference names case-insensitively", async () => {
    listWorkItemFields.mockResolvedValue([
      { referenceName: "Custom.ReleaseTarget", name: "リリース予定", fieldType: "string", custom: true },
    ]);
    const { result } = renderHook(() => useExtraColumnLabel("contoso"), { wrapper });
    expect(result.current("Custom.ReleaseTarget")).toBe("ReleaseTarget");
    await waitFor(() => expect(result.current("custom.releasetarget")).toBe("リリース予定"));
    expect(result.current("Custom.Unknown")).toBe("Unknown");
  });

  it("keeps the reference-name fallback and skips the request without an organization", () => {
    const { result } = renderHook(() => useExtraColumnLabel(undefined), { wrapper });
    expect(result.current("Custom.Team")).toBe("Team");
    expect(listWorkItemFields).not.toHaveBeenCalled();
  });
});
