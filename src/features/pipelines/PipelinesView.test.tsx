import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PipelineDefinitionDetail } from "@/lib/azdoCommands";
import { PipelinesView, toSourceBranchRef } from "./PipelinesView";

// The view reads the active connection (the browser demo "contoso" org), and the
// demo subscriptions seeded by loadPipelineSubscriptions() live under that org.

const { getPipelineDefinition, queuePipelineRun } = vi.hoisted(() => ({
  getPipelineDefinition: vi.fn(),
  queuePipelineRun: vi.fn(),
}));

vi.mock("@/lib/azdoCommands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/azdoCommands")>();
  getPipelineDefinition.mockImplementation(actual.getPipelineDefinition);
  queuePipelineRun.mockImplementation(actual.queuePipelineRun);
  return {
    ...actual,
    getPipelineDefinition: (...args: unknown[]) => getPipelineDefinition(...args),
    queuePipelineRun: (...args: unknown[]) => queuePipelineRun(...args),
  };
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  getPipelineDefinition.mockClear();
  queuePipelineRun.mockClear();
});

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PipelinesView />
    </QueryClientProvider>,
  );
}

describe("PipelinesView", () => {
  it(
    "shows seeded watched pipelines and reveals run history on expand",
    async () => {
      renderView();
      // The browser demo seeds CI and Nightly as watched pipelines.
      await screen.findByText("Watched pipelines", undefined, { timeout: 8000 });
      const nightlyRow = await screen.findByRole("button", {
        name: /Nightly/,
        expanded: false,
      });
      fireEvent.click(nightlyRow);
      // Expanding loads the pipeline's run history (demo-delayed call).
      await screen.findByText(/20260613\.5/, undefined, { timeout: 8000 });
    },
    15000,
  );

  it(
    "keeps the detail panel when unwatching a different pipeline in the same project",
    async () => {
      // CI (definition 1) and Nightly (definition 2) both live in demo-project.
      renderView();
      await screen.findByText("Watched pipelines", undefined, { timeout: 8000 });

      // Open Nightly and select one of its runs into the detail panel.
      const nightlyRow = await screen.findByRole("button", {
        name: /Nightly/,
        expanded: false,
      });
      fireEvent.click(nightlyRow);
      const nightlyGrid = await screen.findByRole(
        "grid",
        { name: /Nightly runs/ },
        { timeout: 8000 },
      );
      const runRows = within(nightlyGrid).getAllByRole("row");
      fireEvent.click(runRows[0]);

      // The detail panel now shows a run, not the empty placeholder.
      await screen.findByText("Timeline", undefined, { timeout: 8000 });
      expect(screen.queryByText("Select a run.")).toBeNull();

      // Unwatch CI (a different pipeline in the same project).
      const removeCi = screen.getByRole("button", {
        name: /Remove CI from watched pipelines/,
      });
      fireEvent.click(removeCi);

      // The detail panel must still show the Nightly run, not be cleared.
      expect(screen.queryByText("Select a run.")).toBeNull();
      expect(screen.getByText("Timeline")).toBeTruthy();
    },
    15000,
  );

  it(
    "falls back to a free-text branch field when the pipeline has no repository info",
    async () => {
      // The browser demo's pipeline definitions report no repository, so the
      // Queue run branch field must fall back to plain text entry instead of
      // the FilterableSelect branch picker.
      renderView();
      await screen.findByText("Watched pipelines", undefined, { timeout: 8000 });

      const pipelineCombo = await screen.findByRole("combobox", { name: "Pipeline" });
      await waitFor(() => expect((pipelineCombo as HTMLInputElement).disabled).toBe(false), {
        timeout: 8000,
      });
      fireEvent.mouseDown(pipelineCombo);
      fireEvent.pointerDown(await screen.findByRole("option", { name: "CI" }));

      const queueRunButton = screen.getByRole("button", { name: "Queue run" });
      await waitFor(() => expect((queueRunButton as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(queueRunButton);

      const branchField = await screen.findByLabelText("Branch");
      // A plain input, not the FilterableSelect combobox.
      expect(branchField.getAttribute("role")).toBeNull();
      expect((branchField as HTMLInputElement).value).toBe("main");
    },
    15000,
  );

  it(
    "shows allowOverride variables as labeled inputs, pre-filled with their default, and hides non-override variables",
    async () => {
      const detail: PipelineDefinitionDetail = {
        definitionId: 1,
        name: "CI",
        triggers: [],
        variables: [
          { name: "BuildConfiguration", value: "Debug", isSecret: false, allowOverride: true },
          { name: "DeploySecret", value: null, isSecret: true, allowOverride: true },
          { name: "DeployApiKey", value: null, isSecret: true, allowOverride: false },
        ],
        repository: null,
      };
      getPipelineDefinition.mockResolvedValueOnce(detail);

      renderView();
      await screen.findByText("Watched pipelines", undefined, { timeout: 8000 });

      const pipelineCombo = await screen.findByRole("combobox", { name: "Pipeline" });
      await waitFor(() => expect((pipelineCombo as HTMLInputElement).disabled).toBe(false), {
        timeout: 8000,
      });
      fireEvent.mouseDown(pipelineCombo);
      fireEvent.pointerDown(await screen.findByRole("option", { name: "CI" }));

      const queueRunButton = screen.getByRole("button", { name: "Queue run" });
      await waitFor(() => expect((queueRunButton as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(queueRunButton);

      const buildConfigField = await screen.findByLabelText("BuildConfiguration");
      expect((buildConfigField as HTMLInputElement).type).toBe("text");
      expect((buildConfigField as HTMLInputElement).value).toBe("Debug");

      // A secret's value never ships to the client, so it starts empty and
      // renders as a password field.
      const secretField = screen.getByLabelText("DeploySecret");
      expect((secretField as HTMLInputElement).type).toBe("password");
      expect((secretField as HTMLInputElement).value).toBe("");

      // Not overridable, so it never gets an item input.
      expect(screen.queryByLabelText("DeployApiKey")).toBeNull();

      // The textarea remains, relabeled for parameters not covered by a variable.
      expect(
        screen.getByText("Additional parameters (one name=value per line, optional)"),
      ).toBeTruthy();
    },
    15000,
  );

  it(
    "sends only variable values changed from their default, with item inputs taking precedence over the textarea",
    async () => {
      const detail: PipelineDefinitionDetail = {
        definitionId: 1,
        name: "CI",
        triggers: [],
        variables: [
          { name: "BuildConfiguration", value: "Debug", isSecret: false, allowOverride: true },
          { name: "DeploySecret", value: null, isSecret: true, allowOverride: true },
        ],
        repository: null,
      };
      getPipelineDefinition.mockResolvedValueOnce(detail);
      queuePipelineRun.mockResolvedValueOnce({
        organizationId: "contoso",
        projectId: "demo-project",
        projectName: "Demo Project",
        buildId: 2000,
        buildNumber: "20260703.1",
        definitionId: 1,
        definitionName: "CI",
        status: "notStarted",
        result: null,
        sourceBranch: "refs/heads/main",
        reason: "manual",
        requestedFor: "Demo User",
        queueTime: "2026-07-03T00:00:00Z",
        startTime: null,
        finishTime: null,
        webUrl: "https://dev.azure.com/demo/demo/_build/results?buildId=2000",
      });

      renderView();
      await screen.findByText("Watched pipelines", undefined, { timeout: 8000 });

      const pipelineCombo = await screen.findByRole("combobox", { name: "Pipeline" });
      await waitFor(() => expect((pipelineCombo as HTMLInputElement).disabled).toBe(false), {
        timeout: 8000,
      });
      fireEvent.mouseDown(pipelineCombo);
      fireEvent.pointerDown(await screen.findByRole("option", { name: "CI" }));

      const queueRunButton = screen.getByRole("button", { name: "Queue run" });
      await waitFor(() => expect((queueRunButton as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(queueRunButton);

      const buildConfigField = await screen.findByLabelText("BuildConfiguration");
      // Change the item input away from its default; DeploySecret stays untouched.
      fireEvent.change(buildConfigField, { target: { value: "Release" } });

      // The textarea tries to override the same key plus adds an unrelated one;
      // the item input must win for BuildConfiguration.
      const paramsTextarea = screen.getByLabelText("Parameters");
      fireEvent.change(paramsTextarea, {
        target: { value: "BuildConfiguration=ShouldBeIgnored\nextra=value1" },
      });

      fireEvent.click(screen.getByRole("button", { name: "Queue" }));

      await waitFor(() => expect(queuePipelineRun).toHaveBeenCalled());
      const call = queuePipelineRun.mock.calls[0][0] as { parameters?: Record<string, string> };
      expect(call.parameters).toEqual({ BuildConfiguration: "Release", extra: "value1" });
    },
    15000,
  );

  it(
    "falls back to the plain textarea with its original label when the definition has no overridable variables",
    async () => {
      const detail: PipelineDefinitionDetail = {
        definitionId: 1,
        name: "CI",
        triggers: [],
        variables: [{ name: "DeployApiKey", value: null, isSecret: true, allowOverride: false }],
        repository: null,
      };
      getPipelineDefinition.mockResolvedValueOnce(detail);

      renderView();
      await screen.findByText("Watched pipelines", undefined, { timeout: 8000 });

      const pipelineCombo = await screen.findByRole("combobox", { name: "Pipeline" });
      await waitFor(() => expect((pipelineCombo as HTMLInputElement).disabled).toBe(false), {
        timeout: 8000,
      });
      fireEvent.mouseDown(pipelineCombo);
      fireEvent.pointerDown(await screen.findByRole("option", { name: "CI" }));

      const queueRunButton = screen.getByRole("button", { name: "Queue run" });
      await waitFor(() => expect((queueRunButton as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(queueRunButton);

      await screen.findByLabelText("Parameters");
      expect(screen.getByText("Parameters (one name=value per line, optional)")).toBeTruthy();
      expect(
        screen.queryByText("Additional parameters (one name=value per line, optional)"),
      ).toBeNull();
      expect(screen.queryByLabelText("DeployApiKey")).toBeNull();
    },
    15000,
  );
});

describe("toSourceBranchRef", () => {
  it("prefixes a short branch name with refs/heads/", () => {
    expect(toSourceBranchRef("main")).toBe("refs/heads/main");
    expect(toSourceBranchRef("feature/login")).toBe("refs/heads/feature/login");
  });

  it("leaves an already-qualified ref untouched", () => {
    expect(toSourceBranchRef("refs/heads/main")).toBe("refs/heads/main");
    expect(toSourceBranchRef("refs/tags/v1")).toBe("refs/tags/v1");
  });
});

describe("PipelinesView queue popover keyboard flow", () => {
  async function openQueuePopover() {
    renderView();
    await screen.findByText("Watched pipelines", undefined, { timeout: 8000 });
    const pipelineCombo = await screen.findByRole("combobox", { name: "Pipeline" });
    await waitFor(() => expect((pipelineCombo as HTMLInputElement).disabled).toBe(false), {
      timeout: 8000,
    });
    fireEvent.mouseDown(pipelineCombo);
    fireEvent.pointerDown(await screen.findByRole("option", { name: "CI" }));
    const queueRunButton = screen.getByRole("button", { name: "Queue run" });
    await waitFor(() => expect((queueRunButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(queueRunButton);
    const dialog = await screen.findByRole("dialog", { name: /Queue CI/ });
    return { dialog, queueRunButton };
  }

  it(
    "opens on the Branch field and returns focus to Queue run when Escape closes it",
    async () => {
      const { dialog, queueRunButton } = await openQueuePopover();
      await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByLabelText("Branch")));

      fireEvent.keyDown(dialog, { key: "Escape" });

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(queueRunButton));
      expect(queuePipelineRun).not.toHaveBeenCalled();
    },
    15000,
  );

  it(
    "queues with Ctrl+Enter and remembers the branch for the next time",
    async () => {
      queuePipelineRun.mockResolvedValueOnce({
        organizationId: "contoso",
        projectId: "demo-project",
        projectName: "Demo Project",
        buildId: 2001,
        buildNumber: "2001",
        definitionId: 1,
        definitionName: "CI",
        status: "notStarted",
        result: null,
        sourceBranch: "refs/heads/release/9",
        reason: "manual",
        requestedFor: "Demo User",
        queueTime: null,
        startTime: null,
        finishTime: null,
        webUrl: "https://dev.azure.com/demo/demo/_build/results?buildId=2001",
      });
      const { dialog, queueRunButton } = await openQueuePopover();

      fireEvent.change(within(dialog).getByLabelText("Branch"), { target: { value: "release/9" } });
      fireEvent.keyDown(dialog, { key: "Enter", ctrlKey: true });

      await waitFor(() => expect(queuePipelineRun).toHaveBeenCalled());
      expect(queuePipelineRun.mock.calls[0][0]).toMatchObject({ sourceBranch: "refs/heads/release/9" });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

      fireEvent.click(queueRunButton);
      const reopened = await screen.findByRole("dialog", { name: /Queue CI/ });
      await waitFor(() =>
        expect((within(reopened).getByLabelText("Branch") as HTMLInputElement).value).toBe("release/9"),
      );
    },
    15000,
  );
});
