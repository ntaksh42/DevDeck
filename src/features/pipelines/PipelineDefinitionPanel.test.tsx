import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PipelineDefinitionDetail } from "@/lib/azdoCommands";
import { PipelineDefinitionPanel } from "./PipelineDefinitionPanel";

const getPipelineDefinition = vi.fn();
const updatePipelineDefinition = vi.fn();

vi.mock("@/lib/azdoCommands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/azdoCommands")>();
  return {
    ...actual,
    getPipelineDefinition: (...args: unknown[]) => getPipelineDefinition(...args),
    updatePipelineDefinition: (...args: unknown[]) => updatePipelineDefinition(...args),
  };
});

afterEach(() => {
  cleanup();
  getPipelineDefinition.mockReset();
  updatePipelineDefinition.mockReset();
});

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PipelineDefinitionPanel
        organizationId="contoso"
        projectId="demo-project"
        definitionId={1}
        definitionName="CI"
      />
    </QueryClientProvider>,
  );
}

describe("PipelineDefinitionPanel", () => {
  it("renders triggers and masks secret variable values", async () => {
    const detail: PipelineDefinitionDetail = {
      definitionId: 1,
      name: "CI",
      triggers: [
        { triggerType: "continuousIntegration", branchFilters: ["+refs/heads/main"], pathFilters: [] },
      ],
      variables: [
        { name: "BuildConfiguration", value: "Debug", isSecret: false, allowOverride: true },
        { name: "DeployApiKey", value: null, isSecret: true, allowOverride: false },
      ],
      repository: null,
    };
    getPipelineDefinition.mockResolvedValue(detail);

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("Continuous integration")).toBeTruthy();
    });
    expect(screen.getByText("+refs/heads/main")).toBeTruthy();
    expect(screen.getByText("Debug")).toBeTruthy();
    // The secret's value is masked and never rendered verbatim.
    expect(screen.getByText("••••••")).toBeTruthy();
    expect(screen.getByText("Secret")).toBeTruthy();
  });

  it("shows empty states when no triggers or variables exist", async () => {
    getPipelineDefinition.mockResolvedValue({
      definitionId: 1,
      name: "CI",
      triggers: [],
      variables: [],
      repository: null,
    } satisfies PipelineDefinitionDetail);

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("No triggers configured.")).toBeTruthy();
    });
    expect(screen.getByText("No variables defined.")).toBeTruthy();
  });

  describe("editing", () => {
    const detail: PipelineDefinitionDetail = {
      definitionId: 1,
      name: "CI",
      triggers: [
        { triggerType: "continuousIntegration", branchFilters: ["+refs/heads/main"], pathFilters: [] },
      ],
      variables: [
        { name: "BuildConfiguration", value: "Debug", isSecret: false, allowOverride: true },
        { name: "DeployApiKey", value: null, isSecret: true, allowOverride: false },
      ],
      repository: null,
    };

    async function openEditForm() {
      getPipelineDefinition.mockResolvedValue(detail);
      renderPanel();
      await waitFor(() => {
        expect(screen.getByText("Continuous integration")).toBeTruthy();
      });
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
      });
    }

    it("saves an edited variable without touching the untouched CI trigger", async () => {
      updatePipelineDefinition.mockResolvedValue(detail);
      await openEditForm();

      fireEvent.change(screen.getByLabelText("Variable 1 value"), {
        target: { value: "Release" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(updatePipelineDefinition).toHaveBeenCalled());
      expect(updatePipelineDefinition).toHaveBeenCalledWith({
        organizationId: "contoso",
        projectId: "demo-project",
        definitionId: 1,
        variables: [{ name: "BuildConfiguration", value: "Release", allowOverride: true }],
        ciTrigger: null,
      });
      // Returns to view mode showing the Edit button again.
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
      });
    });

    it("does not render an editable field for the secret variable", async () => {
      await openEditForm();

      const secretRow = screen.getByText("DeployApiKey").closest("div");
      expect(secretRow).not.toBeNull();
      expect(within(secretRow as HTMLElement).queryAllByRole("textbox")).toHaveLength(0);
      expect(screen.getByText("(secret)")).toBeTruthy();
      // Only the non-secret variable gets an editable name/value pair.
      expect(screen.getAllByLabelText(/Variable \d+ name/)).toHaveLength(1);
    });

    it("keeps the form open and shows an error when saving fails", async () => {
      updatePipelineDefinition.mockRejectedValue(new Error("Update rejected"));
      await openEditForm();

      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toBe("Update rejected");
      // Still in edit mode: Save/Cancel remain, Edit is not shown.
      expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    });
  });
});
