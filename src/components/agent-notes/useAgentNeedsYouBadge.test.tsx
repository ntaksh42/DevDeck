import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useAgentNeedsYouBadge } from "./useAgentNeedsYouBadge";

const summary = (needsYou: number) => ({
  itemId: 1,
  open: needsYou,
  needsYou,
  drafts: 0,
  done: 0,
  lastAgentReplyAt: null,
  lastModifiedAt: null,
});

const note = (author: "user" | "agent") => ({
  status: "open",
  replies: [{ author }],
});

vi.mock("@/lib/azdoCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/azdoCommands")>()),
  summarizeAgentNotes: vi.fn(async ({ target }: { target: string }) =>
    target === "pull-request" ? [summary(2)] : [summary(1)],
  ),
  listAgentAsks: vi.fn(async () => [
    { itemId: 1, lastModifiedAt: null, notes: [note("agent"), note("user")] },
  ]),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useAgentNeedsYouBadge", () => {
  it("adds the items' and free-standing requests' waiting conversations", async () => {
    const { result } = renderHook(() => useAgentNeedsYouBadge(), { wrapper });
    // 2 (PR items) + 1 (work item items) + 1 (the ask whose last reply is the agent's)
    await waitFor(() => expect(result.current).toBe(4));
  });
});
