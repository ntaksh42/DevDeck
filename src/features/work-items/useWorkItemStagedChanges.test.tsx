import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkItemPreview, WorkItemSummary } from "@/lib/azdoCommands";
import { useWorkItemStagedChanges } from "./useWorkItemStagedChanges";

const updateWorkItemFields = vi.hoisted(() => vi.fn());

vi.mock("@/lib/azdoCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/azdoCommands")>()),
  updateWorkItemFields,
  recordAssigneeInteraction: vi.fn().mockResolvedValue(undefined),
}));

function item(id: number): WorkItemSummary {
  return { id, organizationId: "org", projectId: "proj" } as WorkItemSummary;
}

function previewFor(id: number): WorkItemPreview {
  return {
    id,
    organizationId: "org",
    projectId: "proj",
    priority: "2",
    comments: [],
    relations: [],
  } as unknown as WorkItemPreview;
}

describe("useWorkItemStagedChanges", () => {
  beforeEach(() => updateWorkItemFields.mockReset());

  it("does not show the undo banner for an item the user already left", async () => {
    let finishUpdate: (value: WorkItemPreview) => void = () => {};
    updateWorkItemFields.mockReturnValue(
      new Promise<WorkItemPreview>((resolve) => {
        finishUpdate = resolve;
      }),
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(
      ({ id }: { id: number }) =>
        useWorkItemStagedChanges({
          selectedItem: item(id),
          preview: previewFor(id),
          customFieldsSignature: "",
          onPreviewUpdated: undefined,
          panelRef: { current: null },
        }),
      { wrapper, initialProps: { id: 1 } },
    );

    act(() => result.current.setStagedChanges({ priority: 1 }));
    let applying: Promise<void> = Promise.resolve();
    act(() => {
      applying = result.current.applyStaged();
    });
    await waitFor(() => expect(result.current.applying).toBe(true));

    // Move to another item and stage an edit there while the request is in flight.
    rerender({ id: 2 });
    act(() => result.current.setStagedChanges({ priority: 3 }));
    await act(async () => {
      finishUpdate(previewFor(1));
      await applying;
    });

    expect(result.current.undoState).toBeNull();
    expect(result.current.staged).toEqual({ priority: 3 });
  });

  it.each([false, true])("ignores stale undo completion (failure: %s)", async (fails) => {
    updateWorkItemFields.mockResolvedValueOnce(previewFor(1));
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(
      ({ id }: { id: number }) => useWorkItemStagedChanges({
        selectedItem: item(id), preview: previewFor(id), customFieldsSignature: "",
        onPreviewUpdated: undefined, panelRef: { current: null },
      }),
      { wrapper, initialProps: { id: 1 } },
    );
    act(() => result.current.setStagedChanges({ priority: 1 }));
    await act(async () => { await result.current.applyStaged(); });
    expect(result.current.undoState).not.toBeNull();

    let finishUndo: () => void = () => {};
    updateWorkItemFields.mockReturnValueOnce(new Promise<WorkItemPreview>((resolve, reject) => {
      finishUndo = () => fails ? reject(new Error("undo failed")) : resolve(previewFor(1));
    }));
    let undoing = Promise.resolve();
    act(() => { undoing = result.current.undoLastApply(); });
    await waitFor(() => expect(updateWorkItemFields).toHaveBeenCalledTimes(2));

    // An A -> B -> A round trip must not revive A's old undo operation.
    rerender({ id: 2 });
    rerender({ id: 1 });
    act(() => result.current.setStagedChanges({ priority: 3 }));
    let finishApply: (value: WorkItemPreview) => void = () => {};
    updateWorkItemFields.mockReturnValueOnce(new Promise<WorkItemPreview>((resolve) => {
      finishApply = resolve;
    }));
    let applying = Promise.resolve();
    act(() => { applying = result.current.applyStaged(); });
    await waitFor(() => expect(updateWorkItemFields).toHaveBeenCalledTimes(3));
    await act(async () => { finishUndo(); await undoing; });

    expect(result.current.applying).toBe(true);
    expect(result.current.applyError).toBeNull();
    expect(result.current.undoState).toBeNull();
    expect(result.current.staged).toEqual({ priority: 3 });
    await act(async () => { finishApply(previewFor(1)); await applying; });
    rerender({ id: 2 });
    client.clear();
  });
});
