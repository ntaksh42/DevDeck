import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PipelineDefinitionDetail } from "@/lib/azdoCommands";
import { PipelineDefinitionPanel } from "./PipelineDefinitionPanel";

const getPipelineDefinition = vi.fn();

vi.mock("@/lib/azdoCommands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/azdoCommands")>();
  return {
    ...actual,
    getPipelineDefinition: (...args: unknown[]) => getPipelineDefinition(...args),
  };
});

afterEach(() => {
  cleanup();
  getPipelineDefinition.mockReset();
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
    } satisfies PipelineDefinitionDetail);

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("No triggers configured.")).toBeTruthy();
    });
    expect(screen.getByText("No variables defined.")).toBeTruthy();
  });
});
