import type { AgentWorkEntry, AgentWorkTarget } from "@/lib/azdoCommands";
import { agentWorkKey } from "@/lib/azdoCommands";

// In-memory Agent Work for browser demo mode. The ids match the demo pull
// requests and work items, so the result HTML and linked items resolve.

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function entry(
  target: AgentWorkEntry["target"],
  id: number,
  title: string,
  scope: string,
  scopeId: string,
  projectId: string,
  status: AgentWorkEntry["status"],
  extra: Partial<AgentWorkEntry> = {},
): AgentWorkEntry {
  return {
    organizationId: "contoso",
    organizationName: "contoso",
    target,
    id,
    scopeId,
    title,
    scope,
    projectId,
    webUrl:
      target === "pull-request"
        ? `https://dev.azure.com/contoso/${projectId}/_git/${scope}/pullrequest/${id}`
        : `https://dev.azure.com/contoso/${projectId}/_workitems/edit/${id}`,
    status,
    excluded: false,
    startedAt: null,
    finishedAt: null,
    failures: 0,
    nextRetryAt: null,
    error: null,
    exitCode: null,
    hasLog: false,
    ...extra,
  };
}

function seed(): AgentWorkEntry[] {
  return [
    entry("pull-request", 42, "Add pull request search dashboard", "azdo-dashboard", "azdo-dashboard", "platform", "running", {
      startedAt: minutesAgo(4),
      hasLog: true,
    }),
    entry("pull-request", 99, "Harden gateway retries", "api-gateway", "api-gateway", "platform", "waiting"),
    entry("pull-request", 103, "Upgrade logging packages", "azdo-dashboard", "azdo-dashboard", "platform", "failed", {
      startedAt: minutesAgo(70),
      finishedAt: minutesAgo(40),
      failures: 3,
      nextRetryAt: new Date(Date.now() + 34 * 60_000).toISOString(),
      error: "Automatic review timed out",
      exitCode: null,
      hasLog: true,
    }),
    entry("pull-request", 189, "Fix crash on back press during payment flow", "android-app", "android-app", "mobile", "succeeded", {
      startedAt: minutesAgo(30),
      finishedAt: minutesAgo(22),
      exitCode: 0,
      hasLog: true,
    }),
    entry("work-item", 123, "Roll out rate limiting", "Platform", "platform", "platform", "succeeded", {
      startedAt: minutesAgo(90),
      finishedAt: minutesAgo(80),
      exitCode: 0,
      hasLog: true,
    }),
    entry("pull-request", 101, "Add rate limiting middleware to all endpoints", "api-gateway", "api-gateway", "platform", "partial", {
      startedAt: minutesAgo(200),
      finishedAt: minutesAgo(180),
      exitCode: 0,
      hasLog: true,
    }),
    entry("work-item", 118, "Payment crash on Android", "Mobile", "mobile", "mobile", "none", { excluded: true }),
  ];
}

let work = seed();

export function resetDemoAgentWork() {
  work = seed();
}

/** Candidates hidden from Auto queue because they are excluded. */
export function demoExcludedKeys(): Set<string> {
  return new Set(work.filter((item) => item.excluded).map(agentWorkKey));
}

export function demoListAgentWork(): AgentWorkEntry[] {
  return work.map((item) => ({ ...item }));
}

export function demoReadAgentWorkLog(target: AgentWorkTarget): string {
  const item = work.find((candidate) => agentWorkKey(candidate) === agentWorkKey(target));
  if (!item?.hasLog) return "";
  return item.status === "failed"
    ? "[10:12:03] reading _context/diff-01.md\n[10:41:58] still writing the result HTML\nAutomatic review timed out"
    : "[10:42:03] reading _context/diff-01.md\n[10:44:51] writing the result HTML";
}

export function demoRetryAgentWork(target: AgentWorkTarget) {
  work = work.map((item) =>
    agentWorkKey(item) === agentWorkKey(target) ? { ...item, status: "waiting", nextRetryAt: null } : item,
  );
}

export function demoSetAgentWorkExcluded(input: AgentWorkTarget & { title: string; scope: string; excluded: boolean }) {
  const existing = work.find((item) => agentWorkKey(item) === agentWorkKey(input));
  if (existing) {
    work = work
      .map((item) => (item === existing ? { ...item, excluded: input.excluded } : item))
      .filter((item) => item.excluded || item.status !== "none");
  } else if (input.excluded) {
    work = [
      ...work,
      entry(input.target, input.id, input.title, input.scope, input.scopeId, input.scopeId, "none", { excluded: true }),
    ];
  }
}
