import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { postPullRequestComment } from "@/lib/azdoCommands";
import { demoListInboxItems } from "@/lib/demo/actionInbox";
import { useInboxDetail } from "./useInboxDetail";

vi.mock("@/lib/azdoCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/azdoCommands")>()),
  postPullRequestComment: vi.fn(),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useInboxDetail", () => {
  it("does not carry a failed reply over to the next item", async () => {
    const [first, second] = demoListInboxItems().filter((item) => item.kind.startsWith("pr_"));
    vi.mocked(postPullRequestComment).mockRejectedValueOnce(new Error("reply failed"));
    const { result, rerender } = renderHook(({ item }) => useInboxDetail(item), {
      wrapper,
      initialProps: { item: first },
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.reply("hello").catch(() => undefined);
    });
    await waitFor(() => expect(result.current.error).toContain("reply failed"));

    rerender({ item: second });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeNull();
  });
});
