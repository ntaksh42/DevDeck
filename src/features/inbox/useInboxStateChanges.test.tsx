import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setActionInboxItemState } from "@/lib/azdoCommands";
import { demoListInboxItems } from "@/lib/demo/actionInbox";
import { useInboxStateChanges } from "./useInboxStateChanges";

vi.mock("@/lib/azdoCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/azdoCommands")>()),
  setActionInboxItemState: vi.fn(),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe("useInboxStateChanges", () => {
  it("writes an undo only after the change it undoes was saved", async () => {
    const entries = demoListInboxItems();
    const calls: string[] = [];
    let finishDone: () => void = () => {};
    vi.mocked(setActionInboxItemState).mockImplementation(async (input) => {
      calls.push(`start ${input.state}`);
      if (input.state === "done") await new Promise<void>((resolve) => (finishDone = resolve));
      calls.push(`end ${input.state}`);
      return 1;
    });
    const { result } = renderHook(
      () => useInboxStateChanges({ entries, tab: "open", onReselect: () => {} }),
      { wrapper },
    );

    act(() => result.current.changeState(entries[0], "done"));
    act(() => {
      result.current.undoLast();
    });
    await waitFor(() => expect(calls).toEqual(["start done"]));

    await act(async () => finishDone());
    await waitFor(() => expect(calls).toEqual(["start done", "end done", "start open", "end open"]));
  });
});
