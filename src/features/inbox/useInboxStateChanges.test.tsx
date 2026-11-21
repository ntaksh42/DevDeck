import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { InboxEntry } from "./inboxPresentation";
import { useInboxStateChanges } from "./useInboxStateChanges";

const update = vi.fn();
vi.mock("@/lib/azdoCommands", async (original) => ({
  ...await original<typeof import("@/lib/azdoCommands")>(),
  setActionInboxItemState: (...args: unknown[]) => update(...args),
}));

afterEach(() => { cleanup(); update.mockReset(); });

it("waits for an in-flight change before sending its undo", async () => {
  let finishChange!: () => void;
  update.mockImplementationOnce(() => new Promise<void>((resolve) => { finishChange = resolve; }));
  update.mockResolvedValue(undefined);
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const entry = { id: 42, snoozedUntil: null } as InboxEntry;
  const { result } = renderHook(() => useInboxStateChanges({
    entries: [entry], tab: "open", onReselect: vi.fn(),
  }), { wrapper });

  act(() => result.current.changeState(entry, "done"));
  act(() => { expect(result.current.undoLast()).toBe(true); });
  expect(update).toHaveBeenCalledTimes(1);
  expect(result.current.visibleEntries).toEqual([]);
  await act(async () => { finishChange(); });
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  expect(update).toHaveBeenLastCalledWith({ ids: [42], state: "open", snoozedUntil: undefined });
});
