import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PipelineRunDetail } from "@/lib/azdoCommands";
import { PipelineRunDetailPanel } from "./PipelineRunDetailPanel";

const getAppSettings = vi.fn();
const getPipelineRun = vi.fn();
const getPipelineRunLogTail = vi.fn();
const listPipelineArtifacts = vi.fn();

vi.mock("@/lib/azdoCommands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/azdoCommands")>();
  return {
    ...actual,
    getAppSettings: (...args: unknown[]) => getAppSettings(...args),
    getPipelineRun: (...args: unknown[]) => getPipelineRun(...args),
    getPipelineRunLogTail: (...args: unknown[]) => getPipelineRunLogTail(...args),
    listPipelineArtifacts: (...args: unknown[]) => listPipelineArtifacts(...args),
  };
});

const runDetail: PipelineRunDetail = {
  run: {
    organizationId: "contoso",
    projectId: "demo-project",
    projectName: "Demo Project",
    buildId: 101,
    buildNumber: "101",
    definitionId: 1,
    definitionName: "CI",
    status: "completed",
    result: "succeeded",
    sourceBranch: "refs/heads/main",
    reason: "manual",
    requestedFor: "Demo User",
    queueTime: "2026-06-13T00:00:00Z",
    startTime: "2026-06-13T00:00:00Z",
    finishTime: "2026-06-13T00:05:00Z",
    webUrl: "https://dev.azure.com/contoso/demo-project/_build/results?buildId=101",
  },
  timeline: [
    {
      id: "stage",
      parentId: null,
      nodeType: "Stage",
      name: "Build",
      state: "completed",
      result: "succeeded",
      startTime: null,
      finishTime: null,
      logId: null,
      errorCount: 0,
      warningCount: 0,
      order: 0,
    },
    {
      id: "job-compile",
      parentId: null,
      nodeType: "Job",
      name: "Compile",
      state: "completed",
      result: "succeeded",
      startTime: null,
      finishTime: null,
      logId: 10,
      errorCount: 0,
      warningCount: 0,
      order: 1,
    },
    {
      id: "job-test",
      parentId: null,
      nodeType: "Job",
      name: "Test",
      state: "completed",
      result: "succeeded",
      startTime: null,
      finishTime: null,
      logId: 20,
      errorCount: 0,
      warningCount: 0,
      order: 2,
    },
  ],
  timelineUnavailable: false,
};

beforeEach(() => {
  getAppSettings.mockReset();
  getAppSettings.mockResolvedValue({ readOnlyValidationModeEnabled: false });
  getPipelineRun.mockReset();
  getPipelineRun.mockResolvedValue(runDetail);
  getPipelineRunLogTail.mockReset();
  getPipelineRunLogTail.mockResolvedValue({ lines: ["log line"], truncated: false });
  listPipelineArtifacts.mockReset();
  listPipelineArtifacts.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PipelineRunDetailPanel organizationId="contoso" projectId="demo-project" buildId={101} />
    </QueryClientProvider>,
  );
}

function rowButton(name: string): HTMLElement {
  return screen.getByText(name).closest("button") as HTMLElement;
}

describe("PipelineRunDetailPanel timeline keyboard navigation", () => {
  it("moves the highlighted row with ArrowDown/ArrowUp and j/k", async () => {
    renderPanel();
    await screen.findByText("Compile");

    expect(rowButton("Build").className).toContain("bg-secondary");
    expect(rowButton("Compile").className).not.toContain("bg-secondary");

    fireEvent.keyDown(rowButton("Build"), { key: "ArrowDown" });
    expect(rowButton("Build").className).not.toContain("bg-secondary");
    expect(rowButton("Compile").className).toContain("bg-secondary");

    fireEvent.keyDown(rowButton("Compile"), { key: "j" });
    expect(rowButton("Test").className).toContain("bg-secondary");

    fireEvent.keyDown(rowButton("Test"), { key: "k" });
    expect(rowButton("Compile").className).toContain("bg-secondary");
  });

  it("selects the highlighted row's log on Enter, skipping nodes without a log", async () => {
    renderPanel();
    await screen.findByText("Compile");

    // The cursor starts on "Build", which has no log — Enter must not fetch a log.
    fireEvent.keyDown(rowButton("Build"), { key: "Enter" });
    expect(getPipelineRunLogTail).not.toHaveBeenCalled();

    fireEvent.keyDown(rowButton("Build"), { key: "ArrowDown" });
    fireEvent.keyDown(rowButton("Compile"), { key: "Enter" });

    await waitFor(() => {
      expect(getPipelineRunLogTail).toHaveBeenCalledWith(expect.objectContaining({ logId: 10 }));
    });
  });
});
