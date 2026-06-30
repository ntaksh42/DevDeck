import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TimelineNode } from "@/lib/azdoCommands";
import { PipelineTimeline } from "./PipelineTimeline";

afterEach(() => {
  cleanup();
});

function node(overrides: Partial<TimelineNode> = {}): TimelineNode {
  return {
    id: "stage-1",
    parentId: null,
    identifier: null,
    nodeType: "Stage",
    name: "Build",
    state: "completed",
    result: "succeeded",
    startTime: "2026-06-13T09:00:00Z",
    finishTime: "2026-06-13T09:01:00Z",
    logId: null,
    errorCount: 0,
    warningCount: 0,
    order: 1,
    ...overrides,
  };
}

const noop = () => {};

describe("PipelineTimeline", () => {
  it("shows an empty-state message when the timeline has no records", () => {
    render(
      <PipelineTimeline
        timeline={[]}
        timelineUnavailable={false}
        selectedLogId={null}
        onSelectLog={noop}
        onRetryStage={noop}
        retryingStageRef={null}
        retryDisabled={false}
      />,
    );
    expect(screen.getByText("No timeline available.")).toBeTruthy();
  });

  it("shows a fetch-error message when the timeline failed to load", () => {
    render(
      <PipelineTimeline
        timeline={[]}
        timelineUnavailable
        selectedLogId={null}
        onSelectLog={noop}
        onRetryStage={noop}
        retryingStageRef={null}
        retryDisabled={false}
      />,
    );
    expect(screen.getByText(/Failed to load the timeline/)).toBeTruthy();
  });

  it("does not show a retry control for a stage that succeeded", () => {
    render(
      <PipelineTimeline
        timeline={[node({ identifier: "Build", result: "succeeded" })]}
        timelineUnavailable={false}
        selectedLogId={null}
        onSelectLog={noop}
        onRetryStage={noop}
        retryingStageRef={null}
        retryDisabled={false}
      />,
    );
    expect(screen.queryByRole("button", { name: /Retry the Build stage/ })).toBeNull();
  });

  it("does not show a retry control for a stage missing its identifier", () => {
    render(
      <PipelineTimeline
        timeline={[node({ identifier: null, result: "failed" })]}
        timelineUnavailable={false}
        selectedLogId={null}
        onSelectLog={noop}
        onRetryStage={noop}
        retryingStageRef={null}
        retryDisabled={false}
      />,
    );
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });

  it("shows a retry button for a failed stage and invokes the callback with its stageRefName", () => {
    const onRetryStage = vi.fn();
    render(
      <PipelineTimeline
        timeline={[node({ identifier: "Deploy", name: "Deploy", result: "failed" })]}
        timelineUnavailable={false}
        selectedLogId={null}
        onSelectLog={noop}
        onRetryStage={onRetryStage}
        retryingStageRef={null}
        retryDisabled={false}
      />,
    );
    const retryButton = screen.getByRole("button", { name: /Retry the Deploy stage/ });
    fireEvent.click(retryButton);
    expect(onRetryStage).toHaveBeenCalledWith("Deploy");
  });

  it("hides the retry control entirely when retries are disabled (read-only mode)", () => {
    render(
      <PipelineTimeline
        timeline={[node({ identifier: "Deploy", name: "Deploy", result: "failed" })]}
        timelineUnavailable={false}
        selectedLogId={null}
        onSelectLog={noop}
        onRetryStage={noop}
        retryingStageRef={null}
        retryDisabled
      />,
    );
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });

  it("disables the retry button while that stage's retry is in flight", () => {
    render(
      <PipelineTimeline
        timeline={[node({ identifier: "Deploy", name: "Deploy", result: "failed" })]}
        timelineUnavailable={false}
        selectedLogId={null}
        onSelectLog={noop}
        onRetryStage={noop}
        retryingStageRef="Deploy"
        retryDisabled={false}
      />,
    );
    const retryButton = screen.getByRole("button", { name: /Retry the Deploy stage/ });
    expect(retryButton).toHaveProperty("disabled", true);
  });

  it("does not select a log when clicking a row with no log id", () => {
    const onSelectLog = vi.fn();
    render(
      <PipelineTimeline
        timeline={[node({ logId: null })]}
        timelineUnavailable={false}
        selectedLogId={null}
        onSelectLog={onSelectLog}
        onRetryStage={noop}
        retryingStageRef={null}
        retryDisabled={false}
      />,
    );
    fireEvent.click(screen.getByText("Build"));
    expect(onSelectLog).not.toHaveBeenCalled();
  });

  it("selects a job's log when clicking a row with a log id", () => {
    const onSelectLog = vi.fn();
    render(
      <PipelineTimeline
        timeline={[node({ id: "job-1", nodeType: "Job", name: "Compile", logId: 7 })]}
        timelineUnavailable={false}
        selectedLogId={null}
        onSelectLog={onSelectLog}
        onRetryStage={noop}
        retryingStageRef={null}
        retryDisabled={false}
      />,
    );
    fireEvent.click(screen.getByText("Compile"));
    expect(onSelectLog).toHaveBeenCalledWith(7);
  });
});
