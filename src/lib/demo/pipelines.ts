import type { PipelineApprovalSummary, PipelineTestSummary } from "@/lib/azdoCommands";

export function demoPipelineProjects() {
  return [
    { id: "demo-project", name: "Demo Project" },
    { id: "demo-tools", name: "Tooling" },
  ];
}

export function demoPipelineDefinitions() {
  return [
    { id: 1, name: "CI" },
    { id: 2, name: "Nightly" },
  ];
}

export function demoPipelineApprovals(): PipelineApprovalSummary[] {
  return [
    {
      id: "demo-approval-1",
      status: "pending",
      instructions: "Approve to deploy to Production.",
      minRequiredApprovers: 1,
      executionOrder: "anyOrder",
      createdOn: "2026-05-27T07:30:00Z",
      assignedApprovers: ["Demo User"],
    },
    {
      id: "demo-approval-2",
      status: "pending",
      instructions: null,
      minRequiredApprovers: 2,
      executionOrder: "inSequence",
      createdOn: "2026-05-27T06:10:00Z",
      assignedApprovers: ["Demo User", "Grace Chen"],
    },
  ];
}

export function demoPipelineRuns() {
  return [
    {
      organizationId: "contoso",
      projectId: "demo-project",
      projectName: "Demo Project",
      buildId: 1001,
      buildNumber: "20260613.3",
      definitionId: 1,
      definitionName: "CI",
      status: "completed",
      result: "succeeded",
      sourceBranch: "refs/heads/main",
      reason: "individualCI",
      requestedFor: "Demo User",
      queueTime: "2026-06-13T09:00:00Z",
      startTime: "2026-06-13T09:00:05Z",
      finishTime: "2026-06-13T09:04:00Z",
      webUrl: "https://dev.azure.com/demo/demo/_build/results?buildId=1001",
    },
    {
      organizationId: "contoso",
      projectId: "demo-project",
      projectName: "Demo Project",
      buildId: 1002,
      buildNumber: "20260613.4",
      definitionId: 1,
      definitionName: "CI",
      status: "completed",
      result: "failed",
      sourceBranch: "refs/heads/feature/login",
      reason: "pullRequest",
      requestedFor: "Demo User",
      queueTime: "2026-06-13T10:00:00Z",
      startTime: "2026-06-13T10:00:05Z",
      finishTime: "2026-06-13T10:02:30Z",
      webUrl: "https://dev.azure.com/demo/demo/_build/results?buildId=1002",
    },
    {
      organizationId: "contoso",
      projectId: "demo-project",
      projectName: "Demo Project",
      buildId: 1003,
      buildNumber: "20260613.5",
      definitionId: 2,
      definitionName: "Nightly",
      status: "inProgress",
      result: null,
      sourceBranch: "refs/heads/main",
      reason: "schedule",
      requestedFor: "Scheduler",
      queueTime: "2026-06-13T11:00:00Z",
      startTime: "2026-06-13T11:00:05Z",
      finishTime: null,
      webUrl: "https://dev.azure.com/demo/demo/_build/results?buildId=1003",
    },
  ];
}

export function demoPipelineRunDetail(buildId: number) {
  const runs = demoPipelineRuns();
  const run = runs.find((r) => r.buildId === buildId) ?? runs[0];
  const timeline = [
    {
      id: "stage-1",
      parentId: null,
      identifier: "Build",
      nodeType: "Stage",
      name: "Build",
      state: "completed",
      result: "succeeded",
      startTime: run.startTime,
      finishTime: run.finishTime,
      logId: null,
      errorCount: 0,
      warningCount: 0,
      order: 1,
    },
    {
      id: "job-1",
      parentId: "stage-1",
      identifier: null,
      nodeType: "Job",
      name: "Compile",
      state: "completed",
      result: "succeeded",
      startTime: run.startTime,
      finishTime: run.finishTime,
      logId: 7,
      errorCount: 0,
      warningCount: 0,
      order: 1,
    },
  ];
  if (run.result === "failed") {
    timeline.push({
      id: "stage-2",
      parentId: null,
      identifier: "Deploy",
      nodeType: "Stage",
      name: "Deploy",
      state: "completed",
      result: "failed",
      startTime: run.startTime,
      finishTime: run.finishTime,
      logId: null,
      errorCount: 1,
      warningCount: 0,
      order: 2,
    });
  }
  return { run, timelineUnavailable: false, timeline };
}

export function demoPipelineTestSummary(buildId: number): PipelineTestSummary {
  const detail = demoPipelineRunDetail(buildId);
  if (detail.run.result !== "failed") {
    return {
      runCount: 1,
      totalTests: 128,
      passedTests: 128,
      failedTests: 0,
      failed: [],
      truncated: false,
    };
  }
  return {
    runCount: 1,
    totalTests: 128,
    passedTests: 125,
    failedTests: 3,
    truncated: false,
    failed: [
      {
        runName: "VSTest",
        title: "PaymentFlowTests.RefundsAreIdempotent",
        errorMessage: "Expected 1 refund, got 2.",
        durationMs: 412,
      },
      {
        runName: "VSTest",
        title: "AuthTests.TokenRefreshRetries",
        errorMessage: "Timed out waiting for token refresh.",
        durationMs: 5031,
      },
      {
        runName: "VSTest",
        title: "SearchTests.RanksExactMatchFirst",
        errorMessage: null,
        durationMs: 88,
      },
    ],
  };
}

export function demoPipelineDefinitionDetail(definitionId: number) {
  if (definitionId === 2) {
    return {
      definitionId: 2,
      name: "Nightly",
      triggers: [
        {
          triggerType: "schedule",
          branchFilters: ["+refs/heads/main"],
          pathFilters: [],
        },
      ],
      variables: [
        {
          name: "BuildConfiguration",
          value: "Release",
          isSecret: false,
          allowOverride: true,
        },
      ],
    };
  }
  return {
    definitionId: 1,
    name: "CI",
    triggers: [
      {
        triggerType: "continuousIntegration",
        branchFilters: ["+refs/heads/main"],
        pathFilters: ["-/docs"],
      },
      {
        triggerType: "pullRequest",
        branchFilters: ["+refs/heads/main"],
        pathFilters: [],
      },
    ],
    variables: [
      {
        name: "BuildConfiguration",
        value: "Debug",
        isSecret: false,
        allowOverride: true,
      },
      {
        name: "DeployApiKey",
        value: null,
        isSecret: true,
        allowOverride: false,
      },
    ],
  };
}

export function demoPipelineRunsFiltered(input?: {
  branch?: string;
  result?: string;
  requestedForMe?: boolean;
}) {
  let runs = demoPipelineRuns();
  if (input?.branch) {
    const needle = input.branch.toLowerCase();
    runs = runs.filter((run) => run.sourceBranch.toLowerCase().includes(needle));
  }
  if (input?.result) {
    runs = runs.filter((run) => run.result === input.result);
  }
  if (input?.requestedForMe) {
    runs = runs.filter((run) => run.requestedFor === "Demo User");
  }
  return runs;
}
