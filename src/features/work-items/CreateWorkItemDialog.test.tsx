import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  CreateWorkItemDialog,
  type CreateWorkItemDraft,
} from "./CreateWorkItemDialog";

afterEach(cleanup);

function renderDialog(initialDraft?: CreateWorkItemDraft) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <CreateWorkItemDialog
        initialDraft={initialDraft}
        onClose={onClose}
        onCreated={onCreated}
      />
    </QueryClientProvider>,
  );
  return { onClose, onCreated };
}

describe("CreateWorkItemDialog", () => {
  it("requires a title before creating", async () => {
    const { onCreated } = renderDialog();
    // Wait for the demo project list so validation reaches the title check.
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Project") as HTMLSelectElement).options.length,
      ).toBeGreaterThan(0),
    );
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Type") as HTMLSelectElement).options.length,
      ).toBeGreaterThan(0),
    );
    fireEvent.click(screen.getByRole("button", { name: /Create/ }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Title is required.");
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("creates a work item in demo mode and closes", async () => {
    const { onClose, onCreated } = renderDialog();
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Project") as HTMLSelectElement).options.length,
      ).toBeGreaterThan(0),
    );
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Type") as HTMLSelectElement).options.length,
      ).toBeGreaterThan(0),
    );
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Ship the create dialog" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create/ }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onCreated.mock.calls[0][0]).toMatchObject({
      title: "Ship the create dialog",
      state: "New",
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("prefills the form from a duplicate/template draft", () => {
    renderDialog({
      workItemType: "Bug",
      title: "[Copy] Fix crash on launch",
      priority: "1",
      tags: "crash; android",
      assignedTo: "Demo User",
    });
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe(
      "[Copy] Fix crash on launch",
    );
    expect((screen.getByLabelText("Type") as HTMLSelectElement).value).toBe("Bug");
    expect((screen.getByLabelText("Priority") as HTMLSelectElement).value).toBe("1");
    expect((screen.getByLabelText(/Tags/) as HTMLInputElement).value).toBe(
      "crash; android",
    );
    expect(
      (screen.getByLabelText(/Assigned to/) as HTMLInputElement).value,
    ).toBe("Demo User");
  });

  it("closes on Escape without creating", () => {
    const { onClose, onCreated } = renderDialog();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
