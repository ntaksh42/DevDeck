import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WorkItemSummary } from "@/lib/azdoCommands";
import { NewWorkItemDialog } from "./NewWorkItemDialog";

afterEach(() => {
  cleanup();
});

function renderDialog(
  overrides: Partial<{
    onCreated: (item: WorkItemSummary) => void;
    onClose: () => void;
  }> = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onCreated = overrides.onCreated ?? vi.fn();
  const onClose = overrides.onClose ?? vi.fn();
  render(
    <QueryClientProvider client={client}>
      <NewWorkItemDialog
        organizationId="contoso"
        projectId="platform"
        onCreated={onCreated}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  return { onCreated, onClose };
}

describe("NewWorkItemDialog", () => {
  it("loads the project's work item types from the demo backend", async () => {
    renderDialog();
    // The demo backend exposes a fixed set of types.
    await screen.findByRole("option", { name: "User Story" });
    expect(screen.getByRole("option", { name: "Bug" })).toBeTruthy();
  });

  it("creates a work item from a title and reports the created summary", async () => {
    const onCreated = vi.fn();
    renderDialog({ onCreated });

    await screen.findByRole("option", { name: "Task" });

    fireEvent.change(screen.getByLabelText(/Title/), {
      target: { value: "Wire up the new button" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledTimes(1);
    });
    const created = onCreated.mock.calls[0][0] as WorkItemSummary;
    expect(created.title).toBe("Wire up the new button");
    expect(created.projectId).toBe("platform");
  });

  it("keeps the create button disabled until a title is entered", async () => {
    renderDialog();
    await screen.findByRole("option", { name: "Task" });
    expect(screen.getByRole("button", { name: "Create" })).toHaveProperty("disabled", true);
  });
});
