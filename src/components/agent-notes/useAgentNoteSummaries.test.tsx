import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentNoteSummary, AgentNoteTarget } from "@/lib/azdoCommands";
import { agentNoteSummariesKey, useAgentNoteWatcher } from "./useAgentNoteSummaries";

vi.mock("@/lib/azdoCommands", () => ({ summarizeAgentNotes: vi.fn(async () => []) }));
vi.mock("@/lib/desktopNotifications", () => ({ showAgentNoteNotification: vi.fn() }));
vi.mock("@/lib/crossLinks", () => ({ navigateToPullRequest: vi.fn(), navigateToWorkItem: vi.fn() }));
vi.mock("@/components/agent/agentSubject", () => ({ openAgentPanel: vi.fn() }));

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

function summary(overrides: Partial<AgentNoteSummary> = {}): AgentNoteSummary {
  return {
    itemId: 42, open: 1, needsYou: 0, drafts: 0, done: 0,
    lastAgentReplyAt: null, lastModifiedAt: "2026-11-07T10:00:00Z", ...overrides,
  };
}

function watch(target: AgentNoteTarget, initial: AgentNoteSummary[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  clients.push(client);
  for (const kind of ["pull-request", "work-item", "ask"] as const) {
    client.setQueryData(agentNoteSummariesKey(kind), kind === target ? initial : []);
  }
  const resultKey = target === "pull-request" ? "reviewResultPreview" : "workItemResultPreview";
  let html = "old result";
  const readResult = vi.fn(async () => html);
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => {
    useAgentNoteWatcher(null);
    return useQuery({ queryKey: [resultKey, 42], queryFn: readResult });
  }, { wrapper });
  return {
    ...hook, client, readResult, invalidate,
    update(notes: AgentNoteSummary[]) {
      html = "updated result";
      act(() => client.setQueryData(agentNoteSummariesKey(target), notes));
    },
  };
}

describe("agent result refresh", () => {
  it.each(["pull-request", "work-item"] as const)("reloads the %s HTML after completion even within the same timestamp", async (target) => {
    const watched = watch(target, [summary()]);
    await waitFor(() => expect(watched.result.current.data).toBe("old result"));

    watched.update([summary({ open: 0, done: 1 })]);

    await waitFor(() => expect(watched.result.current.data).toBe("updated result"));
    expect(watched.readResult).toHaveBeenCalledTimes(2);
  });

  it("reloads an open result when a new note appears after the initial empty poll", async () => {
    const watched = watch("pull-request", []);
    await waitFor(() => expect(watched.result.current.data).toBe("old result"));

    watched.update([summary({ open: 0, done: 1 })]);

    await waitFor(() => expect(watched.result.current.data).toBe("updated result"));
    expect(watched.readResult).toHaveBeenCalledTimes(2);
  });

  it("reloads changed material without waiting for the note to finish", async () => {
    const watched = watch("pull-request", [summary()]);
    await waitFor(() => expect(watched.result.current.data).toBe("old result"));

    watched.update([summary({ lastModifiedAt: "2026-11-07T10:00:05Z" })]);

    await waitFor(() => expect(watched.result.current.data).toBe("updated result"));
    expect(watched.readResult).toHaveBeenCalledTimes(2);
  });

  it("does not refetch on baseline or an unchanged summary poll", async () => {
    const watched = watch("pull-request", [summary()]);
    await waitFor(() => expect(watched.result.current.data).toBe("old result"));

    watched.update([summary()]);
    watched.rerender();

    expect(watched.invalidate).not.toHaveBeenCalled();
    expect(watched.readResult).toHaveBeenCalledTimes(1);
    expect(watched.result.current.data).toBe("old result");
  });

  it("keeps free-standing requests on their own queries", async () => {
    const watched = watch("ask", [summary()]);
    await waitFor(() => expect(watched.result.current.data).toBe("old result"));

    watched.update([summary({ done: 1, open: 0 })]);

    await waitFor(() => expect(watched.invalidate).toHaveBeenCalledWith({ queryKey: ["agentAsks"] }));
    expect(watched.invalidate).toHaveBeenCalledWith({ queryKey: ["agentNotes", "ask", 42] });
    expect(watched.readResult).toHaveBeenCalledTimes(1);
  });
});
