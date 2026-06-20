import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PipelineRunSummary } from "@/lib/azdoCommands";
import { PipelineSubscriptionsBoard } from "./PipelineSubscriptionsBoard";
import type { PipelineSubscription } from "./pipelineSubscriptionsStorage";

const listPipelineRuns = vi.fn();

vi.mock("@/lib/azdoCommands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/azdoCommands")>();
  return {
    ...actual,
    listPipelineRuns: (...args: unknown[]) => listPipelineRuns(...args),
  };
});

function run(overrides: Partial<PipelineRunSummary> & { buildId: number }): PipelineRunSummary {
  return {
    organizationId: "contoso",
    projectId: "demo-project",
    projectName: "Demo Project",
    buildNumber: String(overrides.buildId),
    definitionId: 1,
    definitionName: "Pipeline",
    status: "completed",
    result: "succeeded",
    sourceBranch: "refs/heads/main",
    reason: "manual",
    requestedFor: "Demo User",
    queueTime: "2026-06-13T00:00:00Z",
    startTime: "2026-06-13T00:00:00Z",
    finishTime: "2026-06-13T00:05:00Z",
    webUrl: "https://dev.azure.com/contoso/demo-project/_build/results?buildId=" + overrides.buildId,
    ...overrides,
  };
}

const subscriptions: PipelineSubscription[] = [
  {
    organizationId: "contoso",
    projectId: "demo-project",
    projectName: "Demo Project",
    definitionId: 1,
    definitionName: "CI",
  },
  {
    organizationId: "contoso",
    projectId: "demo-project",
    projectName: "Demo Project",
    definitionId: 2,
    definitionName: "Nightly",
  },
];

beforeEach(() => {
  listPipelineRuns.mockReset();
  listPipelineRuns.mockImplementation(
    async (input: { definitionId: number }) =>
      input.definitionId === 1
        ? [run({ buildId: 101, definitionId: 1, definitionName: "CI" })]
        : [run({ buildId: 202, definitionId: 2, definitionName: "Nightly" })],
  );
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function renderBoard(selectedBuildId: number | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PipelineSubscriptionsBoard
        organizationId="contoso"
        subscriptions={subscriptions}
        selectedBuildId={selectedBuildId}
        onSelectRun={() => {}}
        onRemove={() => {}}
      />
    </QueryClientProvider>,
  );
}

function gridByLabel(label: string): HTMLElement {
  const grid = document.querySelector<HTMLElement>(`[role='grid'][aria-label='${label}']`);
  if (!grid) throw new Error(`grid not found: ${label}`);
  return grid;
}

describe("PipelineSubscriptionsBoard primary grid marker", () => {
  it("marks the expanded grid containing the selected run, not just the first", async () => {
    renderBoard(202);

    fireEvent.click(await screen.findByRole("button", { name: /CI/, expanded: false }));
    fireEvent.click(await screen.findByRole("button", { name: /Nightly/, expanded: false }));

    let nightlyGrid!: HTMLElement;
    let ciGrid!: HTMLElement;
    await waitFor(() => {
      nightlyGrid = gridByLabel("Nightly runs");
      ciGrid = gridByLabel("CI runs");
      expect(ciGrid.querySelectorAll("[role='row']").length).toBeGreaterThan(0);
      expect(nightlyGrid.querySelectorAll("[role='row']").length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      // The marker must live on the grid that holds the selected run (Nightly),
      // so focusPrimaryGrid() returns focus to the selected row.
      expect(nightlyGrid.getAttribute("data-primary-grid")).toBe("true");
      expect(ciGrid.getAttribute("data-primary-grid")).toBeNull();
    });

    // The selected row carries aria-selected so focusPrimaryGrid() lands on it.
    const selectedRow = nightlyGrid.querySelector("[role='row'][aria-selected='true']");
    expect(selectedRow).not.toBeNull();
  });

  it("polls collapsed pipelines at the idle interval even with an in-progress run", async () => {
    vi.useFakeTimers();
    try {
      // CI (def 1) stays collapsed and has a run in progress; without the idle
      // throttle it would poll on the fast active interval (15s).
      listPipelineRuns.mockImplementation(async (input: { definitionId: number }) =>
        input.definitionId === 1
          ? [run({ buildId: 101, definitionId: 1, definitionName: "CI", status: "inProgress" })]
          : [run({ buildId: 202, definitionId: 2, definitionName: "Nightly" })],
      );

      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={client}>
          <PipelineSubscriptionsBoard
            organizationId="contoso"
            subscriptions={subscriptions}
            selectedBuildId={null}
            onSelectRun={() => {}}
            onRemove={() => {}}
          />
        </QueryClientProvider>,
      );

      // Let the initial fetches resolve (one per subscription).
      await vi.advanceTimersByTimeAsync(0);
      const ciCallsAfterInitial = listPipelineRuns.mock.calls.filter(
        ([input]) => input.definitionId === 1,
      ).length;

      // Advance past the active interval (15s) but short of idle (60s). A
      // collapsed pipeline must not refetch yet, even with an in-progress run.
      await vi.advanceTimersByTimeAsync(20_000);
      const ciCallsAfterActiveWindow = listPipelineRuns.mock.calls.filter(
        ([input]) => input.definitionId === 1,
      ).length;
      expect(ciCallsAfterActiveWindow).toBe(ciCallsAfterInitial);
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to the first expanded grid when the selection is elsewhere", async () => {
    renderBoard(999);

    fireEvent.click(await screen.findByRole("button", { name: /CI/, expanded: false }));
    fireEvent.click(await screen.findByRole("button", { name: /Nightly/, expanded: false }));

    // Wait for both grids' runs to load before asserting on the marker.
    let ciGrid!: HTMLElement;
    let nightlyGrid!: HTMLElement;
    await waitFor(() => {
      ciGrid = gridByLabel("CI runs");
      nightlyGrid = gridByLabel("Nightly runs");
      expect(ciGrid.querySelectorAll("[role='row']").length).toBeGreaterThan(0);
      expect(nightlyGrid.querySelectorAll("[role='row']").length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(ciGrid.getAttribute("data-primary-grid")).toBe("true");
      expect(nightlyGrid.getAttribute("data-primary-grid")).toBeNull();
    });
  });
});
